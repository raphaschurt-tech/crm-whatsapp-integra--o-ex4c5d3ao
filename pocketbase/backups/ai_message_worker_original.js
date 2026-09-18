// BACKUP DE SEGURANÇA pocketbase/hooks/ai_message_worker.js
// Criado em 2026-09-18 antes do mecanismo de handoff
onRecordAfterCreateSuccess((e) => {
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

  let maskedPhone = '****'
  if (phone && phone.length > 6) {
    maskedPhone = phone.slice(0, 4) + '****' + phone.slice(-2)
  }

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
    try {
      dateTimeSP = new Date().toISOString()
    } catch (_) {}
  }

  const timeContextLine = dateTimeSP
    ? '\n\nData/hora atual: ' + dateTimeSP + ' (horário de Brasília).'
    : ''

  const configuredPrompt = String(validConfigRec.getString('ai_system_prompt') || '').trim()
  const fallbackPrompt =
    'Você é o assistente virtual da RPA AUTO PARTS, especializada em peças automotivas. ' +
    'Seja cordial, objetivo e atencioso. ' +
    'NÃO invente preços, estoque, prazos ou especificações técnicas. ' +
    'Se não souber uma informação, informe que a equipe humana irá confirmar.'

  const stockPriceGuardRule =
    '\n\n[REGRA CRÍTICA DE PREÇOS E ESTOQUE]\n' +
    'Quando um item ou peça NÃO possuir estoque disponível (estoque 0, nulo ou indisponível), ' +
    'NUNCA informe valor ou preço ao cliente (o valor é sempre "Sob consulta"). ' +
    'Informe apenas que a peça está sob consulta e que nossa equipe de consultores humanos verificará a disponibilidade e orçamento.'

  const effectiveSystemPrompt =
    (configuredPrompt.length > 0 ? configuredPrompt : fallbackPrompt) +
    stockPriceGuardRule +
    timeContextLine

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

  const chronologicalHistory = (historyRecords || []).slice().reverse()

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

  chatMessages.push({ role: 'user', content: incomingText })

  try {
    const cleanPhoneDigits = String(phone || '').replace(/\D/g, '')
    let withoutDdi = cleanPhoneDigits
    if (withoutDdi.startsWith('55') && withoutDdi.length >= 12) {
      withoutDdi = withoutDdi.slice(2)
    }

    let customerRecord = null
    try {
      const foundList = $app.findRecordsByFilter(
        'customers',
        'phone ~ {:p1} || phone ~ {:p2}',
        '-created',
        1,
        0,
        { p1: cleanPhoneDigits, p2: withoutDdi },
      )
      if (foundList && foundList.length > 0) {
        customerRecord = foundList[0]
      }
    } catch (_) {}

    if (!customerRecord) {
      try {
        const custCol = $app.findCollectionByNameOrId('customers')
        customerRecord = new Record(custCol)
        customerRecord.set('name', phone)
        customerRecord.set('phone', phone)
        customerRecord.set('notes', 'Lead originado pelo WhatsApp')
        customerRecord.set('type', 'PF')
        customerRecord.set('pipeline_status', 'novo_lead')
        $app.save(customerRecord)
      } catch (createErr) {
        console.log('[AI-WORKER-CUSTOMER-CREATE-ERR]', createErr.message || String(createErr))
      }
    } else {
      const isCustDeleted = Boolean(customerRecord.get('deleted'))
      if (!isCustDeleted) {
        const curStatus = String(customerRecord.getString('pipeline_status') || '').trim()
        if (!curStatus) {
          customerRecord.set('pipeline_status', 'novo_lead')
          try {
            $app.save(customerRecord)
          } catch (_) {}
        }
      }
    }

    if (customerRecord) {
      const currentCustName = String(customerRecord.getString('name') || '').trim()
      const isDigitsOnly = /^[0-9+\s()-]+$/.test(currentCustName)

      if (isDigitsOnly || currentCustName === phone) {
        let detectedName = ''
        const textSample = incomingText.trim()

        const namePatterns = [
          /(?:meu\s+nome\s+é|me\s+chamo|chamo-me|sou\s+o|sou\s+a|aqui\s+é\s+o|aqui\s+é\s+a|falo\s+com|aqui\s+quem\s+fala\s+é\s+o|aqui\s+quem\s+fala\s+é\s+a)\s+([A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,})?)/i,
          /(?:olá|oi|bom\s+dia|boa\s+tarde|boa\s+noite)[,\s]+(?:eu\s+sou\s+o|eu\s+sou\s+a|sou\s+o|sou\s+a|meu\s+nome\s+é|aqui\s+é)\s+([A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,})?)/i,
        ]

        for (let np = 0; np < namePatterns.length; np++) {
          const match = textSample.match(namePatterns[np])
          if (match && match[1]) {
            const rawCandidate = match[1].trim()
            const stopWords = [
              'bom',
              'dia',
              'tarde',
              'noite',
              'ola',
              'olá',
              'favor',
              'uma',
              'peca',
              'peça',
              'orcamento',
              'orçamento',
              'amigo',
              'irmao',
              'irmão',
            ]
            if (
              !stopWords.includes(rawCandidate.toLowerCase()) &&
              rawCandidate.length >= 2 &&
              rawCandidate.length <= 40
            ) {
              detectedName = rawCandidate
                .split(/\s+/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ')
              break
            }
          }
        }

        if (
          !detectedName &&
          (textSample.toLowerCase().includes('nome') ||
            textSample.toLowerCase().includes('chamo') ||
            textSample.toLowerCase().includes('aqui é'))
        ) {
          try {
            const extractMessages = [
              {
                role: 'system',
                content:
                  'Identifique se o usuário informou o próprio nome nesta mensagem. Se informou, retorne APENAS o nome próprio formatado (Ex: "Lucas Silva"). Se não houver nome de pessoa se apresentando, responda exatamente "NAO". Não adicione pontuação ou explicações.',
              },
              { role: 'user', content: textSample },
            ]

            let aiNameResp = ''
            if (openaiKey) {
              const resAi = $http.send({
                url: 'https://api.openai.com/v1/chat/completions',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + openaiKey,
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: extractMessages,
                  max_tokens: 15,
                  temperature: 0.0,
                }),
                timeout: 5,
              })
              if (
                resAi.statusCode === 200 &&
                resAi.json &&
                resAi.json.choices &&
                resAi.json.choices[0]
              ) {
                aiNameResp = String(resAi.json.choices[0].message.content || '').trim()
              }
            } else {
              const resAi = $ai.chat({
                model: 'fast',
                messages: extractMessages,
              })
              if (resAi && resAi.choices && resAi.choices[0]) {
                aiNameResp = String(resAi.choices[0].message.content || '').trim()
              }
            }

            if (
              aiNameResp &&
              !aiNameResp.toUpperCase().includes('NAO') &&
              !aiNameResp.toUpperCase().includes('NÃO') &&
              aiNameResp.length >= 2 &&
              aiNameResp.length <= 50
            ) {
              detectedName = aiNameResp.replace(/["'.]/g, '').trim()
            }
          } catch (_) {}
        }

        if (detectedName) {
          customerRecord.set('name', detectedName)
          $app.save(customerRecord)
          console.log(
            '[CUSTOMER-NAME-DETECTED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              customerId: customerRecord.id,
              detectedName: detectedName,
              phone: maskedPhone,
            }),
          )
        }
      }
    }
  } catch (custDetectErr) {
    console.log('[CUSTOMER-NAME-DETECTION-ERROR]', custDetectErr.message || String(custDetectErr))
  }

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

    return e.next()
  }

  console.log(
    '[AI-PROCESSING-SUCCESS]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      model: usedModel,
      senderPhone: maskedPhone,
    }),
  )

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
