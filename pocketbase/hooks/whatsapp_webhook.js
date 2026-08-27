// Rota POST explícita no caminho principal do webhook do WhatsApp (Z-API)
routerAdd('POST', '/backend/v1/whatsapp/webhook', (e) => {
  let rawBody = e.requestInfo().body
  let body = {}

  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody)
    } catch (_) {
      body = {}
    }
  } else if (rawBody && typeof rawBody === 'object') {
    body = rawBody
  }

  // 1. Extrair campos do payload Z-API de forma segura e resiliente a diferentes tipos
  const eventType =
    body.type ||
    body.event ||
    body.eventType ||
    (body.data && body.data.message ? 'message' : '') ||
    ''

  const rawInstanceId = String(body.instanceId || body.instance_id || '')
  let maskedInstanceId = ''
  if (rawInstanceId) {
    if (rawInstanceId.length > 8) {
      maskedInstanceId = rawInstanceId.slice(0, 4) + '****' + rawInstanceId.slice(-4)
    } else {
      maskedInstanceId = '****'
    }
  }

  // Extrair telefone do remetente
  let rawPhone = ''
  if (body.phone) {
    if (typeof body.phone === 'object' && body.phone !== null) {
      rawPhone = String(body.phone.phone || body.phone.number || '')
    } else {
      rawPhone = String(body.phone)
    }
  } else if (body.sender) {
    if (typeof body.sender === 'object' && body.sender !== null) {
      rawPhone = String(body.sender.phone || body.sender.id || '')
    } else {
      rawPhone = String(body.sender)
    }
  } else if (body.chat) {
    if (typeof body.chat === 'object' && body.chat !== null) {
      rawPhone = String(body.chat.phone || body.chat.chatId || '')
    } else {
      rawPhone = String(body.chat)
    }
  } else if (body.data && body.data.key && body.data.key.remoteJid) {
    rawPhone = String(body.data.key.remoteJid)
  }

  // Normalização de telefone
  let normalizedPhone = rawPhone.replace(/\D/g, '')

  let maskedSenderPhone = ''
  if (normalizedPhone) {
    if (normalizedPhone.length > 6) {
      maskedSenderPhone = normalizedPhone.slice(0, 4) + '****' + normalizedPhone.slice(-2)
    } else {
      maskedSenderPhone = '****'
    }
  }

  // Extrair messageId
  let messageId = ''
  if (body.messageId) {
    messageId = String(body.messageId)
  } else if (body.id) {
    messageId = String(body.id)
  } else if (body.data && body.data.key && body.data.key.id) {
    messageId = String(body.data.key.id)
  }

  // Extrair texto da mensagem
  let incomingText = ''
  if (body.text) {
    if (typeof body.text === 'object' && body.text !== null) {
      incomingText = String(body.text.message || body.text.text || '')
    } else {
      incomingText = String(body.text)
    }
  } else if (body.body) {
    incomingText = String(body.body)
  } else if (body.message) {
    if (typeof body.message === 'object' && body.message !== null) {
      incomingText = String(body.message.conversation || body.message.text || '')
    } else {
      incomingText = String(body.message)
    }
  }

  const isFromMe = Boolean(
    body.fromMe === true ||
    body.fromMe === 'true' ||
    (body.data && body.data.key && body.data.key.fromMe),
  )

  // Log sanitizado de recepção (conforme Etapa 1)
  console.log(
    '[WEBHOOK-RECEIVED]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/backend/v1/whatsapp/webhook',
      eventType: eventType,
      instanceId: maskedInstanceId,
      senderPhone: maskedSenderPhone,
    }),
  )

  // 2. Persistir na collection webhook_received (para rastreabilidade/auditoria)
  try {
    const colWebhook = $app.findCollectionByNameOrId('webhook_received')
    const rec = new Record(colWebhook)
    rec.set('type', eventType || 'ReceivedCallback')
    rec.set('phone', body.phone || { phone: normalizedPhone })
    rec.set('fromMe', isFromMe)
    rec.set('text', body.text || { message: incomingText })
    rec.set('chat', body.chat || null)
    rec.set('sender', body.sender || null)
    rec.set('status', String(body.status || 'RECEIVED'))
    rec.set('messageId', messageId)
    rec.set('instanceId', rawInstanceId)
    rec.set('moment', Number(body.moment) || Math.floor(Date.now() / 1000))
    $app.save(rec)
  } catch (err) {
    console.log('[WEBHOOK-PERSIST-ERR]', err.message || String(err))
  }

  // 3. Validações de segurança e regras para enfileiramento na message_processing
  // Regra: Ignorar mensagens com fromMe=true
  if (isFromMe) {
    return e.json(200, { status: 'ignored_from_me' })
  }

  // Regra: Somente mensagens de texto
  if (!incomingText || typeof incomingText !== 'string' || !incomingText.trim()) {
    return e.json(200, { status: 'ignored_non_text' })
  }

  // Regra: Ignorar mensagens sem messageId confiável
  if (!messageId || !messageId.trim()) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        error: 'Mensagem recebida sem messageId confiável',
        senderPhone: maskedSenderPhone,
      }),
    )
    return e.json(200, { status: 'ignored_missing_message_id' })
  }

  // 4. Ler configurações persistentes
  let iaEnabled = false
  let authorizedPhone = ''
  let configuredAiModel = 'gpt-4o-mini'

  try {
    const sList = $app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (sList && sList.length > 0) {
      const sRec = sList[0]
      iaEnabled = Boolean(sRec.get('ai_enabled'))
      authorizedPhone = String(sRec.get('authorized_test_phone') || '')
      configuredAiModel = String(sRec.get('ai_model') || 'gpt-4o-mini')
    }
  } catch (err) {
    console.log('[SETTINGS-READ-ERR]', err.message || String(err))
  }

  // Normalizar telefone autorizado
  const normalizedAuthPhone = authorizedPhone.replace(/\D/g, '')

  // Verificação de número de teste autorizado
  if (!normalizedAuthPhone || normalizedPhone !== normalizedAuthPhone) {
    console.log(
      '[UNAUTHORIZED-TEST-NUMBER]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        senderPhone: maskedSenderPhone,
        messageId: messageId,
      }),
    )
    return e.json(200, { status: 'ignored_unauthorized_number' })
  }

  // Verificação de IA Habilitada
  if (!iaEnabled) {
    console.log(
      '[AI-DISABLED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        senderPhone: maskedSenderPhone,
        messageId: messageId,
      }),
    )
    return e.json(200, { status: 'ai_disabled' })
  }

  // 5. Idempotência e Enfileiramento em message_processing
  try {
    const existing = $app.findRecordsByFilter(
      'message_processing',
      'messageId = {:mid}',
      '-created',
      1,
      0,
      { mid: messageId },
    )

    if (existing && existing.length > 0) {
      const existingStatus = existing[0].getString('status')
      const existingReplySent = Boolean(existing[0].get('replySent'))

      if (existingStatus === 'processing' || existingStatus === 'completed' || existingReplySent) {
        console.log(
          '[DUPLICATE-MESSAGE]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            messageId: messageId,
            status: existingStatus,
            replySent: existingReplySent,
            senderPhone: maskedSenderPhone,
          }),
        )
        return e.json(200, { status: 'already_processed_or_processing' })
      }

      // Se falhou anteriormente (failed), atualiza para received para permitir reprocessamento controlado
      const rec = existing[0]
      rec.set('status', 'received')
      rec.set('incomingText', incomingText.trim())
      rec.set('aiModel', configuredAiModel)
      $app.save(rec)
    } else {
      // Criar novo registro de processamento no estado 'received'
      const colMsg = $app.findCollectionByNameOrId('message_processing')
      const rec = new Record(colMsg)
      rec.set('messageId', messageId)
      rec.set('phone', normalizedPhone)
      rec.set('status', 'received')
      rec.set('replySent', false)
      rec.set('incomingText', incomingText.trim())
      rec.set('aiModel', configuredAiModel)
      rec.set('retryCount', 0)
      $app.save(rec)
    }
  } catch (dbErr) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: 'idempotency_check',
        error: dbErr.message || String(dbErr),
        messageId: messageId,
      }),
    )
  }

  // Responde HTTP 200 rapidamente ao webhook da Z-API
  return e.json(200, {
    status: 'received',
  })
})
