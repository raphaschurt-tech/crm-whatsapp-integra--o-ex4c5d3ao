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
    // WhatsApp LIDs têm normalmente 14 ou 15 dígitos sem código DDI/DDD válido
    if (digits.length >= 14) return true
    return false
  }

  // Função auxiliar interna para verificar se é grupo do WhatsApp
  const isGroupString = (val) => {
    if (!val) return false
    const s = String(val).trim().toLowerCase()
    return s.includes('@g.us') || s.includes('-group')
  }

  const isFromMe = Boolean(
    body.fromMe === true ||
    body.fromMe === 'true' ||
    (body.data &&
      body.data.key &&
      (body.data.key.fromMe === true || body.data.key.fromMe === 'true')),
  )

  // Extração resiliente de telefone e detecção de LID/Grupo.
  // Quando isFromMe = true (mensagem enviada pelo celular ou número conectado),
  // o destinatário real da conversa deve ter PRECEDÊNCIA sobre o próprio número conectado:
  // - data.key.remoteJid (Baileys / Z-API data)
  // - body.to, body.recipient, body.recipientPhone, body.destPhone, body.chatId, body.chat
  // - se ainda for o connectedPhone, buscar conversa mais recente no banco antes de cair em si mesmo
  const candidatePhones = isFromMe
    ? [
        body.data && body.data.key && body.data.key.remoteJid,
        body.recipientPhone,
        body.recipient,
        body.to,
        body.destPhone,
        body.chatId,
        body.chat && typeof body.chat === 'object'
          ? body.chat.phone || body.chat.chatId || body.chat.id
          : body.chat,
        body.data && body.data.key && body.data.key.participant,
        body.phone && typeof body.phone === 'object'
          ? body.phone.phone || body.phone.number
          : body.phone,
        body.senderPhone,
        body.participantPhone,
      ]
    : [
        body.phone && typeof body.phone === 'object'
          ? body.phone.phone || body.phone.number
          : body.phone,
        body.senderPhone,
        body.participantPhone,
        body.userPhone,
        body.chat && typeof body.chat === 'object'
          ? body.chat.phone || body.chat.chatId || body.chat.id
          : body.chat,
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
    const candStr = String(candidate).trim()

    if (isGroupString(candStr)) {
      isGroup = true
    }
    if (isLidString(candStr)) {
      hasLid = true
    }

    // Se contiver @s.whatsapp.net ou @c.us, extrair o prefixo
    let cleanCandidate = candStr
    if (cleanCandidate.includes('@')) {
      cleanCandidate = cleanCandidate.split('@')[0]
    }

    const digits = cleanCandidate.replace(/\D/g, '')
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

  // Se a mensagem foi enviada por nós (fromMe=true) e o número resolvido ainda coincidir com o
  // número conectado configurado em settings (ou body.connectedPhone), precisamos resolver o cliente real!
  if (isFromMe) {
    let connectedNumberDigits = ''
    if (body.connectedPhone) {
      connectedNumberDigits = String(body.connectedPhone).replace(/\D/g, '')
      if (connectedNumberDigits.length === 10 || connectedNumberDigits.length === 11) {
        connectedNumberDigits = '55' + connectedNumberDigits
      }
    }
    if (!connectedNumberDigits) {
      try {
        const setRec = $app.findRecordsByFilter(
          'settings',
          "whatsapp_number != ''",
          '-created',
          1,
          0,
        )
        if (setRec && setRec.length > 0) {
          connectedNumberDigits = String(setRec[0].get('whatsapp_number') || '').replace(/\D/g, '')
          if (connectedNumberDigits.length === 10 || connectedNumberDigits.length === 11) {
            connectedNumberDigits = '55' + connectedNumberDigits
          }
        }
      } catch (_) {}
    }

    // Se o número resolvido é exatamente o número conectado, o webhook da Z-API não informou o cliente diretamente
    // nos campos primários. Nesse caso, buscamos o cliente ativo mais recente que nos enviou mensagem nos últimos 30 minutos!
    if (normalizedPhone && connectedNumberDigits && normalizedPhone === connectedNumberDigits) {
      try {
        const recentIncoming = $app.findRecordsByFilter(
          'webhook_received',
          "fromMe = false && phone != ''",
          '-created',
          1,
          0,
        )
        if (recentIncoming && recentIncoming.length > 0) {
          const incRec = recentIncoming[0]
          let incPhone = ''
          const pVal = incRec.get('phone')
          if (typeof pVal === 'string') incPhone = pVal
          else if (pVal && typeof pVal === 'object' && pVal.phone) incPhone = String(pVal.phone)
          const cleanInc = incPhone.replace(/\D/g, '')
          if (
            cleanInc &&
            cleanInc !== connectedNumberDigits &&
            cleanInc.length >= 10 &&
            cleanInc.length <= 13
          ) {
            normalizedPhone =
              cleanInc.length === 10 || cleanInc.length === 11 ? '55' + cleanInc : cleanInc
            console.log(
              '[WEBHOOK-FROM-ME-RESOLVED-FROM-RECENT-CHAT]',
              JSON.stringify({
                original: connectedNumberDigits,
                resolvedToClient: normalizedPhone.slice(0, 4) + '****' + normalizedPhone.slice(-2),
              }),
            )
          }
        }
      } catch (errRec) {
        console.log('[WEBHOOK-RESOLVE-CLIENT-ERR]', errRec.message || String(errRec))
      }
    }
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

  // ==========================================
  // DETECÇÃO DE MENSAGEM DE ÁUDIO
  // ==========================================
  let isAudio = false
  let rawAudioUrl = ''

  // 1. Verificar objeto body.audio (formato padrão Z-API: { audioUrl: '...', mimeType: '...', ptt: true })
  if (body.audio) {
    isAudio = true
    if (typeof body.audio === 'object' && body.audio !== null) {
      rawAudioUrl = String(
        body.audio.audioUrl || body.audio.url || body.audio.fileUrl || body.audio.link || '',
      )
    } else if (typeof body.audio === 'string') {
      rawAudioUrl = body.audio
    }
  }

  // 2. Verificar body.audioMessage
  if (!rawAudioUrl && body.audioMessage) {
    isAudio = true
    if (typeof body.audioMessage === 'object' && body.audioMessage !== null) {
      rawAudioUrl = String(
        body.audioMessage.audioUrl || body.audioMessage.url || body.audioMessage.fileUrl || '',
      )
    } else if (typeof body.audioMessage === 'string') {
      rawAudioUrl = body.audioMessage
    }
  }

  // 3. Verificar body.audioUrl direto
  if (!rawAudioUrl && body.audioUrl) {
    isAudio = true
    rawAudioUrl = String(body.audioUrl)
  }

  // 4. Verificar outros campos (type/messageType = 'audio' ou 'ptt' ou 'voice')
  const msgType = String(body.type || body.messageType || body.mediaType || '').toLowerCase()
  if (
    msgType === 'audio' ||
    msgType === 'ptt' ||
    msgType === 'voice' ||
    msgType === 'audiomessage'
  ) {
    isAudio = true
    if (!rawAudioUrl) {
      rawAudioUrl = String(body.fileUrl || body.mediaUrl || body.url || '')
    }
  }

  // 5. Verificar em body.data se veio aninhado (ex: body.data.message.audioMessage)
  if (body.data && typeof body.data === 'object') {
    const dataMsg = body.data.message || body.data
    if (dataMsg.audioMessage) {
      isAudio = true
      if (typeof dataMsg.audioMessage === 'object') {
        rawAudioUrl =
          rawAudioUrl || String(dataMsg.audioMessage.audioUrl || dataMsg.audioMessage.url || '')
      }
    }
  }

  // Extrair texto da mensagem (caso venha preenchido ou seja mensagem de texto)
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
      isAudio: isAudio,
      hasAudioUrl: Boolean(rawAudioUrl),
    }),
  )

  // 4. Seleção e validação estrita da configuração ativa (necessária para OpenAI key se for áudio)
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

  // ==========================================
  // TRANSCRIÇÃO DE ÁUDIO VIA WHISPER (SE FOR ÁUDIO E NÃO FOR FROM_ME)
  // ==========================================
  let transcriptionFailed = false
  let transcriptionError = ''

  if (isAudio && !isFromMe) {
    const openaiKey = validConfigRec ? String(validConfigRec.get('openai_api_key') || '') : ''

    if (!rawAudioUrl) {
      transcriptionFailed = true
      transcriptionError = 'URL do áudio não encontrada no payload do webhook'
      console.log(
        '[AUDIO-TRANSCRIPTION-ERROR]',
        JSON.stringify({
          messageId: messageId,
          error: transcriptionError,
          senderPhone: maskedSenderPhone,
        }),
      )
    } else if (!openaiKey) {
      transcriptionFailed = true
      transcriptionError = 'API key da OpenAI não configurada em settings'
      console.log(
        '[AUDIO-TRANSCRIPTION-ERROR]',
        JSON.stringify({
          messageId: messageId,
          error: transcriptionError,
          senderPhone: maskedSenderPhone,
        }),
      )
    } else {
      try {
        console.log(
          '[AUDIO-DOWNLOAD-START]',
          JSON.stringify({
            messageId: messageId,
            senderPhone: maskedSenderPhone,
          }),
        )

        // Baixar arquivo de áudio com timeout de 30s
        let audioFile = null
        try {
          audioFile = $filesystem.fileFromURL(rawAudioUrl, 30)
        } catch (downloadErr) {
          transcriptionFailed = true
          transcriptionError =
            'Falha ao baixar áudio da URL: ' + (downloadErr.message || String(downloadErr))
        }

        if (audioFile) {
          const MAX_WHISPER_SIZE = 25 * 1024 * 1024 // 25 MB limite Whisper
          const fileSize = audioFile.size || 0

          if (fileSize > MAX_WHISPER_SIZE) {
            transcriptionFailed = true
            transcriptionError =
              'Arquivo de áudio excede o limite de 25 MB do Whisper (' + fileSize + ' bytes)'
            console.log(
              '[AUDIO-TRANSCRIPTION-REJECTED-SIZE]',
              JSON.stringify({
                messageId: messageId,
                size: fileSize,
                limit: MAX_WHISPER_SIZE,
                senderPhone: maskedSenderPhone,
              }),
            )
          } else {
            // Garantir nome com extensão apropriada reconhecida pelo Whisper (.ogg, .mp3, etc.)
            let fileName = audioFile.name || 'audio.ogg'
            if (!fileName.includes('.')) {
              fileName = fileName + '.ogg'
            }

            // Preparar multipart form data
            const formData = new FormData()
            formData.append('model', 'whisper-1')
            formData.append('language', 'pt') // Otimizar para português
            formData.append('file', audioFile)

            console.log(
              '[AUDIO-WHISPER-CALL]',
              JSON.stringify({
                messageId: messageId,
                fileName: fileName,
                fileSize: fileSize,
                senderPhone: maskedSenderPhone,
              }),
            )

            const whisperRes = $http.send({
              url: 'https://api.openai.com/v1/audio/transcriptions',
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + openaiKey,
              },
              body: formData,
              timeout: 45,
            })

            if (whisperRes.statusCode >= 200 && whisperRes.statusCode < 300) {
              const parsed = whisperRes.json || {}
              const transcribedText = String(parsed.text || '').trim()

              if (transcribedText) {
                incomingText = transcribedText
                console.log(
                  '[AUDIO-TRANSCRIPTION-SUCCESS]',
                  JSON.stringify({
                    messageId: messageId,
                    senderPhone: maskedSenderPhone,
                    textLength: transcribedText.length,
                  }),
                )
              } else {
                transcriptionFailed = true
                transcriptionError = 'Whisper retornou texto vazio'
              }
            } else {
              transcriptionFailed = true
              const errBody = whisperRes.json || whisperRes.body || {}
              transcriptionError =
                'Whisper HTTP ' +
                whisperRes.statusCode +
                ': ' +
                (errBody.error
                  ? errBody.error.message || JSON.stringify(errBody.error)
                  : String(whisperRes.body || ''))
            }
          }
        }
      } catch (whisperEx) {
        transcriptionFailed = true
        transcriptionError =
          'Exceção na transcrição do áudio: ' + (whisperEx.message || String(whisperEx))
      }

      if (transcriptionFailed) {
        console.log(
          '[AUDIO-TRANSCRIPTION-FAILED]',
          JSON.stringify({
            messageId: messageId,
            senderPhone: maskedSenderPhone,
            error: transcriptionError,
          }),
        )
      }
    }
  }

  // ==========================================
  // DEDUPLICAÇÃO DE ECOS (fromMe = true)
  // ==========================================
  // Quando uma mensagem é enviada (pelo atendente via send-message / AgentSentMessage
  // ou pela IA via Z-API no ai_message_worker), a Z-API devolve um eco assíncrono
  // "ReceivedCallback" com fromMe=true e messageId diferente do original.
  // Para evitar duplicar a mensagem no chat e evitar que respostas da IA recebam badge de "Atendente RPA",
  // verificamos se este eco já existe:
  // (a) um webhook_received recente do mesmo telefone, fromMe=true, com o mesmo texto (últimos ~10 minutos); OU
  // (b) um message_processing recente do mesmo telefone cujo aiReplyText seja igual ao texto do eco.
  // Se existir qualquer um dos dois, NÃO gravamos o eco (return early sem persistir nada).
  if (isFromMe && normalizedPhone) {
    const trimmedIncoming = incomingText ? incomingText.trim() : ''
    const tenMinutesAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    // (a) Verificar se já existe webhook_received recente com mesmo telefone, fromMe=true e mesmo texto
    let isDuplicateWebhook = false
    try {
      const recentFromMeList = $app.findRecordsByFilter(
        'webhook_received',
        'fromMe = true && created >= {:cutoff}',
        '-created',
        30,
        0,
        { cutoff: tenMinutesAgoIso },
      )

      for (let i = 0; i < recentFromMeList.length; i++) {
        const item = recentFromMeList[i]
        // Se for o mesmíssimo messageId (já persistido), é duplicação direta
        if (messageId && item.getString('messageId') === messageId) {
          isDuplicateWebhook = true
          break
        }

        // Comparar telefone
        let itemPhone = ''
        const pVal = item.get('phone')
        if (typeof pVal === 'string') itemPhone = pVal
        else if (pVal && typeof pVal === 'object')
          itemPhone = String(pVal.phone || pVal.number || '')
        const itemDigits = itemPhone.replace(/\D/g, '')
        const normItemDigits =
          itemDigits.length === 10 || itemDigits.length === 11 ? '55' + itemDigits : itemDigits

        if (normItemDigits === normalizedPhone) {
          // Comparar texto
          let itemText = ''
          const tVal = item.get('text')
          if (typeof tVal === 'string') itemText = tVal
          else if (tVal && typeof tVal === 'object') {
            itemText = String(tVal.message || tVal.text || tVal.conversation || '')
          }
          if (trimmedIncoming && itemText.trim() === trimmedIncoming) {
            isDuplicateWebhook = true
            break
          }
        }
      }
    } catch (checkWhErr) {
      console.log('[WEBHOOK-DEDUP-CHECK-WH-ERR]', checkWhErr.message || String(checkWhErr))
    }

    if (isDuplicateWebhook) {
      console.log(
        '[WEBHOOK-ECHO-DEDUPLICATED-AGENT]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          phone: maskedSenderPhone,
          messageId: messageId,
          textSample: trimmedIncoming.slice(0, 40),
          reason: 'Duplicate of recent fromMe webhook_received (e.g. AgentSentMessage)',
        }),
      )
      return e.json(200, { status: 'ignored_duplicate_echo' })
    }

    // (b) Verificar se já existe message_processing recente cujo aiReplyText seja igual ao texto do eco
    let isDuplicateAiReply = false
    try {
      const recentAiList = $app.findRecordsByFilter(
        'message_processing',
        'replySent = true && created >= {:cutoff}',
        '-created',
        20,
        0,
        { cutoff: tenMinutesAgoIso },
      )

      for (let j = 0; j < recentAiList.length; j++) {
        const aiItem = recentAiList[j]
        const aiPhoneDigits = String(aiItem.getString('phone') || '').replace(/\D/g, '')
        const normAiPhone =
          aiPhoneDigits.length === 10 || aiPhoneDigits.length === 11
            ? '55' + aiPhoneDigits
            : aiPhoneDigits

        if (normAiPhone === normalizedPhone) {
          const aiReply = String(aiItem.getString('aiReplyText') || '').trim()
          if (trimmedIncoming && aiReply === trimmedIncoming) {
            isDuplicateAiReply = true
            break
          }
        }
      }
    } catch (checkAiErr) {
      console.log('[WEBHOOK-DEDUP-CHECK-AI-ERR]', checkAiErr.message || String(checkAiErr))
    }

    if (isDuplicateAiReply) {
      console.log(
        '[WEBHOOK-ECHO-DEDUPLICATED-AI]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          phone: maskedSenderPhone,
          messageId: messageId,
          textSample: trimmedIncoming.slice(0, 40),
          reason: 'Duplicate of recent AI reply in message_processing',
        }),
      )
      return e.json(200, { status: 'ignored_duplicate_ai_echo' })
    }
  }

  // 2. Persistir na collection webhook_received (para rastreabilidade/auditoria)
  try {
    if (normalizedPhone) {
      const colWebhook = $app.findCollectionByNameOrId('webhook_received')
      const rec = new Record(colWebhook)
      rec.set('type', eventType || 'ReceivedCallback')
      rec.set('phone', { phone: normalizedPhone })
      rec.set('fromMe', isFromMe)
      rec.set('text', body.text || { message: incomingText })
      rec.set('chat', { phone: normalizedPhone })
      // Se for fromMe vindo do celular do atendente, marcar explicitamente role: 'agent'
      if (isFromMe) {
        rec.set('sender', body.sender || { role: 'agent', source: 'mobile_whatsapp' })
      } else {
        rec.set('sender', body.sender || null)
      }
      rec.set('status', String(body.status || (isFromMe ? 'SENT' : 'RECEIVED')))
      rec.set('messageId', messageId)
      rec.set('instanceId', rawInstanceId)
      rec.set('moment', Number(body.moment) || Math.floor(Date.now() / 1000))
      rec.set('is_audio', isAudio)
      if (rawAudioUrl) {
        rec.set('audio_url', rawAudioUrl)
      }
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

  // ==========================================
  // AUTO-CRIAÇÃO DE CLIENTE NO CRM (WHATSAPP LEAD)
  // ==========================================
  // Se o número de telefone de uma mensagem recebida de cliente (!isFromMe) ainda não tem cliente
  // cadastrado no banco, cria automaticamente o registro de cliente usando:
  // - Nome: o próprio número como nome provisório (a IA no worker tentará detectar se o cliente se apresentar)
  // - Telefone: o número normalizado
  // - Nota: 'Lead originado pelo WhatsApp'
  // - pipeline_status: 'novo_lead'
  // Se o número já existir, apenas reaproveita — nunca duplica.
  if (
    !isFromMe &&
    normalizedPhone &&
    normalizedPhone.length >= 10 &&
    normalizedPhone.length <= 13
  ) {
    try {
      const cleanDigits = normalizedPhone.replace(/\D/g, '')
      let withoutDdi = cleanDigits
      if (withoutDdi.startsWith('55') && withoutDdi.length >= 12) {
        withoutDdi = withoutDdi.slice(2)
      }

      let existingCustomer = null
      try {
        const matchingCustomers = $app.findRecordsByFilter(
          'customers',
          'phone ~ {:p1} || phone ~ {:p2}',
          '-created',
          1,
          0,
          { p1: cleanDigits, p2: withoutDdi },
        )
        if (matchingCustomers && matchingCustomers.length > 0) {
          existingCustomer = matchingCustomers[0]
        }
      } catch (_) {}

      if (!existingCustomer) {
        const custCol = $app.findCollectionByNameOrId('customers')
        const newCust = new Record(custCol)
        newCust.set('name', normalizedPhone)
        newCust.set('phone', normalizedPhone)
        newCust.set('notes', 'Lead originado pelo WhatsApp')
        newCust.set('type', 'PF')
        newCust.set('pipeline_status', 'novo_lead')
        newCust.set('lead_source', 'whatsapp')
        $app.save(newCust)

        console.log(
          '[CUSTOMER-AUTO-CREATED-WEBHOOK]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            customerId: newCust.id,
            phone: maskedSenderPhone,
            messageId: messageId,
          }),
        )
      }
    } catch (autoCustErr) {
      console.log(
        '[CUSTOMER-AUTO-CREATE-ERROR]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          error: autoCustErr.message || String(autoCustErr),
          phone: maskedSenderPhone,
        }),
      )
    }
  }

  // 3. Validações de segurança e regras para enfileiramento na message_processing  // Regra: Ignorar mensagens enviadas pelo próprio bot (fromMe=true)
  if (isFromMe) {
    return e.json(200, { status: 'ignored_from_me' })
  }

  // Regra: Sem telefone real válido (não enfileirar @lid nem número fantasma para IA)
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 13) {
    return e.json(200, { status: 'ignored_invalid_phone_or_lid' })
  }

  // Regra: Somente mensagens de texto (ou áudio com texto transcrito com sucesso)
  if (!incomingText || typeof incomingText !== 'string' || !incomingText.trim()) {
    if (isAudio && transcriptionFailed) {
      return e.json(200, {
        status: 'audio_transcription_failed',
        error: transcriptionError,
      })
    }
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

  // Validação das configurações da Z-API
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
      rec.set('is_audio', isAudio)
      if (rawAudioUrl) {
        rec.set('audio_url', rawAudioUrl)
      }
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
      rec.set('is_audio', isAudio)
      if (rawAudioUrl) {
        rec.set('audio_url', rawAudioUrl)
      }
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
    transcribed: isAudio,
  })
})
