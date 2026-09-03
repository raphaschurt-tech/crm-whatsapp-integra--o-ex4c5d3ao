// Hook assíncrono acionado após inserção ou atualização bem-sucedida em message_processing
// Processa mensagens com IA (gpt-4o-mini) e envia resposta via Z-API com idempotência estrita
onRecordAfterCreateSuccess((e) => {
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

  // 2. Ler e validar estritamente configurações ativas (PARTE 3)
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

  // 4. Início do processamento de IA
  const usedModel = 'gpt-4o-mini'
  console.log(
    '[AI-PROCESSING-START]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      senderPhone: maskedPhone,
      model: usedModel,
    }),
  )

  // Mensagens do chat para a IA
  // Conforme requisitos: resposta curta, cordial, sem inventar preço, estoque ou especificação técnica
  const systemPrompt =
    'Você é o assistente virtual da RPA AUTO PARTS. ' +
    'Seja curto, cordial e objetivo. ' +
    'NÃO invente preços, estoque, prazos ou especificações técnicas. ' +
    'Quando o cliente perguntar sobre peças, responda de forma cordial perguntando qual peça procura e para qual veículo/aplicação. ' +
    'Exemplo de referência: "Olá! Posso ajudar. Qual peça você procura e para qual veículo ou aplicação?"'

  let aiReply = ''
  let aiError = ''

  // Tentativa de chamada OpenAI gpt-4o-mini com timeout de 15 segundos
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
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: incomingText },
          ],
          max_tokens: 250,
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
  } else {
    // Caso openai_api_key não esteja preenchida, utiliza o gateway nativo Skip AI (alias 'fast' mapeado para gpt-4o-mini)
    try {
      const chatRes = $ai.chat({
        model: 'fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: incomingText },
        ],
      })
      if (
        chatRes &&
        chatRes.choices &&
        chatRes.choices.length > 0 &&
        chatRes.choices[0].message &&
        chatRes.choices[0].message.content
      ) {
        aiReply = chatRes.choices[0].message.content.trim()
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
