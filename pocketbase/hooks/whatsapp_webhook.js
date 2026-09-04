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

  // 1. Extrair campos do payload Z-API de forma segura e resiliente a diferentes formatos
  const eventType =
    body.type ||
    body.event ||
    body.eventType ||
    (body.data && body.data.message ? 'message' : '') ||
    'ReceivedCallback'

  const rawInstanceId = String(body.instanceId || body.instance_id || '')
  let maskedInstanceId = ''
  if (rawInstanceId) {
    if (rawInstanceId.length > 8) {
      maskedInstanceId = rawInstanceId.slice(0, 4) + '****' + rawInstanceId.slice(-4)
    } else {
      maskedInstanceId = '****'
    }
  }

  // Função auxiliar interna para verificar se uma string/JID é @lid ou número interno inválido
  const isLidString = (val) => {
    if (!val) return false
    const s = String(val).trim()
    if (s.toLowerCase().includes('@lid')) return true
    const digits = s.replace(/\D/g, '')
    // WhatsApp LIDs têm normalmente 14 ou 15 dígitos sem código DDI/DDD válido (não começam com 55 ou têm 14+ dígitos)
    // Telefones brasileiros com DDI têm 12 (55 + 2 DDD + 8 fixo) ou 13 dígitos (55 + 2 DDD + 9 celular).
    // Números com mais de 13 dígitos que não são telefones internacionais válidos ou com 14+ dígitos são LIDs.
    if (digits.length >= 14) return true
    return false
  }

  // Função auxiliar interna para verificar se é grupo do WhatsApp
  const isGroupString = (val) => {
    if (!val) return false
    const s = String(val).trim().toLowerCase()
    return s.includes('@g.us') || s.includes('-group')
  }

  // Extração resiliente de telefone e detecção de LID/Grupo
  // A Z-API pode enviar campos como: phone, senderPhone, participantPhone, connectedPhone, remoteJid, sender, chat, etc.
  const candidatePhones = [
    body.phone && typeof body.phone === 'object'
      ? body.phone.phone || body.phone.number
      : body.phone,
    body.senderPhone,
    body.participantPhone,
    body.connectedPhone,
    body.userPhone,
    body.chat && typeof body.chat === 'object' ? body.chat.phone || body.chat.chatId : body.chat,
    body.sender && typeof body.sender === 'object'
      ? body.sender.phone || body.sender.id
      : body.sender,
    body.data && body.data.key && body.data.key.remoteJid,
    body.data && body.data.key && body.data.key.participant,
  ]

  let resolvedPhone = ''
  let hasLid = false
  let isGroup = false

  for (let i = 0; i < candidatePhones.length; i++) {
    const candidate = candidatePhones[i]
    if (!candidate) continue
    const candStr = String(candidate)

    if (isGroupString(candStr)) {
      isGroup = true
    }
    if (isLidString(candStr)) {
      hasLid = true
    }

    const digits = candStr.replace(/\D/g, '')
    // Se não é grupo, não contém @lid e tem comprimento típico de telefone (10 a 13 dígitos)
    if (!candStr.toLowerCase().includes('@lid') && !candStr.toLowerCase().includes('@g.us')) {
      if (digits.length >= 10 && digits.length <= 13) {
        resolvedPhone = digits
        break
      }
    }
  }

  // Se é grupo, ignorar imediatamente (não processar nem poluir chat/IA)
  if (isGroup) {
    console.log('[WEBHOOK-IGNORED-GROUP]', JSON.stringify({ instanceId: maskedInstanceId }))
    return e.json(200, { status: 'ignored_group' })
  }

  // Normalização final de telefone
  let normalizedPhone = resolvedPhone
  if (normalizedPhone.length === 10 || normalizedPhone.length === 11) {
    normalizedPhone = '55' + normalizedPhone
  }

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

  // Log sanitizado de recepção do webhook (sem expor credenciais nem telefones completos)
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
  // IMPORTANTE: Se normalizedPhone estiver vazio (ex: evento puro de @lid sem telefone mapeável),
  // NÃO criamos registro órfão que poluiria o atendimento com número gigante ou vazio.
  try {
    if (normalizedPhone) {
      const colWebhook = $app.findCollectionByNameOrId('webhook_received')
      const rec = new Record(colWebhook)
      rec.set('type', eventType || 'ReceivedCallback')
      rec.set('phone', { phone: normalizedPhone })
      rec.set('fromMe', isFromMe)
      rec.set('text', body.text || { message: incomingText })
      rec.set('chat', { phone: normalizedPhone })
      rec.set('sender', body.sender || null)
      rec.set('status', String(body.status || 'RECEIVED'))
      rec.set('messageId', messageId)
      rec.set('instanceId', rawInstanceId)
      rec.set('moment', Number(body.moment) || Math.floor(Date.now() / 1000))
      $app.save(rec)
    } else {
      console.log(
        '[WEBHOOK-LID-WITHOUT-PHONE]',
        JSON.stringify({
          eventType: eventType,
          messageId: messageId,
          fromMe: isFromMe,
          hasLid: hasLid,
        }),
      )
    }
  } catch (err) {
    console.log('[WEBHOOK-PERSIST-ERR]', err.message || String(err))
  }

  // 3. Validações de segurança e regras para enfileiramento na message_processing
  // Regra: Ignorar mensagens enviadas pelo próprio bot (fromMe=true)
  if (isFromMe) {
    return e.json(200, { status: 'ignored_from_me' })
  }

  // Regra: Sem telefone real válido (não enfileirar @lid nem número fantasma para IA)
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 13) {
    return e.json(200, { status: 'ignored_invalid_phone_or_lid' })
  }

  // Regra: Somente mensagens de texto com conteúdo
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

  // 4. Seleção e validação estrita da configuração ativa (PARTE 3)
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
        error: configError,
      }),
    )
    return e.json(200, {
      status: 'settings_invalid',
      error: configError,
    })
  }

  const maskedInst = validConfigRec.getString('zapi_instance_id').slice(0, 4) + '****'
  console.log(
    '[SETTINGS-VALID]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
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
  const configuredAiModel = String(validConfigRec.get('ai_model') || 'gpt-4o-mini')

  // Verificação de IA Habilitada
  // Com a IA habilitada, o atendimento é liberado para qualquer número (sem filtro).
  // O authorized_test_phone vale apenas como modo de teste controlado: com a IA desligada,
  // somente o número de teste chega ao processamento; os demais são registrados como ignorados.
  if (!iaEnabled) {
    if (authorizedPhone && normalizedPhone !== authorizedPhone) {
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

  // 5. Idempotência e Enfileiramento seguro em message_processing
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
