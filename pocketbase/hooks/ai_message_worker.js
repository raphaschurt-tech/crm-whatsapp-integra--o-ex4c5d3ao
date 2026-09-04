// Hook assíncrono acionado após inserção bem-sucedida em message_processing
// Processa mensagens com IA (gpt-4o-mini) e envia resposta via Z-API com idempotência estrita
onRecordAfterCreateSuccess((e) => {
  // Limite configurável de interações anteriores a carregar do histórico (ex.: 20 registros = 10 do cliente + 10 da IA)
  const MAX_HISTORY_INTERACTIONS = 20

  const record = e.record
  const status = record.getString('status')
  const replySent = Boolean(record.get('replySent'))

  if (status !== 'received' || replySent) {
    return e.next()
  }

  const recordId = record.id
  const messageId = record.getString('messageId')
  const phone = record.getString('phone')
  const incomingText = record.getString('incomingText')

  // Blindagem estrita: rejeitar phones que sejam @lid ou inválidos (não responder a grupos ou LIDs)
  const isLidOrInvalid = (p) => {
    if (!p) return true
    const s = String(p).trim()
    if (s.toLowerCase().includes('@lid') || s.toLowerCase().includes('@g.us')) return true
    const d = s.replace(/\D/g, '')
    if (d.length < 10 || d.length > 13) return true
    return false
  }

  if (isLidOrInvalid(phone)) {
    console.log(
      '[AI-REJECTED-LID-OR-INVALID-PHONE]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        recordId: recordId,
        messageId: messageId,
      }),
    )
    try {
      procRecord = $app.findRecordById('message_processing', recordId)
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'Invalid phone number or WhatsApp LID')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // Mascarar telefone para logs sanitizados
  let maskedPhone = '****'
  if (phone && phone.length > 6) {
    maskedPhone = phone.slice(0, 4) + '****' + phone.slice(-2)
  }

  // 1. Transição atômica de estado para 'processing'
  let procRecord = null
  try {
    procRecord = $app.findRecordById('message_processing', recordId)
    if (procRecord.getString('status') !== 'received' || Boolean(procRecord.get('replySent'))) {
      return e.next()
    }
    procRecord.set('status', 'processing')
    $app.save(procRecord)
  } catch (lockErr) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: 'lock_state',
        messageId: messageId,
        error: lockErr.message || String(lockErr),
      }),
    )
    return e.next()
  }

  // 2. Ler e validar estritamente configurações ativas
  let validConfigRec = null
  let configError = ''

  try {
    const validConfigs = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      10,
      0,
    )

    if (!validConfigs || validConfigs.length === 0) {
      configError = 'Nenhuma configuração válida encontrada (credenciais Z-API incompletas)'
    } else if (validConfigs.length > 1) {
      configError =
        'Múltiplas configurações válidas encontradas (' +
        validConfigs.length +
        '). É exigida configuração única'
    } else {
      validConfigRec = validConfigs[0]
    }
  } catch (err) {
    configError = 'Erro ao consultar configurações: ' + (err.message || String(err))
  }

  if (configError || !validConfigRec) {
    console.log(
      '[SETTINGS-INVALID]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: 'ai_worker_init',
        error: configError,
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', configError)
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  const maskedInst = validConfigRec.getString('zapi_instance_id').slice(0, 4) + '****'
  console.log(
    '[SETTINGS-VALID]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      stage: 'ai_worker',
      configId: validConfigRec.id,
      instanceId: maskedInst,
      aiEnabled: Boolean(validConfigRec.get('ai_enabled')),
    }),
  )

  const iaEnabled = Boolean(validConfigRec.get('ai_enabled'))
  const authorizedPhone = String(validConfigRec.get('authorized_test_phone') || '').replace(
    /\D/g,
    '',
  )
  const openaiKey = String(validConfigRec.get('openai_api_key') || '')
  const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
  const zapiToken = String(validConfigRec.get('zapi_token') || '')
  const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

  // 3. Verificações de segurança no momento da execução
  if (!iaEnabled) {
    console.log(
      '[AI-DISABLED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'AI is disabled in settings')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // O filtro de número só é aplicado no modo de teste controlado (IA desligada).
  // Com a IA habilitada, qualquer número recebido pelo webhook pode ser processado.
  if (!iaEnabled && (!authorizedPhone || phone !== authorizedPhone)) {
    console.log(
      '[UNAUTHORIZED-TEST-NUMBER]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'Phone not authorized for test mode')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // 4. Formatação de data/hora atual no fuso America/Sao_Paulo (horário de Brasília)
  let dateTimeSP = ''
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    dateTimeSP = formatter.format(now)
  } catch (_) {
    // Fallback defensivo em caso de indisponibilidade de formatação específica de locale
    try {
      dateTimeSP = new Date().toISOString()
    } catch (_) {}
  }

  const timeContextLine = dateTimeSP
    ? '\n\nData/hora atual: ' + dateTimeSP + ' (horário de Brasília).'
    : ''

  // 5. Configurar systemPrompt a partir de settings ou fallback mínimo cordial
  const configuredPrompt = String(validConfigRec.getString('ai_system_prompt') || '').trim()
  const fallbackPrompt =
    'Você é o assistente virtual da RPA AUTO PARTS, especializada em peças automotivas. ' +
    'Seja cordial, objetivo e atencioso. ' +
    'NÃO invente preços, estoque, prazos ou especificações técnicas. ' +
    'Se não souber uma informação, informe que a equipe humana irá confirmar.'

  const effectiveSystemPrompt =
    (configuredPrompt.length > 0 ? configuredPrompt : fallbackPrompt) + timeContextLine

  // 6. Buscar histórico da conversa na collection message_processing para o mesmo telefone
  // Filtrar apenas interações anteriores já concluídas com resposta da IA enviada (replySent = true && aiReplyText != '')
  // e ignorar o registro atual
  let historyRecords = []
  try {
    const cleanPhone = String(phone || '').replace(/'/g, "\\'")
    const historyFilter =
      "phone = '" +
      cleanPhone +
      "' && replySent = true && aiReplyText != '' && id != '" +
      recordId +
      "'"

    historyRecords = $app.findRecordsByFilter(
      'message_processing',
      historyFilter,
      '-created',
      MAX_HISTORY_INTERACTIONS,
      0,
    )
  } catch (histErr) {
    console.log(
      '[AI-HISTORY-FETCH-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        error: histErr.message || String(histErr),
      }),
    )
    historyRecords = []
  }

  // Reverter para ordem cronológica (created ASC)
  const chronologicalHistory = (historyRecords || []).slice().reverse()

  // Montar array messages: system -> histórico (user / assistant) -> mensagem atual do cliente
  const chatMessages = [{ role: 'system', content: effectiveSystemPrompt }]
  let historyTurnsCount = 0

  for (let i = 0; i < chronologicalHistory.length; i++) {
    const histItem = chronologicalHistory[i]
    const histUserText = histItem.getString('incomingText')
    const histAiText = histItem.getString('aiReplyText')

    if (histUserText && histUserText.trim()) {
      chatMessages.push({ role: 'user', content: histUserText.trim() })
      historyTurnsCount++
    }
    if (histAiText && histAiText.trim()) {
      chatMessages.push({ role: 'assistant', content: histAiText.trim() })
      historyTurnsCount++
    }
  }

  // Mensagem atual do usuário como último turno
  chatMessages.push({ role: 'user', content: incomingText })

  // 7. Início do processamento de IA
  const usedModel = 'gpt-4o-mini'
  console.log(
    '[AI-PROCESSING-START]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      senderPhone: maskedPhone,
      model: usedModel,
      historyTurns: historyTurnsCount,
      historyRecordsCount: chronologicalHistory.length,
      hasCustomPrompt: configuredPrompt.length > 0,
    }),
  )

  let aiReply = ''
  let aiError = ''
  let usedProvider = ''

  // Tentativa de chamada OpenAI gpt-4o-mini com timeout de 15 segundos.
  // Se a chave OpenAI existir mas a chamada falhar (ex.: HTTP 429 sem créditos),
  // recai automaticamente para o gateway nativo Skip AI ($ai.chat) em vez de
  // abandonar o processamento. Isso mantém o atendimento disponível mesmo quando a
  // conta OpenAI do cliente fica sem créditos.
  if (openaiKey) {
    try {
      const openAiRes = $http.send({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: chatMessages,
          max_tokens: 350,
          temperature: 0.3,
        }),
        timeout: 15,
      })

      if (openAiRes.statusCode >= 200 && openAiRes.statusCode < 300) {
        const parsed = openAiRes.json
        if (
          parsed &&
          parsed.choices &&
          parsed.choices.length > 0 &&
          parsed.choices[0].message &&
          parsed.choices[0].message.content
        ) {
          aiReply = parsed.choices[0].message.content.trim()
          usedProvider = 'openai'
        } else {
          aiError = 'Resposta da OpenAI sem choices válidas'
        }
      } else {
        const errBody = openAiRes.json || openAiRes.body || {}
        aiError =
          'OpenAI HTTP ' +
          openAiRes.statusCode +
          ': ' +
          (errBody.error
            ? errBody.error.message || JSON.stringify(errBody.error)
            : 'Falha na requisição')
      }
    } catch (openAiEx) {
      aiError = openAiEx.message || String(openAiEx)
    }

    // Fallback: se a chamada OpenAI falhou (429 sem créditos, timeout, rede, etc.),
    // tenta o gateway nativo do Skip antes de desistir.
    if (!aiReply && aiError) {
      console.log(
        '[AI-FALLBACK-TO-SKIP-GATEWAY]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          messageId: messageId,
          reason: aiError,
        }),
      )
      try {
        const chatRes = $ai.chat({
          model: 'fast',
          messages: chatMessages,
        })
        if (
          chatRes &&
          chatRes.choices &&
          chatRes.choices.length > 0 &&
          chatRes.choices[0].message &&
          chatRes.choices[0].message.content
        ) {
          aiReply = chatRes.choices[0].message.content.trim()
          usedProvider = 'skip_gateway'
          aiError = ''
        } else {
          aiError = 'Skip AI gateway retornou resposta vazia'
        }
      } catch (aiEx) {
        aiError = aiEx.message || String(aiEx)
      }
    }
  } else {
    // Caso openai_api_key não esteja preenchida, utiliza o gateway nativo Skip AI (alias 'fast' mapeado para gpt-4o-mini)
    try {
      const chatRes = $ai.chat({
        model: 'fast',
        messages: chatMessages,
      })
      if (
        chatRes &&
        chatRes.choices &&
        chatRes.choices.length > 0 &&
        chatRes.choices[0].message &&
        chatRes.choices[0].message.content
      ) {
        aiReply = chatRes.choices[0].message.content.trim()
        usedProvider = 'skip_gateway'
      } else {
        aiError = 'Skip AI gateway retornou resposta vazia'
      }
    } catch (aiEx) {
      aiError = aiEx.message || String(aiEx)
    }
  }

  // 5. Validação do resultado da IA
  if (!aiReply || aiError) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        model: usedModel,
        senderPhone: maskedPhone,
        error: aiError || 'Falha ao gerar resposta pela IA',
      }),
    )

    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', aiError || 'AI processing returned empty reply')
      procRecord.set('aiModel', usedModel)
      $app.save(procRecord)
    } catch (_) {}

    // Não envia resposta automática se a IA falhar
    return e.next()
  }

  // Log de sucesso da IA
  console.log(
    '[AI-PROCESSING-SUCCESS]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      model: usedModel,
      senderPhone: maskedPhone,
    }),
  )

  // 6. Envio da resposta pela Z-API
  const zapiHeaders = {
    'Content-Type': 'application/json',
    'Client-Token': zapiClientToken,
  }

  let zapiHttpStatus = 0
  let zapiSuccess = false
  let zapiErrorDetail = ''

  try {
    const zapiSendUrl =
      'https://api.z-api.io/instances/' +
      encodeURIComponent(zapiInstance) +
      '/token/' +
      encodeURIComponent(zapiToken) +
      '/send-text'

    const zapiRes = $http.send({
      url: zapiSendUrl,
      method: 'POST',
      headers: zapiHeaders,
      body: JSON.stringify({
        phone: phone,
        message: aiReply,
      }),
      timeout: 15,
    })

    zapiHttpStatus = zapiRes.statusCode
    if (zapiRes.statusCode >= 200 && zapiRes.statusCode < 300) {
      zapiSuccess = true
    } else {
      const respData = zapiRes.json || zapiRes.body || {}
      zapiErrorDetail =
        'Z-API status ' +
        zapiRes.statusCode +
        ': ' +
        (respData.message || respData.error || String(zapiRes.body || ''))
    }
  } catch (zapiErr) {
    zapiErrorDetail = zapiErr.message || String(zapiErr)
  }

  // 7. Atualização final de estado e logs sanitizados de envio
  if (zapiSuccess) {
    console.log(
      '[ZAPI-REPLY-SENT]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        httpStatus: zapiHttpStatus,
      }),
    )

    try {
      procRecord.set('status', 'completed')
      procRecord.set('replySent', true)
      procRecord.set('aiReplyText', aiReply)
      procRecord.set('aiModel', usedModel)
      procRecord.set('zapiStatus', zapiHttpStatus)
      procRecord.set('errorMessage', '')
      $app.save(procRecord)
    } catch (saveCompletedErr) {
      console.log('[COMPLETED-SAVE-ERR]', saveCompletedErr.message || String(saveCompletedErr))
    }
  } else {
    console.log(
      '[ZAPI-REPLY-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        httpStatus: zapiHttpStatus,
        error: zapiErrorDetail || 'Falha no envio Z-API',
      }),
    )

    try {
      procRecord.set('status', 'failed')
      procRecord.set('replySent', false)
      procRecord.set('aiReplyText', aiReply)
      procRecord.set('aiModel', usedModel)
      procRecord.set('zapiStatus', zapiHttpStatus)
      procRecord.set('errorMessage', zapiErrorDetail || 'Falha no envio Z-API')
      $app.save(procRecord)
    } catch (saveFailedErr) {
      console.log('[FAILED-SAVE-ERR]', saveFailedErr.message || String(saveFailedErr))
    }
  }

  return e.next()
}, 'message_processing')
