// Cron leve a cada 2 minutos para verificar encerramento automático de atendimentos humanos por inatividade.
// PocketBase JSVM isola os escopos de cada callback, portanto toda lógica é autocontida aqui dentro.
cronAdd('backfill_chat_summaries_job', '*/1 * * * *', () => {
  try {
    const s = $app.findFirstRecordByFilter('settings', "id != ''")
    if (s && s.get('chat_summaries_migrated')) {
      return // Migração já concluída
    }

    const computeCanonicalPhone = (p) => {
      if (!p) return ''
      const str = String(p).trim()
      if (str.toLowerCase().includes('@lid')) return ''
      const digits = str.replace(/\D/g, '')
      if (!digits || digits.length >= 14) return ''
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        return digits.slice(2)
      }
      return digits
    }

    // Carregar mapa de leituras
    const readStatesMap = new Map()
    try {
      const readRecords = $app.findRecordsByFilter('whatsapp_read_states', '', '-created', 10000, 0)
      for (let r = 0; r < readRecords.length; r++) {
        const rec = readRecords[r]
        const rPhone = rec.getString('phone')
        const rLastRead = Number(rec.get('lastReadAt')) || 0
        const cKey = computeCanonicalPhone(rPhone)
        if (cKey && rLastRead > 0) {
          readStatesMap.set(cKey, rLastRead)
        }
      }
    } catch (_) {}

    const existingSummariesSet = new Set()
    try {
      let existingSums = []
      try {
        existingSums = $app.findRecordsByFilter('chat_summaries', '', '-last_message_at', 10000, 0)
      } catch (_) {
        existingSums = $app.findRecordsByFilter('chat_summaries', '', '', 10000, 0)
      }
      for (let j = 0; j < existingSums.length; j++) {
        const cPhone = existingSums[j].getString('canonical_phone')
        if (cPhone) existingSummariesSet.add(cPhone)
      }
    } catch (_) {}

    const convMap = new Map()
    let page = 1
    const batchSize = 1000

    while (true) {
      let records = []
      try {
        records = $app.findRecordsByFilter(
          'webhook_received',
          '',
          'created',
          batchSize,
          (page - 1) * batchSize,
        )
      } catch (eBatch) {
        break
      }
      if (!records || records.length === 0) break

      for (let i = 0; i < records.length; i++) {
        const rec = records[i]
        let rawPhone = ''
        try {
          const p = rec.get('phone')
          if (typeof p === 'string') rawPhone = p
          else if (p && typeof p === 'object' && p.phone) rawPhone = String(p.phone)
        } catch (_) {}
        if (!rawPhone) {
          try {
            const ch = rec.get('chat')
            if (typeof ch === 'string') rawPhone = ch
            else if (ch && typeof ch === 'object' && ch.phone) rawPhone = String(ch.phone)
          } catch (_) {}
        }
        if (!rawPhone) {
          try {
            const sp = rec.get('sender')
            if (typeof sp === 'string') rawPhone = sp
            else if (sp && typeof sp === 'object' && sp.phone) rawPhone = String(sp.phone)
          } catch (_) {}
        }

        const canonicalPhone = computeCanonicalPhone(rawPhone)
        if (!canonicalPhone || canonicalPhone.length < 8) continue
        if (existingSummariesSet.has(canonicalPhone)) continue

        let conv = convMap.get(canonicalPhone)
        if (!conv) {
          conv = {
            canonicalPhone,
            rawPhone: rawPhone || canonicalPhone,
            firstMessageAt: '',
            lastMessageAt: '',
            lastMessagePreview: '',
            lastMessageDirection: 'inbound',
            lastMessageId: '',
            unreadCount: 0,
            temMensagens: true,
            lastSeenIds: [],
          }
          convMap.set(canonicalPhone, conv)
        }

        const msgId = String(rec.getString('messageId') || rec.id || '').trim()
        const isFromMe = Boolean(rec.get('fromMe'))
        const direction = isFromMe ? 'outbound' : 'inbound'

        let msgDate
        const momentVal = Number(rec.get('moment'))
        if (momentVal && momentVal > 0) {
          msgDate = new Date(momentVal * 1000)
        } else {
          const createdStr = rec.getString('created') || rec.created
          msgDate = createdStr ? new Date(createdStr) : new Date()
        }
        const msgDateIso = !isNaN(msgDate.getTime())
          ? msgDate.toISOString()
          : new Date().toISOString()
        const msgDateTime = msgDate.getTime()

        if (!conv.firstMessageAt) {
          conv.firstMessageAt = msgDateIso
        }

        let text = ''
        try {
          const rawText = rec.getString('text') || ''
          if (rawText) {
            try {
              const parsed = JSON.parse(rawText)
              if (parsed && typeof parsed === 'object') {
                text = String(parsed.message || parsed.text || parsed.conversation || '')
              } else if (typeof parsed === 'string') {
                text = parsed
              }
            } catch (_) {
              text = rawText
            }
          }
          if (!text) {
            const textVal = rec.get('text')
            if (typeof textVal === 'string') text = textVal
            else if (textVal && typeof textVal === 'object') {
              text = String(textVal.message || textVal.text || textVal.conversation || '')
            }
          }
        } catch (_) {}
        const textStr = String(text || '').trim()

        const isAudio = Boolean(rec.get('is_audio')) || Boolean(rec.get('audio_url'))
        const attachType = String(rec.getString('attachment_type') || '').toLowerCase()
        const attachUrl = String(rec.getString('attachment_url') || '').trim()

        let preview = 'Mensagem'
        if (isAudio) {
          preview = '🎤 Áudio'
        } else if (
          attachType === 'image' ||
          (!attachType && attachUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(attachUrl))
        ) {
          preview = textStr ? `📷 Foto: ${textStr}` : '📷 Foto'
        } else if (
          attachType === 'video' ||
          (!attachType && attachUrl && /\.(mp4|mov|avi|mkv)/i.test(attachUrl))
        ) {
          preview = textStr ? `🎥 Vídeo: ${textStr}` : '🎥 Vídeo'
        } else if (attachType === 'audio') {
          preview = '🎤 Áudio'
        } else if (attachType === 'document' || attachUrl) {
          const attachName = String(rec.getString('attachment_name') || '').trim()
          preview = attachName ? `📄 Documento: ${attachName}` : '📄 Documento'
        } else if (textStr) {
          const lower = textStr.toLowerCase()
          if (lower.includes('figurinha') || lower.includes('sticker')) preview = '💟 Figurinha'
          else if (
            lower.includes('localização') ||
            lower.includes('localizacao') ||
            lower.includes('maps.google')
          )
            preview = '📍 Localização'
          else if (lower.includes('contato:') || lower.includes('vcard')) preview = '👤 Contato'
          else preview = textStr.length > 90 ? textStr.slice(0, 90) + '...' : textStr
        }

        const prevLastTime = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0
        if (msgDateTime >= prevLastTime) {
          conv.lastMessageAt = msgDateIso
          conv.lastMessagePreview = preview
          conv.lastMessageDirection = direction
          conv.lastMessageId = msgId
        }

        if (msgId && !conv.lastSeenIds.includes(msgId)) {
          conv.lastSeenIds.push(msgId)
          if (conv.lastSeenIds.length > 50) {
            conv.lastSeenIds = conv.lastSeenIds.slice(-50)
          }
        }

        const lastRead = readStatesMap.get(canonicalPhone)
        if (direction === 'inbound') {
          if (typeof lastRead === 'number' && lastRead > 0) {
            if (msgDateTime > lastRead) {
              conv.unreadCount += 1
            }
          } else {
            conv.unreadCount = 0
          }
        }
      }

      if (records.length < batchSize) break
      page++
    }

    const summaryCol = $app.findCollectionByNameOrId('chat_summaries')
    let createdCount = 0

    convMap.forEach((conv, canonicalPhone) => {
      if (existingSummariesSet.has(canonicalPhone)) return

      try {
        const newRec = new Record(summaryCol)
        newRec.set('canonical_phone', conv.canonicalPhone)
        newRec.set('raw_phone', conv.rawPhone)
        newRec.set('last_message_preview', conv.lastMessagePreview || 'Mensagem')
        newRec.set('last_message_direction', conv.lastMessageDirection)
        newRec.set('last_message_at', conv.lastMessageAt || new Date().toISOString())
        newRec.set(
          'first_message_at',
          conv.firstMessageAt || conv.lastMessageAt || new Date().toISOString(),
        )
        newRec.set('unread_count', conv.unreadCount || 0)
        newRec.set('tem_mensagens', true)
        newRec.set('last_message_id', conv.lastMessageId)
        newRec.set('last_seen_message_ids', conv.lastSeenIds)
        $app.save(newRec)
        createdCount++
      } catch (saveErr) {
        console.log('[BACKFILL-CRON-SAVE-ERR]', canonicalPhone, saveErr.message || String(saveErr))
      }
    })

    if (s) {
      s.set('chat_summaries_migrated', true)
      $app.save(s)
      console.log(
        `[BACKFILL-CRON] Concluído com sucesso: ${createdCount} resumos criados em chat_summaries.`,
      )
    }
  } catch (err) {
    console.log('[BACKFILL-CRON-ERR]', err.message || String(err))
  }
})

cronAdd('ai_human_chat_auto_close_cron', '*/2 * * * *', () => {
  try {
    const validConfigs = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      1,
      0,
    )
    if (!validConfigs || validConfigs.length === 0) return
    const validConfigRec = validConfigs[0]

    const autoCloseMin = Number(validConfigRec.get('ai_auto_close_minutes')) || 0
    if (autoCloseMin <= 0) return // 0 = desativado

    const autoCloseMsg =
      String(validConfigRec.getString('ai_auto_close_message') || '').trim() ||
      'Atendimento encerrado por inatividade. Se precisar de algo, me chame aqui que continuo te ajudando! 🙂'

    const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
    const zapiToken = String(validConfigRec.get('zapi_token') || '')
    const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

    const activeHumanControls = $app.findRecordsByFilter(
      'chat_control',
      'human_mode = true',
      '-updated',
      50,
      0,
    )

    if (!activeHumanControls || activeHumanControls.length === 0) return

    const nowMs = Date.now()
    const timeoutMs = autoCloseMin * 60 * 1000

    for (let hci = 0; hci < activeHumanControls.length; hci++) {
      const ctrl = activeHumanControls[hci]
      const ctrlPhone = ctrl.getString('phone')
      if (!ctrlPhone) continue

      // Encontrar última interação (cliente OU atendente)
      let lastInteractionTimeMs = 0
      try {
        const cleanP = ctrlPhone.replace(/'/g, "\\'")
        const lastMsgs = $app.findRecordsByFilter(
          'webhook_received',
          "phone.phone = '" + cleanP + "' || chat.phone = '" + cleanP + "'",
          '-created',
          1,
          0,
        )
        if (lastMsgs && lastMsgs.length > 0) {
          const dt = new Date(lastMsgs[0].getString('created') || lastMsgs[0].created)
          if (!isNaN(dt.getTime())) {
            lastInteractionTimeMs = dt.getTime()
          }
        }
      } catch (_) {}

      if (!lastInteractionTimeMs) {
        const ctrlUp = new Date(ctrl.getString('updated') || ctrl.updated)
        if (!isNaN(ctrlUp.getTime())) {
          lastInteractionTimeMs = ctrlUp.getTime()
        }
      }

      const elapsedMs = nowMs - lastInteractionTimeMs
      if (elapsedMs >= timeoutMs) {
        console.log(
          '[AUTO-CLOSE-TRIGGERED]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: ctrlPhone.slice(0, 4) + '****' + ctrlPhone.slice(-2),
            elapsedMinutes: Math.round(elapsedMs / 60000),
            timeoutMinutes: autoCloseMin,
          }),
        )

        // 1. Enviar aviso de encerramento via Z-API ao cliente
        if (zapiInstance && zapiToken && zapiClientToken) {
          try {
            $http.send({
              url:
                'https://api.z-api.io/instances/' +
                encodeURIComponent(zapiInstance) +
                '/token/' +
                encodeURIComponent(zapiToken) +
                '/send-text',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Client-Token': zapiClientToken,
              },
              body: JSON.stringify({
                phone: ctrlPhone,
                message: autoCloseMsg,
              }),
              timeout: 10,
            })
          } catch (sendCloseErr) {
            console.log('[AUTO-CLOSE-SEND-ERR]', String(sendCloseErr))
          }
        }

        // Gravar aviso em webhook_received como fromMe=true para constar no chat sem apagar nada
        try {
          const colW = $app.findCollectionByNameOrId('webhook_received')
          const recW = new Record(colW)
          recW.set('type', 'AgentSentMessage')
          recW.set('phone', { phone: ctrlPhone })
          recW.set('fromMe', true)
          recW.set('text', { message: autoCloseMsg })
          recW.set('chat', { phone: ctrlPhone })
          recW.set('sender', { role: 'agent' })
          recW.set('status', 'SENT')
          recW.set('messageId', 'autoclose_' + Date.now() + '_' + $security.randomString(6))
          recW.set('moment', Math.floor(Date.now() / 1000))
          $app.save(recW)
        } catch (_) {}

        // 2. Reativar a IA (human_mode = false) LIMPANDO a marcação de motivo (paused_by)
        ctrl.set('human_mode', false)
        ctrl.set('paused_by', '')
        $app.save(ctrl)

        console.log(
          '[AUTO-CLOSE-COMPLETED]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: ctrlPhone.slice(0, 4) + '****' + ctrlPhone.slice(-2),
            human_mode: false,
            paused_by_cleared: true,
          }),
        )
      }
    }
  } catch (err) {
    console.log('[AUTO-CLOSE-GLOBAL-ERR]', String(err))
  }
})

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

  // Execução de checagem defensiva de auto-close para este telefone específico (se estava em modo humano)
  // protegida por try/catch absoluto para que QUALQUER falha nunca derrube o processamento da mensagem.
  try {
    const autoCloseMin = Number(validConfigRec.get('ai_auto_close_minutes')) || 0
    if (autoCloseMin > 0 && phone) {
      let thisChatCtrl = null
      try {
        const foundCtrl = $app.findRecordsByFilter(
          'chat_control',
          'phone = {:p} && human_mode = true',
          '-updated',
          1,
          0,
          { p: phone },
        )
        if (foundCtrl && foundCtrl.length > 0) {
          thisChatCtrl = foundCtrl[0]
        }
      } catch (_) {}

      if (thisChatCtrl) {
        const ctrlUp = new Date(thisChatCtrl.getString('updated') || thisChatCtrl.updated)
        const ctrlTime = !isNaN(ctrlUp.getTime()) ? ctrlUp.getTime() : 0
        const elapsedMin = ctrlTime > 0 ? (Date.now() - ctrlTime) / 60000 : 999
        if (elapsedMin >= autoCloseMin) {
          thisChatCtrl.set('human_mode', false)
          thisChatCtrl.set('paused_by', '')
          $app.save(thisChatCtrl)
          console.log(
            '[AUTO-CLOSE-INLINE-RESOLVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              phone: maskedPhone,
              elapsedMin: Math.round(elapsedMin),
              human_mode: false,
            }),
          )
        }
      }
    }
  } catch (autoCloseErr) {
    console.log('[AUTO-CLOSE-SAFE-IGNORED]', String(autoCloseErr))
  }

  // Blindagem estrita de allowlist: com a IA LIGADA, ela responde APENAS ao telefone de teste
  // autorizado gravado em settings (authorized_test_phone) e a NINGUÉM mais.
  // Mensagens de outros números são ignoradas (registradas no log como ignoradas, sem resposta,
  // sem gastar tokens da OpenAI ou provedor).
  const cleanPhoneDigits = String(phone || '').replace(/\D/g, '')
  const cleanAuthPhoneDigits = String(authorizedPhone || '').replace(/\D/g, '')

  // Comparação tolerante com ou sem DDI 55
  const phoneWithoutDdi =
    cleanPhoneDigits.startsWith('55') && cleanPhoneDigits.length >= 12
      ? cleanPhoneDigits.slice(2)
      : cleanPhoneDigits
  const authWithoutDdi =
    cleanAuthPhoneDigits.startsWith('55') && cleanAuthPhoneDigits.length >= 12
      ? cleanAuthPhoneDigits.slice(2)
      : cleanAuthPhoneDigits

  const isAuthorizedNumber =
    Boolean(cleanAuthPhoneDigits) &&
    (cleanPhoneDigits === cleanAuthPhoneDigits || phoneWithoutDdi === authWithoutDdi)

  if (!isAuthorizedNumber) {
    console.log(
      '[UNAUTHORIZED-PHONE-IGNORED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        reason: 'Phone not in authorized_test_phone allowlist while AI is enabled',
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'Phone not authorized (allowlist active)')
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

  // 4.1 Identificação do cliente pelo telefone canônico para saudação personalizada
  let identifiedCustomerName = ''
  try {
    const cleanDigits = String(phone || '').replace(/\D/g, '')
    let noDdi = cleanDigits
    if (noDdi.startsWith('55') && noDdi.length >= 12) {
      noDdi = noDdi.slice(2)
    }
    const foundCusts = $app.findRecordsByFilter(
      'customers',
      'phone ~ {:p1} || phone ~ {:p2}',
      '-created',
      1,
      0,
      { p1: cleanDigits, p2: noDdi },
    )
    if (foundCusts && foundCusts.length > 0) {
      const rawName = String(foundCusts[0].getString('name') || '').trim()
      const isDigitsOrPhone = /^[0-9+\s()-]+$/.test(rawName) || rawName === phone
      if (rawName && !isDigitsOrPhone) {
        // Usa o primeiro nome ou nome curto caso seja longo
        const firstName = rawName.split(/\s+/)[0]
        identifiedCustomerName = firstName || rawName
      }
    }
  } catch (custIdentErr) {
    console.log('[CUSTOMER-IDENT-ERR]', custIdentErr.message || String(custIdentErr))
  }

  // 5. Verificar se é a primeira resposta da IA na conversa para este telefone
  let isFirstAiReplyInConversation = false
  try {
    const cleanP = String(phone || '').replace(/'/g, "\\'")
    const prevReplies = $app.findRecordsByFilter(
      'message_processing',
      "phone = '" + cleanP + "' && replySent = true && id != '" + recordId + "'",
      '-created',
      1,
      0,
    )
    if (!prevReplies || prevReplies.length === 0) {
      isFirstAiReplyInConversation = true
    }
  } catch (firstReplyCheckErr) {
    console.log('[FIRST-REPLY-CHECK-ERR]', String(firstReplyCheckErr))
  }

  let greetingInstruction = ''
  if (identifiedCustomerName) {
    greetingInstruction =
      '\n\n[IDENTIFICAÇÃO DO CLIENTE]\n' +
      'O cliente está cadastrado e seu nome é "' +
      identifiedCustomerName +
      '".\n' +
      (isFirstAiReplyInConversation
        ? 'Esta é a sua primeira resposta nesta conversa: cumprimente o cliente obrigatoriamente pelo nome ("Oi, ' +
          identifiedCustomerName +
          '!" ou "Olá, ' +
          identifiedCustomerName +
          '!") e apresente-se como assistente da RPA AUTO PARTS antes de responder.'
        : 'Como o cliente se chama ' +
          identifiedCustomerName +
          ', mantenha o tratamento amigável e dirija-se a ele pelo nome quando fizer sentido.')
  } else {
    greetingInstruction = isFirstAiReplyInConversation
      ? '\n\nEsta é a sua primeira resposta nesta conversa: cumprimente o cliente e apresente-se como assistente da RPA AUTO PARTS antes de responder.'
      : ''
  }

  const firstReplyInstruction = greetingInstruction

  // 6. Configurar systemPrompt a partir de settings ou fallback mínimo cordial
  let configuredPrompt = String(validConfigRec.getString('ai_system_prompt') || '').trim()
  if (configuredPrompt) {
    configuredPrompt = configuredPrompt
      .replace(/NUNCA informe valor ou pre[çc]o ao cliente.*?transferir para atendente/gi, '')
      .replace(/NUNCA passe valor ou pre[çc]o.*?atendente humano/gi, '')
      .replace(/\[REGRA CR[ÍI]TICA DE PRE[ÇC]OS E ESTOQUE\][\s\S]*?(?=\n\n|$)/gi, '')
      .trim()
  }

  const fallbackPrompt =
    'Você é o assistente virtual da RPA AUTO PARTS, especializada em peças automotivas. ' +
    'Seja cordial, objetivo e atencioso. ' +
    'NÃO invente preços, estoque, prazos ou especificações técnicas.'

  // Meios de pagamento configurados
  const paymentMethodsConfig = String(validConfigRec.getString('ai_payment_methods') || '').trim()
  const effectivePaymentMethods =
    paymentMethodsConfig.length > 0
      ? paymentMethodsConfig
      : 'Pagamento via link enviado no orçamento'

  // Regras de ferramentas, preços, estoque, apresentação das opções, disponibilidade e fluxo de interesse de compra
  const toolsAndPriceRules =
    '\n\n[FERRAMENTAS DE CONSULTA E REGRAS DE PREÇO/ESTOQUE/DISPONIBILIDADE]\n' +
    'Você possui ferramentas (function calling) para buscar produtos no catálogo e consultar estoque em tempo real:\n' +
    '1. buscar_produtos: use sempre que o cliente perguntar sobre qualquer peça, modelo, bucha, amortecedor, aplicação automotiva ou SKU. ' +
    'Pesquise por termos-chave relevantes (ex: "bucha d21", "amortecedor d21", "bucha facão ix35", SKU ou código de barras).\n' +
    '2. consultar_estoque_ao_vivo: use para obter o estoque atualizado em tempo real caso tenha o SKU do produto.\n' +
    "3. REGRA CRÍTICA DE APRESENTAÇÃO: Quando a busca encontrar produtos, SEMPRE cite as opções encontradas na resposta, com o nome completo (incluindo a faixa de anos, ex.: '88/97') e a descrição/aplicação de cada uma — mesmo quando estiverem com estoque 0 ou com preço 0. Produtos com estoque 0 NÃO devem ser omitidos nem marcados como indisponíveis. Se faltar informação essencial (ano/modelo do veículo, qual peça ou posição), pergunte ao cliente antes de buscar — nunca chute. Cumprimente o cliente na primeira mensagem da conversa.\n" +
    'FORMATO OBRIGATÓRIO para apresentar produtos: apresente CADA produto em bloco separado, com linha em branco entre eles, usando este modelo —\n' +
    "'1. *Nome completo do produto (com a faixa de anos)*\n" +
    "Marca: X | Valor: R$ 160,00 (ou 'Sob consulta') | Disponibilidade: disponível em até 48 horas (ou '6 un.')'.\n" +
    'Máximo de 3 produtos por mensagem; se houver mais, apresente os 3 mais relevantes e diga que há outras opções. Nunca escreva dois produtos na mesma linha. Separe a resposta em: lista de produtos, e depois UMA frase de fechamento ou pergunta.\n' +
    '4. TABELA DE DISPONIBILIDADE E PREÇOS (OBRIGATÓRIO):\n' +
    '- Estoque 0 (ou sem estoque): NUNCA use a palavra "indisponível" ou "sem estoque". Responda sempre: "disponível em até 48 horas" (pedido sob encomenda). O preço de venda deve ser informado normalmente se price > 0;\n' +
    '- Preço 0 ou sem preço: informe "Sob consulta" no lugar do valor;\n' +
    '- Caso composto (Preço 0 E Estoque 0): os dois avisos saem juntos: "Sob consulta" e "disponível em até 48 horas";\n' +
    '- Estoque > 0 e Preço > 0: informe o preço em R$ e a quantidade (ex.: "6 un.");\n' +
    '- REGRA PERMANENTE: É PROIBIDO USAR A PALAVRA "indisponível" EM QUALQUER RESPOSTA.\n' +
    '5. FLUXO DE INTERESSE DE COMPRA (Gatilho -> Coleta -> Confirmação -> Handoff):\n' +
    '- GATILHO: Dispare APENAS quando o cliente declarar expressamente a intenção de comprar/fechar (ex.: "quero o item 1 e 2", "vou ficar com o 1", "fechar", "me manda", "quero levar"). Perguntas de curiosidade ou mera cotação de preço ("quanto custa?", "tem?") NÃO disparam este fluxo.\n' +
    '- COLETA: Ao detectar intenção declarada de compra, confirme quais itens o cliente quer (citando o nome e a aplicação), pergunte a quantidade de cada item e confirme se a aplicação/ano do veículo está correto. Você tem no MÁXIMO 2 rodadas de perguntas para coletar essas informações caso ainda não tenham sido ditas.\n' +
    '- CONFIRMAÇÃO FINAL: Antes do handoff para a equipe, envie UMA confirmação final resumindo os itens + quantidade + aplicação coletados, iniciando obrigatoriamente por: "Só confirmando: ..." (ex.: "Só confirmando: item 1 (Bucha Diant Freelander 2 06/15) - 2 unidades, para Freelander 2 ano 2011."). Essa confirmação não conta no limite das 2 rodadas.\n' +
    '- HANDOFF: Assim que o cliente confirmar o resumo final (ou se a intenção e os dados já estiverem todos claros na mesma mensagem), transfira para a equipe de atendimento humano: responda exatamente incluindo a mensagem "Estou passando para uma atendente, ela retorna em instantes com preço e disponibilidade" e adicione no final da sua resposta o marcador [INTERESSE-COMPRA: itens=<descreva os itens>, qtd=<quantidades>, app=<aplicacao/veiculo>] seguido de [TRANSFERIR-HUMANO]. O marcador acionará a criação/atualização do card na coluna Lead do Pipeline e a transferência humana.\n' +
    '6. MEIOS DE PAGAMENTO: Ao perguntarem sobre como pagar, formas de pagamento, parcelamento ou condições comerciais, responda com: "' +
    effectivePaymentMethods.replace(/"/g, "'") +
    '".\n' +
    '7. REGRA DE NÃO AUTO-TRANSFERÊNCIA: Você NÃO deve transferir para atendimento humano apenas porque o cliente perguntou preço ou estoque. Responda com os dados das ferramentas e continue o atendimento normalmente. O marcador [TRANSFERIR-HUMANO] é estritamente reservado para a conclusão do fluxo de interesse de compra, pedido expresso de atendente pelo cliente, ou reclamações graves.'

  const effectiveSystemPrompt =
    (configuredPrompt.length > 0 ? configuredPrompt : fallbackPrompt) +
    firstReplyInstruction +
    toolsAndPriceRules +
    timeContextLine
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

  // ==========================================
  // DETECÇÃO AUTOMÁTICA DE NOME DO CLIENTE PELA IA / REFINAMENTO DE CADASTRO
  // ==========================================
  // Verifica se o cliente já está cadastrado ou precisa ser criado / ter o nome atualizado.
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

    const nowIsoWorker = new Date().toISOString()
    // Se o cliente não existir (por exemplo se a mensagem foi enfileirada diretamente), cria agora
    if (!customerRecord) {
      try {
        const custCol = $app.findCollectionByNameOrId('customers')
        customerRecord = new Record(custCol)
        customerRecord.set('name', phone) // nome provisório
        customerRecord.set('phone', phone)
        customerRecord.set('notes', 'Lead originado pelo WhatsApp')
        customerRecord.set('type', 'PF')
        customerRecord.set('pipeline_status', 'novo_lead')
        customerRecord.set('first_message_at', nowIsoWorker)
        customerRecord.set('last_interaction_at', nowIsoWorker)
        $app.save(customerRecord)
      } catch (createErr) {
        console.log('[AI-WORKER-CUSTOMER-CREATE-ERR]', createErr.message || String(createErr))
      }
    } else {
      // Se já existe e não tem pipeline_status e não está excluído, define novo_lead e atualiza timestamps
      const isCustDeleted = Boolean(customerRecord.get('deleted'))
      if (!isCustDeleted) {
        let custNeedsSave = false
        const curStatus = String(customerRecord.getString('pipeline_status') || '').trim()
        if (!curStatus) {
          customerRecord.set('pipeline_status', 'novo_lead')
          custNeedsSave = true
        }
        if (!customerRecord.getString('first_message_at')) {
          customerRecord.set('first_message_at', nowIsoWorker)
          custNeedsSave = true
        }
        customerRecord.set('last_interaction_at', nowIsoWorker)
        custNeedsSave = true

        if (custNeedsSave) {
          try {
            $app.save(customerRecord)
          } catch (_) {}
        }
      }
    }

    // Se o nome atual do cliente for provisório (apenas dígitos numéricos ou igual ao telefone)
    // tenta extrair da mensagem se o cliente se apresentou (ex: "Meu nome é Lucas", "Aqui é o Marcos", "Sou a Renata")
    if (customerRecord) {
      const currentCustName = String(customerRecord.getString('name') || '').trim()
      const isDigitsOnly = /^[0-9+\s()-]+$/.test(currentCustName)

      if (isDigitsOnly || currentCustName === phone) {
        // 1. Tentar extração rápida via regex em português
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
            // Evitar falsos positivos com palavras comuns
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
              // Capitalizar nome
              detectedName = rawCandidate
                .split(/\s+/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ')
              break
            }
          }
        }

        // Se regex não pegou, mas o texto contém indícios fortes de apresentação,
        // podemos pedir à IA uma extração rápida estruturada caso openaiKey ou skipAi esteja disponível
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
          } catch (_) {
            // Falha silenciosa na IA auxiliar, mantém o provisório
          }
        }

        // Se detectou nome válido, atualiza o registro do cliente
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

  // 7. Definição de ferramentas (Function Calling)
  const availableTools = [
    {
      type: 'function',
      function: {
        name: 'buscar_produtos',
        description:
          'Busca produtos no catálogo da SOU.IS por termo de pesquisa, nome da peça, modelo, marca, SKU ou código de barras. Retorna até 5 produtos com nome, SKU, marca, anos de aplicação, descrição/aplicação detalhada, preço e estoque.',
        parameters: {
          type: 'object',
          properties: {
            termo: {
              type: 'string',
              description:
                'Termo de pesquisa (ex.: "bucha d21", "amortecedor d21", SKU ou código de barras)',
            },
          },
          required: ['termo'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'consultar_estoque_ao_vivo',
        description:
          'Consulta o estoque e disponibilidade em tempo real de um SKU específico chamando o endpoint de estoque ao vivo.',
        parameters: {
          type: 'object',
          properties: {
            sku: {
              type: 'string',
              description: 'Código SKU exato do produto (ex.: "2765", "8722", etc.)',
            },
          },
          required: ['sku'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'status_pedido',
        description:
          'Consulta o status do último orçamento e pedido do cliente pelo número de WhatsApp cadastrado. Retorna número do orçamento/pedido, status comercial, financeiro e valor real.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'status_nfe',
        description:
          'Consulta o status da última NF-e emitida para o CNPJ/CPF do cliente. Retorna número da nota, chave de acesso, status e valor. Se a nota estiver cancelada, alerta que NÃO deve pagar.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'segunda_via_danfe',
        description:
          'Enfileira o comando para buscar e emitir a segunda via do DANFE (PDF da NF-e) na SEFAZ. Exige a chave de acesso de 44 dígitos da nota ou busca a chave da última nota do cliente. NUNCA inventa chave.',
        parameters: {
          type: 'object',
          properties: {
            access_key: {
              type: 'string',
              description:
                'Chave de acesso de 44 dígitos da NF-e (opcional se o cliente já tiver nota emitida no sistema)',
            },
          },
        },
      },
    },
  ]

  // Executores locais das ferramentas
  const executeBuscarProdutos = (termo) => {
    try {
      const colProdutos = $app.findCollectionByNameOrId('products')
      const rawTerm = String(termo || '').trim()
      if (!rawTerm) return { total: 0, produtos: [] }

      // Leitura dinâmica ao vivo de configurações (SKUs excluídos e Famílias permitidas)
      let excludedSkusSet = {}
      let allowedFamiliesList = []
      let hasAllowedFamiliesFilter = false

      try {
        const liveSetting = $app.findFirstRecordByFilter('settings', "id != ''")
        if (liveSetting) {
          const rawExcluded = String(liveSetting.getString('ai_excluded_skus') || '').trim()
          if (rawExcluded) {
            const splitted = rawExcluded.split(',')
            for (let sIdx = 0; sIdx < splitted.length; sIdx++) {
              const skuClean = splitted[sIdx].trim().toLowerCase()
              if (skuClean) {
                excludedSkusSet[skuClean] = true
              }
            }
          }

          // allowed_families pode ser armazenado como JSON string (array) ou string separada por vírgula
          const rawAllowedFamilies = liveSetting.get('allowed_families')
          if (rawAllowedFamilies) {
            if (Array.isArray(rawAllowedFamilies)) {
              allowedFamiliesList = rawAllowedFamilies.map((f) => String(f).trim()).filter(Boolean)
            } else if (typeof rawAllowedFamilies === 'string' && rawAllowedFamilies.trim()) {
              const strTrimmed = rawAllowedFamilies.trim()
              if (strTrimmed.startsWith('[') && strTrimmed.endsWith(']')) {
                try {
                  const parsed = JSON.parse(strTrimmed)
                  if (Array.isArray(parsed)) {
                    allowedFamiliesList = parsed.map((f) => String(f).trim()).filter(Boolean)
                  }
                } catch (_) {
                  allowedFamiliesList = strTrimmed
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean)
                }
              } else {
                allowedFamiliesList = strTrimmed
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean)
              }
            }
          }

          // GUARDA DA LISTA VAZIA:
          // Se allowed_families estiver vazio -> hasAllowedFamiliesFilter = false (comportamento atual mantido)
          // Se tiver ao menos uma família -> hasAllowedFamiliesFilter = true
          hasAllowedFamiliesFilter = allowedFamiliesList.length > 0
        }
      } catch (exErr) {
        console.log('[AI-SETTINGS-READ-ERR]', String(exErr))
      }

      // Lista de stopwords estritas em português conforme especificação
      const stopWordsSet = {
        de: true,
        do: true,
        da: true,
        dos: true,
        das: true,
        para: true,
        em: true,
        um: true,
        uma: true,
        tem: true,
        temos: true,
        você: true,
        voce: true,
        qual: true,
        quanto: true,
        custa: true,
        o: true,
        a: true,
        e: true,
        é: true,
        ano: true,
        anos: true,
        modelo: true,
        peca: true,
        peça: true,
        pecas: true,
        peças: true,
        pra: true,
        pro: true,
        // Stopwords de pergunta de preço e cotação (ex.: "Qual valor da bucha bandeja fox 2014")
        preco: true,
        preço: true,
        precos: true,
        preços: true,
        valor: true,
        valores: true,
        cotacao: true,
        cotação: true,
        orcamento: true,
        orçamento: true,
        saber: true,
        quero: true,
        gostaria: true,
        favor: true,
        por: true,
        obrigado: true,
        obrigada: true,
        ola: true,
        olá: true,
        bom: true,
        dia: true,
        tarde: true,
        noite: true,
      }

      // Normalização de diacríticos/acentos e extração de tokens
      // Remove acentos (facão -> facao, tração -> tracao, elétrico -> eletrico)
      // Mantém letras, números e remove pontuação como ?, !, ,, ;, :, etc.
      const removeAccents = (str) => {
        if (!str) return ''
        return String(str)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
      }

      const rawWords = removeAccents(rawTerm)
        .toLowerCase()
        .replace(/[?!,;:()[\]{}"'\\/]/g, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0)

      const usefulTokens = []
      const detectedYears = [] // Anos de 2 dígitos (00-99) ou 4 dígitos (ex: 1991 -> 91)

      for (let wi = 0; wi < rawWords.length; wi++) {
        const token = rawWords[wi]
        if (!token) continue

        // Ignorar se for stopword (a menos que seja o único termo do usuário)
        if (stopWordsSet[token]) continue

        // Detecção e tratamento de anos:
        // Caso A: 4 dígitos (ex.: "1991", "2005") -> ano de veículo
        if (/^(19|20)\d{2}$/.test(token)) {
          const twoDigit = parseInt(token.slice(2), 10)
          if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
          continue // Descartar token de 4 dígitos da busca direta de texto
        }

        // Caso B: 2 dígitos isolados (ex.: "91", "97")
        // Nota: modelos com letras e dígitos como "d21", "l200", "f1000", "147" não entram aqui
        if (/^\d{2}$/.test(token)) {
          const twoDigit = parseInt(token, 10)
          if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
          continue // Descartar token de 2 dígitos isolado da busca direta de texto
        }

        // Token útil preservado (ex.: "bucha", "amortecedor", "d21", "dianteiro")
        if (token.length >= 2) {
          usefulTokens.push(token)
        }
      }

      // Fallback: se todos os tokens foram stopwords ou anos, usa os rawWords com len >= 2
      const searchTokens =
        usefulTokens.length > 0 ? usefulTokens : rawWords.filter((w) => w.length >= 2)

      if (searchTokens.length === 0) {
        // Horário de Brasília UTC-3 para log de diagnóstico
        let nowBrasiliaIso = ''
        try {
          const bDate = new Date(Date.now() - 3 * 3600 * 1000)
          nowBrasiliaIso = bDate.toISOString().replace('Z', '-03:00')
        } catch (_) {
          nowBrasiliaIso = new Date().toISOString()
        }

        console.log(
          '[TOOL-BUSCAR-PRODUTOS-ZERO-RESULTS]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termoOriginal: rawTerm,
            tokensUsados: searchTokens,
            anosDetectados: detectedYears,
            motivo: 'Nenhum token útil após remoção de stopwords/anos',
          }),
        )

        return { total: 0, produtos: [] }
      }

      // Tabela fixa e determinística de apelidos e abreviações do ERP SOU.IS
      // Mapeamento bidirecional determinístico palavra completa <-> abreviação do catálogo
      // NUNCA usar prefixo genérico arbitrário para evitar falsos positivos (ex: "volante" nunca casa com "VOLVO")
      const TOKEN_ALIASES_MAP = {
        bandeja: ['band'],
        bandejas: ['band'],
        band: ['bandeja'],
        dianteira: ['diant'],
        dianteiro: ['diant'],
        dianteiras: ['diant'],
        dianteiros: ['diant'],
        diant: ['dianteira', 'dianteiro'],
        traseira: ['tras'],
        traseiro: ['tras'],
        traseiras: ['tras'],
        traseiros: ['tras'],
        tras: ['traseira', 'traseiro'],
        amortecedor: ['amort'],
        amortecedores: ['amort'],
        amort: ['amortecedor'],
        estabilizadora: ['estab'],
        estabilizador: ['estab'],
        estab: ['estabilizadora', 'estabilizador'],
        superior: ['sup'],
        superiores: ['sup'],
        sup: ['superior'],
        inferior: ['inf'],
        inferiores: ['inf'],
        inf: ['inferior'],
        facao: ['facao'],
        facao: ['facao'],
        direcao: ['dir'],
        dir: ['direcao'],
        articulacao: ['artic'],
        articulador: ['artic'],
        artic: ['articulacao', 'articulador'],
        hidraulica: ['hidr'],
        hidraulico: ['hidr'],
        hidr: ['hidraulica', 'hidraulico'],
        esquerda: ['esq'],
        esquerdo: ['esq'],
        esq: ['esquerda', 'esquerdo'],
        direita: ['dir'],
        direito: ['dir'],
        homocinetica: ['homoc'],
        homoc: ['homocinetica'],
        travessa: ['trav'],
        trav: ['travessa'],
        tensor: ['tens'],
        tens: ['tensor'],
        rolamento: ['rol'],
        rol: ['rolamento'],
        transversal: ['trans'],
        trans: ['transversal'],
      }

      // Função que expande cada token para o conjunto de termos equivalentes [token, ...aliases]
      const getEquivalentsForToken = (tok) => {
        const cleanTok = String(tok || '')
          .toLowerCase()
          .trim()
        if (!cleanTok) return []
        const aliasList = TOKEN_ALIASES_MAP[cleanTok] || []
        const result = [cleanTok]
        for (let ai = 0; ai < aliasList.length; ai++) {
          const alias = aliasList[ai]
          if (!result.includes(alias)) {
            result.push(alias)
          }
        }
        return result
      }

      // Grupos de tokens equivalentes para busca (cada posição representa 1 conceito da busca do usuário)
      const tokenGroups = []
      for (let sti = 0; sti < searchTokens.length; sti++) {
        tokenGroups.push(getEquivalentsForToken(searchTokens[sti]))
      }

      let candidates = []
      const candidateIds = {}
      let phase1Count = 0
      let phase2Count = 0
      const allFetchedRecs = {}

      // PLANO B DA BUSCA — SQL DIRETO COM $app.db().newQuery:
      // Resolve truncamento definitivo (tokens comuns como "bucha" e "band" ultrapassam 1000 produtos individualmente).
      // Em vez de consultar por token e fazer interseção em memória, executa UMA query única no SQLite:
      // WHERE is_active = 1 AND ((name LIKE %c1% OR name LIKE %a1%...)) AND ((name LIKE %c2%...))
      // (1) Parênteses explícitos por conceito; aliases em OR dentro dos parênteses; conceitos unidos por AND.
      // (2) bind() obrigatório para todo valor (prevenção total contra SQL injection).
      // (3) Escape de % e _ nos tokens antes de envolver com %...%.
      // (4) LIKE duplo por token/alias: variante com acento e sem acento para cobrir nomes acentuados no banco.
      // (5) Anos e stopwords já foram removidos de searchTokens antes de montar os parâmetros.
      // (6) Sem ORDER BY (ranking sofisticado em memória preservado).
      // (7) LIMIT 2000 de segurança + TRUNCATION-WARNING se o pool atingir o cap.
      // (8) Mantém allowlist, exclusões, ranking, fallback e log [TOOL-BUSCAR-PRODUTOS-GROUP-HITS].
      const escapeSqlLike = (str) => {
        if (!str) return ''
        return String(str).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
      }

      const buildLikeVariants = (term) => {
        const raw = String(term || '')
          .trim()
          .toLowerCase()
        const unaccented = removeAccents(raw).toLowerCase()
        const set = [raw]
        if (unaccented && unaccented !== raw && set.indexOf(unaccented) === -1) {
          set.push(unaccented)
        }
        return set
      }

      const groupHitCounts = []
      let anyTruncated = false

      if (tokenGroups.length > 0) {
        try {
          const sqlWhereGroups = []
          const bindParams = {}
          let pIdx = 0

          for (let gi = 0; gi < tokenGroups.length; gi++) {
            const variants = tokenGroups[gi]
            const variantClauses = []
            for (let vi = 0; vi < variants.length; vi++) {
              const vTerm = variants[vi]
              if (!vTerm || vTerm.length < 2) continue
              const likeVars = buildLikeVariants(vTerm)
              for (let lvi = 0; lvi < likeVars.length; lvi++) {
                const pKey = 'p_' + pIdx++
                bindParams[pKey] = '%' + escapeSqlLike(likeVars[lvi]) + '%'
                variantClauses.push(
                  '(name LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR sku LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR brand LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR barcode LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR description LIKE {:' +
                    pKey +
                    '} ESCAPE "\\")',
                )
              }
            }
            if (variantClauses.length > 0) {
              sqlWhereGroups.push('(' + variantClauses.join(' OR ') + ')')
            }
          }

          let whereSql = 'is_active = 1'
          if (sqlWhereGroups.length > 0) {
            whereSql += ' AND ' + sqlWhereGroups.join(' AND ')
          }

          const sql = 'SELECT * FROM products WHERE ' + whereSql + ' LIMIT 2000'
          const queryResult = arrayOf(new Record(colProdutos))
          $app.db().newQuery(sql).bind(bindParams).all(queryResult)

          if (queryResult && queryResult.length > 0) {
            if (queryResult.length >= 2000) {
              anyTruncated = true
            }
            for (let ri = 0; ri < queryResult.length; ri++) {
              const r = queryResult[ri]
              candidates.push(r)
              candidateIds[r.id] = true
              allFetchedRecs[r.id] = r
              phase1Count++
            }
          }
        } catch (sqlErr) {
          console.log('[TOOL-BUSCAR-PRODUTOS-SQL-ERR]', String(sqlErr))
        }

        // Medição e contagem de hits por conceito para manter o log [TOOL-BUSCAR-PRODUTOS-GROUP-HITS]
        for (let gi = 0; gi < tokenGroups.length; gi++) {
          const variants = tokenGroups[gi]
          const primaryTok = searchTokens[gi] || (variants && variants[0]) || 'grupo' + gi
          try {
            const groupClauses = []
            const gBindParams = {}
            let gIdx = 0
            for (let vi = 0; vi < variants.length; vi++) {
              const vTerm = variants[vi]
              if (!vTerm || vTerm.length < 2) continue
              const likeVars = buildLikeVariants(vTerm)
              for (let lvi = 0; lvi < likeVars.length; lvi++) {
                const pKey = 'gp_' + gIdx++
                gBindParams[pKey] = '%' + escapeSqlLike(likeVars[lvi]) + '%'
                groupClauses.push(
                  '(name LIKE {:' + pKey + '} ESCAPE "\\" OR sku LIKE {:' + pKey + '} ESCAPE "\\")',
                )
              }
            }
            if (groupClauses.length > 0) {
              const countSql =
                'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND (' +
                groupClauses.join(' OR ') +
                ')'
              const countRes = new DynamicModel({ total: 0 })
              $app.db().newQuery(countSql).bind(gBindParams).one(countRes)
              const gHits = Number(countRes.total) || 0
              groupHitCounts.push({ token: primaryTok, hits: gHits })
            } else {
              groupHitCounts.push({ token: primaryTok, hits: 0 })
            }
          } catch (gErr) {
            groupHitCounts.push({ token: primaryTok, hits: phase1Count })
          }
        }
      }

      // Log em linha própria de groupHits por token e contagem da interseção SQL
      const groupHitsLogSummary =
        groupHitCounts.map((gh) => 'token=' + gh.token + ' hits=' + gh.hits).join(' | ') +
        ' | interseção=' +
        phase1Count
      console.log('[TOOL-BUSCAR-PRODUTOS-GROUP-HITS]', groupHitsLogSummary)

      // Aviso explícito se o resultado SQL atingiu o limite de 2000 hits (truncamento detectado)
      if (anyTruncated) {
        console.log(
          '[TOOL-BUSCAR-PRODUTOS-TRUNCATION-WARNING]',
          'Pool de candidatos atingiu o limite de 2000 hits (truncamento no LIMIT 2000).',
        )
      }

      // Fase 2: OR amplo (se Fase 1 trouxe menos de 5 produtos, busca candidatos que casam com pelo menos 1 conceito via SQL OR)
      if (candidates.length < 5 && tokenGroups.length > 1) {
        try {
          const orWhereClauses = []
          const orBindParams = {}
          let orIdx = 0

          for (let gi = 0; gi < tokenGroups.length; gi++) {
            const variants = tokenGroups[gi]
            for (let vi = 0; vi < variants.length; vi++) {
              const vTerm = variants[vi]
              if (!vTerm || vTerm.length < 2) continue
              const likeVars = buildLikeVariants(vTerm)
              for (let lvi = 0; lvi < likeVars.length; lvi++) {
                const pKey = 'orp_' + orIdx++
                orBindParams[pKey] = '%' + escapeSqlLike(likeVars[lvi]) + '%'
                orWhereClauses.push(
                  '(name LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR sku LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR brand LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR barcode LIKE {:' +
                    pKey +
                    '} ESCAPE "\\" OR description LIKE {:' +
                    pKey +
                    '} ESCAPE "\\")',
                )
              }
            }
          }

          if (orWhereClauses.length > 0) {
            const orSql =
              'SELECT * FROM products WHERE is_active = 1 AND (' +
              orWhereClauses.join(' OR ') +
              ') LIMIT 200'
            const orResult = arrayOf(new Record(colProdutos))
            $app.db().newQuery(orSql).bind(orBindParams).all(orResult)
            if (orResult && orResult.length > 0) {
              for (let ori = 0; ori < orResult.length; ori++) {
                const r = orResult[ori]
                if (!candidateIds[r.id]) {
                  candidates.push(r)
                  candidateIds[r.id] = true
                  allFetchedRecs[r.id] = r
                  phase2Count++
                  if (candidates.length >= 200) break
                }
              }
            }
          }
        } catch (orErr) {
          console.log('[TOOL-BUSCAR-PRODUTOS-PHASE2-ERR]', String(orErr))
        }
      }

      // Fallback amplo pelo termo cru caso nada tenha sido encontrado
      let fallbackCount = 0
      if ((!candidates || candidates.length === 0) && rawTerm.length >= 2) {
        try {
          const fallbackRecs = $app.findRecordsByFilter(
            'products',
            'name ~ {:rt} || sku ~ {:rt} || brand ~ {:rt} || barcode ~ {:rt}',
            '-stock_quantity,name',
            20,
            0,
            { rt: rawTerm },
          )
          if (fallbackRecs && fallbackRecs.length > 0) {
            for (let fbi = 0; fbi < fallbackRecs.length; fbi++) {
              candidates.push(fallbackRecs[fbi])
              fallbackCount++
            }
          }
        } catch (fbErr) {
          console.log('[TOOL-BUSCAR-PRODUTOS-FALLBACK-ERR]', String(fbErr))
        }
      }

      console.log(
        '[TOOL-BUSCAR-PRODUTOS-STEP]',
        'totalCandidatosBanco=' + (candidates ? candidates.length : 0),
      )
      console.log('[TOOL-BUSCAR-PRODUTOS-STEP]', 'phase1Count=' + phase1Count)
      console.log('[TOOL-BUSCAR-PRODUTOS-STEP]', 'phase2Count=' + phase2Count)
      console.log('[TOOL-BUSCAR-PRODUTOS-STEP]', 'fallbackCount=' + fallbackCount)

      // Helper para checar se uma faixa de anos no nome do produto (ex.: "88/97", "92/04")
      // contempla os anos pesquisados (ex.: 91 está entre 88 e 97)
      const matchesYearRange = (text, year2Digit) => {
        if (!text || year2Digit === undefined || year2Digit === null) return false
        // Procura padrões como "88/97", "93/03", "92-04", "88/1997"
        const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
        let match
        while ((match = rangeRegex.exec(text)) !== null) {
          let startY = parseInt(match[1], 10)
          let endY = parseInt(match[2], 10)
          if (startY > 1000) startY = startY % 100
          if (endY > 1000) endY = endY % 100

          if (!isNaN(startY) && !isNaN(endY)) {
            if (startY <= endY) {
              if (year2Digit >= startY && year2Digit <= endY) return true
            } else {
              // Transição de século ex.: 95/05 (1995 a 2005)
              if (year2Digit >= startY || year2Digit <= endY) return true
            }
          }
        }
        return false
      }

      // Helper para extrair faixa de anos formatada do nome do produto (ex.: "88/97", "06/15")
      const extractYearRangeString = (text) => {
        if (!text) return ''
        const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
        const match = rangeRegex.exec(text)
        if (match) {
          let y1 = match[1]
          let y2 = match[2]
          if (y1.length === 4) y1 = y1.slice(2)
          if (y2.length === 4) y2 = y2.slice(2)
          return y1 + '/' + y2
        }
        return ''
      }

      // Sistema de pontuação e relevância com suporte a apelidos do ERP:
      // ORDEM DO SCORE (conforme item 2 da especificação):
      // 1º: Número de tokens casados (ordem primária: peça com mais tokens nunca perde para peça com menos tokens)
      // 2º: Bônus stock_quantity > 0
      // 3º: Bônus de faixa de anos
      const scoredCandidates = []

      for (let ci = 0; ci < (candidates || []).length; ci++) {
        const rec = candidates[ci]
        const pSku = String(rec.getString('sku') || '').toLowerCase()

        // 1. Filtrar produtos inativos: só produtos is_active !== false (se is_active for undefined/null em legados manuais, aceita, mas se is_active === false descarta)
        const isActive = rec.get('is_active')
        if (isActive === false) {
          continue
        }

        // 2. Excluir SKUs configurados em ai_excluded_skus (insumos puros — prevalece sobre allowlist)
        if (excludedSkusSet[pSku] || excludedSkusSet[pSku.trim()]) {
          continue
        }

        // 3. GUARDA DA LISTA VAZIA: se allowed_families preenchida, só produtos cuja sou_family está na lista
        if (hasAllowedFamiliesFilter) {
          const pFamily = String(rec.getString('sou_family') || '').trim()
          let familyAllowed = false
          for (let afi = 0; afi < allowedFamiliesList.length; afi++) {
            if (pFamily.toLowerCase() === allowedFamiliesList[afi].toLowerCase()) {
              familyAllowed = true
              break
            }
          }
          if (!familyAllowed) {
            continue
          }
        }

        const pName = removeAccents(rec.getString('name') || '').toLowerCase()
        const pBrand = removeAccents(rec.getString('brand') || '').toLowerCase()
        const pBarcode = removeAccents(rec.getString('barcode') || '').toLowerCase()
        const pDesc = removeAccents(rec.getString('description') || '').toLowerCase()
        const fullSearchable = pName + ' ' + pSku + ' ' + pBrand + ' ' + pBarcode + ' ' + pDesc
        const nameSkuSearchable = pName + ' ' + pSku

        let matchedTokenCount = 0
        let matchedNameSkuCount = 0

        // Cada conceito de busca pode casar via seu token direto ou via qualquer apelido configurado
        for (let gi = 0; gi < tokenGroups.length; gi++) {
          const variants = tokenGroups[gi]
          let groupMatchedFull = false
          let groupMatchedNameSku = false

          for (let vi = 0; vi < variants.length; vi++) {
            const vTok = variants[vi]
            if (fullSearchable.includes(vTok)) {
              groupMatchedFull = true
            }
            if (nameSkuSearchable.includes(vTok)) {
              groupMatchedNameSku = true
            }
          }

          if (groupMatchedFull) {
            matchedTokenCount++
          }
          if (groupMatchedNameSku) {
            matchedNameSkuCount++
          }
        }

        // Se o produto não casou com nenhum conceito, desconsidera
        if (matchedTokenCount === 0 && tokenGroups.length > 0) continue

        // Base score: 1000 pontos por conceito/token casado (peso dominante para que mais tokens sempre vençam)
        let score = matchedTokenCount * 1000

        // Bônus se casou com TODOS os tokens da pesquisa (match perfeito)
        if (matchedTokenCount === tokenGroups.length && tokenGroups.length > 1) {
          score += 100
        }

        // Bônus de SKU exato
        if (pSku === removeAccents(rawTerm).toLowerCase()) {
          score += 5000
        }

        // Bônus se o estoque é positivo (critério secundário de desempate: vem após número de tokens)
        const stockQty = Number(rec.get('stock_quantity')) || 0
        if (stockQty > 0) {
          score += 20
        }

        // Bônus se casou na faixa de anos (critério terciário: após estoque)
        let yearMatched = false
        if (detectedYears.length > 0) {
          for (let yi = 0; yi < detectedYears.length; yi++) {
            if (matchesYearRange(pName, detectedYears[yi])) {
              yearMatched = true
              break
            }
          }
          if (yearMatched) {
            score += 10
          }
        }

        scoredCandidates.push({
          rec: rec,
          score: score,
          matchedTokenCount: matchedTokenCount,
          matchedNameSkuCount: matchedNameSkuCount,
          yearMatched: yearMatched,
        })
      }

      // Ordenar decrescente:
      // 1. score total (onde matchedTokenCount domina por ter peso 1000, depois stockQty bônus 20, depois yearMatched 10)
      // 2. desempate: matchedTokenCount
      // 3. desempate: stock_quantity (>0 antes de <=0)
      // 4. desempate: nome alfabético
      scoredCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.matchedTokenCount !== a.matchedTokenCount)
          return b.matchedTokenCount - a.matchedTokenCount
        const stockA = Number(a.rec.get('stock_quantity')) || 0
        const stockB = Number(b.rec.get('stock_quantity')) || 0
        if (stockB !== stockA) return stockB - stockA
        return a.rec.getString('name').localeCompare(b.rec.getString('name'))
      })

      // GUARDA DO DESCARTE E FALLBACK:
      // A regra "descartar quem casa com menos de 2 termos significativos" só vale
      // quando a busca TEM 2+ termos significativos (tokenGroups.length >= 2).
      // Se a busca tem apenas 1 termo significativo, mantém todos os casamentos ordenados por relevância.
      // Além disso, se o filtro de 2+ termos resultar em MENOS de 3 produtos, usar fallback:
      // incluir também os candidatos que casaram com 1 termo (ao final da lista), em vez de devolver resposta vazia.
      let filteredRanked = scoredCandidates
      if (tokenGroups.length >= 2) {
        const strictMatch = scoredCandidates.filter((item) => item.matchedNameSkuCount >= 2)
        if (strictMatch.length >= 3) {
          filteredRanked = strictMatch
        } else {
          // Fallback: produtos com 2+ termos primeiro, complementados pelos com 1 termo ao final
          const partialMatch = scoredCandidates.filter((item) => item.matchedNameSkuCount < 2)
          filteredRanked = strictMatch.concat(partialMatch)
        }
      }

      console.log('[TOOL-BUSCAR-PRODUTOS-STEP]', 'scoredCandidatesCount=' + scoredCandidates.length)
      console.log('[TOOL-BUSCAR-PRODUTOS-STEP]', 'filteredRankedCount=' + filteredRanked.length)

      // Limitar aos top 5
      const topSelected = filteredRanked.slice(0, 5)

      // Montar contrato atual de retorno com description e years enriquecidos
      const results = topSelected.map((item) => {
        const rec = item.rec
        const pPrice = Number(rec.get('price')) || 0
        const pStock = Number(rec.get('stock_quantity')) || 0
        const pSku = rec.getString('sku')
        const pName = rec.getString('name')
        const pBrand = rec.getString('brand') || ''
        const pBarcode = rec.getString('barcode') || ''
        const pDesc = String(rec.getString('description') || '').trim()
        const pYears = extractYearRangeString(pName)

        let statusConsulta = ''
        if (pStock > 0 && pPrice > 0) {
          statusConsulta = 'R$ ' + pPrice.toFixed(2) + ' (' + pStock + ' un.)'
        } else if (pStock <= 0 && pPrice <= 0) {
          statusConsulta = 'Sob consulta - disponível em até 48 horas'
        } else if (pStock <= 0) {
          statusConsulta = 'R$ ' + pPrice.toFixed(2) + ' - disponível em até 48 horas'
        } else {
          statusConsulta = 'Sob consulta (' + pStock + ' un.)'
        }

        const prodObj = {
          sku: pSku,
          nome: pName,
          marca: pBrand,
          codigo_barras: pBarcode,
          preco: pPrice,
          estoque: pStock,
          disponivel: pStock > 0,
          disponibilidade_info:
            pStock <= 0 ? 'disponível em até 48 horas' : pStock + ' un. em estoque',
          status_consulta: statusConsulta,
        }

        // Limpar boilerplate do description: só incluir se NÃO começar com "Produto SOU.IS sincronizado"
        if (pDesc && !pDesc.startsWith('Produto SOU.IS sincronizado')) {
          prodObj.description = pDesc
        }
        if (pYears) {
          prodObj.years = pYears
        }

        return prodObj
      })

      // Horário de Brasília UTC-3 para logs padronizados (sem UTC)
      let nowBrasiliaIso = ''
      try {
        const bDate = new Date(Date.now() - 3 * 3600 * 1000)
        nowBrasiliaIso = bDate.toISOString().replace('Z', '-03:00')
      } catch (_) {
        nowBrasiliaIso = new Date().toISOString()
      }

      if (results.length === 0) {
        console.log(
          '[TOOL-BUSCAR-PRODUTOS-ZERO-RESULTS]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termoOriginal: rawTerm,
            tokensUsados: searchTokens,
            anosDetectados: detectedYears,
            totalCandidatosBanco: (candidates || []).length,
          }),
        )
      } else {
        console.log(
          '[TOOL-BUSCAR-PRODUTOS-EXECUTED]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termo: rawTerm,
            tokensUsados: searchTokens,
            totalEncontrados: results.length,
            skus: results.map((r) => r.sku),
          }),
        )
      }

      return {
        termo: rawTerm,
        total: results.length,
        produtos: results,
      }
    } catch (err) {
      console.error(
        '[TOOL-BUSCAR-PRODUTOS-ERROR]',
        err && err.stack ? String(err.stack) : String(err),
      )
      return []
    }
  }

  const executeConsultarEstoqueAoVivo = (sku) => {
    try {
      const cleanSku = String(sku || '').trim()
      if (!cleanSku) return { sku: '', estoque: 0, erro: 'SKU não fornecido' }

      // 1. Tentar ler do endpoint interno GET /backend/v1/stock/lookup?sku=
      let liveQuantity = null
      let apiUpdated = false
      try {
        let stockApiUrl = 'https://dummyjson.com/products'
        try {
          const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
          if (setting && setting.getString('stock_api_url')) {
            stockApiUrl = setting.getString('stock_api_url')
          }
        } catch (_) {}

        const res = $http.send({
          url: stockApiUrl + '?search=' + encodeURIComponent(cleanSku),
          method: 'GET',
          timeout: 10,
        })

        if (res.statusCode === 200 && res.json) {
          const data = res.json
          if (data.products && Array.isArray(data.products) && data.products.length > 0) {
            liveQuantity = data.products[0].stock || data.products[0].stock_quantity || 12
            apiUpdated = true
          } else if (typeof data.stock === 'number') {
            liveQuantity = data.stock
            apiUpdated = true
          }
        }
      } catch (httpEx) {
        console.log('[TOOL-ESTOQUE-AO-VIVO-HTTP-ERR]', String(httpEx))
      }

      // 2. Se a API externa retornou valor numérico, atualiza no banco local
      if (liveQuantity !== null && !isNaN(liveQuantity)) {
        try {
          const localProduct = $app.findFirstRecordByData('products', 'sku', cleanSku)
          localProduct.set('stock_quantity', liveQuantity)
          $app.save(localProduct)
        } catch (_) {}
      }

      // 3. Consulta o registro do produto local para retornar status completo
      let productInfo = null
      try {
        const prod = $app.findFirstRecordByData('products', 'sku', cleanSku)
        const curStock = Number(prod.get('stock_quantity')) || 0
        const curPrice = Number(prod.get('price')) || 0
        let statusAoVivo = ''
        if (curStock > 0 && curPrice > 0) {
          statusAoVivo = 'R$ ' + curPrice.toFixed(2) + ' (' + curStock + ' un.)'
        } else if (curStock <= 0 && curPrice <= 0) {
          statusAoVivo = 'Sob consulta - disponível em até 48 horas'
        } else if (curStock <= 0) {
          statusAoVivo = 'R$ ' + curPrice.toFixed(2) + ' - disponível em até 48 horas'
        } else {
          statusAoVivo = 'Sob consulta (' + curStock + ' un.)'
        }

        productInfo = {
          sku: cleanSku,
          nome: prod.getString('name'),
          marca: prod.getString('brand') || '',
          preco: curPrice,
          estoque: curStock,
          disponivel: curStock > 0,
          disponibilidade_info:
            curStock <= 0 ? 'disponível em até 48 horas' : curStock + ' un. em estoque',
          status_consulta: statusAoVivo,
          origem_api: apiUpdated,
        }
      } catch (_) {
        const liveStk = liveQuantity !== null ? liveQuantity : 0
        productInfo = {
          sku: cleanSku,
          estoque: liveStk,
          disponibilidade_info:
            liveStk <= 0 ? 'disponível em até 48 horas' : liveStk + ' un. em estoque',
          status_consulta: 'Sob consulta - disponível em até 48 horas',
          nao_encontrado: true,
        }
      }

      console.log(
        '[TOOL-CONSULTAR-ESTOQUE-AO-VIVO-EXECUTED]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          sku: cleanSku,
          estoque: productInfo.estoque,
          preco: productInfo.preco,
        }),
      )

      return productInfo
    } catch (err) {
      console.log('[TOOL-CONSULTAR-ESTOQUE-ERROR]', String(err))
      return { sku: sku, estoque: 0, erro: String(err) }
    }
  }

  // 7.1. Busca determinística pré-IA (para garantir que termos como "bucha bandeja fox 2014"
  // nunca recebam "não encontrei", e injetar produtos reais encontrados no contexto da IA)
  let preSearchProductResults = null
  let isPieceOrProductQuery = false

  try {
    const rawCustomerQuery = String(incomingText || '').trim()
    const lowerCustQuery = rawCustomerQuery.toLowerCase()

    // Palavras-chave indicativas de busca de produto / peça
    const productKeywords = [
      'bucha',
      'bandeja',
      'coxim',
      'amortecedor',
      'pivo',
      'terminal',
      'bieleta',
      'kit',
      'pastilha',
      'disco',
      'rolamento',
      'filtro',
      'vela',
      'correia',
      'suspensao',
      'dianteiro',
      'traseiro',
      'sup',
      'inf',
      'fox',
      'gol',
      'palio',
      'corsa',
      'civic',
      'corolla',
      'hb20',
      'onix',
      'fiesta',
      'ka',
      'uno',
      'celta',
      'strada',
      'saveiro',
      'peca',
      'peça',
      'tem ',
      'preco',
      'preço',
      'valor',
      'custa',
    ]

    for (let pki = 0; pki < productKeywords.length; pki++) {
      if (lowerCustQuery.includes(productKeywords[pki])) {
        isPieceOrProductQuery = true
        break
      }
    }

    // Pré-busca determinística: executa sempre que houver 3+ caracteres
    if (rawCustomerQuery.length >= 3) {
      const searchRes = executeBuscarProdutos(rawCustomerQuery)
      if (searchRes && searchRes.produtos && searchRes.produtos.length > 0) {
        preSearchProductResults = searchRes
        isPieceOrProductQuery = true
      }
    }
  } catch (preSearchErr) {
    console.log('[PRE-SEARCH-PRODUCT-ERR]', String(preSearchErr))
  }

  // 7.1.1 Pré-consulta determinística de status de pedido / orçamento
  // Se o cliente pergunta sobre orçamento ou pedido ("já faz tempo que pedi um orçamento", "status do pedido", etc.)
  // roda status_pedido antes da IA para injetar o orçamento real direto no contexto.
  let preStatusPedidoResult = null
  try {
    const rawQueryForStatus = String(incomingText || '').toLowerCase()
    const isStatusQuery =
      rawQueryForStatus.includes('orcamento') ||
      rawQueryForStatus.includes('orçamento') ||
      rawQueryForStatus.includes('pedido') ||
      rawQueryForStatus.includes('pedi') ||
      rawQueryForStatus.includes('resposta') ||
      rawQueryForStatus.includes('status') ||
      rawQueryForStatus.includes('comprar') ||
      rawQueryForStatus.includes('cotacao') ||
      rawQueryForStatus.includes('cotação')

    if (
      isStatusQuery &&
      globalThis.__aiStatusTools &&
      typeof globalThis.__aiStatusTools.executeStatusPedido === 'function'
    ) {
      const statusRes = globalThis.__aiStatusTools.executeStatusPedido($app, {
        phone: senderPhone,
        customerRecord: null,
      })
      if (statusRes && statusRes.data && (statusRes.data.quote || statusRes.data.order)) {
        preStatusPedidoResult = statusRes
      }
    }
  } catch (preStatusErr) {
    console.log('[PRE-STATUS-PEDIDO-ERR]', String(preStatusErr))
  }

  if (preStatusPedidoResult) {
    const quoteData = preStatusPedidoResult.data.quote
    const orderData = preStatusPedidoResult.data.order
    let statusNotice = '[DADOS REAIS DE ORÇAMENTO/PEDIDO DO CLIENTE LOCALIZADOS NO BANCO]:\n'
    if (quoteData) {
      statusNotice +=
        '- Orçamento número: ' +
        (quoteData.number || 'N/D') +
        ' | Status: ' +
        (quoteData.status || 'N/D') +
        (quoteData.total ? ' | Total: R$ ' + Number(quoteData.total).toFixed(2) : '') +
        '\n'
    }
    if (orderData) {
      statusNotice +=
        '- Pedido código: ' +
        (orderData.code || 'N/D') +
        ' | Status Comercial: ' +
        (orderData.commercial_status || 'N/D') +
        ' | Status Financeiro: ' +
        (orderData.financial_status || 'N/D') +
        '\n'
    }
    statusNotice +=
      'Mensagem formatada sugerida da ferramenta: "' + (preStatusPedidoResult.reply || '') + '"\n'
    statusNotice +=
      'REGRA MANDATÓRIA: O cliente possui orçamento/pedido ativo no sistema com os dados acima. NUNCA diga "não consegui localizar o seu orçamento" ou "problema no sistema". Responda informando o número exato do orçamento/pedido e seu status atual.'

    chatMessages.push({
      role: 'system',
      content: statusNotice,
    })
  }

  // Se a busca determinística pré-IA encontrou produtos no banco, injeta no contexto como mensagem de sistema prioritária
  if (
    preSearchProductResults &&
    preSearchProductResults.produtos &&
    preSearchProductResults.produtos.length > 0
  ) {
    const preFoundList = preSearchProductResults.produtos.map((p) => {
      return (
        '- SKU: ' +
        p.sku +
        ' | Nome: ' +
        p.nome +
        ' | Marca: ' +
        (p.marca || 'N/D') +
        ' | Preço: ' +
        (p.preco > 0 ? 'R$ ' + p.preco.toFixed(2) : 'Sob consulta') +
        ' | Estoque: ' +
        (p.estoque > 0 ? p.estoque + ' un.' : 'disponível em até 48 horas') +
        ' (' +
        p.status_consulta +
        ')'
      )
    })

    const preSearchNotice =
      '[PRODUTOS REAIS ENCONTRADOS DETERMINISTICAMENTE NO CATÁLOGO DO ERP]:\n' +
      'A busca determinística pré-IA já consultou o banco para a mensagem do cliente e encontrou os seguintes produtos correspondentes:\n' +
      preFoundList.join('\n') +
      '\n\nREGRA MANDATÓRIA: Os produtos acima EXISTEM em nosso estoque/catálogo. NUNCA responda "não encontrei", "não temos" ou "não trabalho com isso". Apresente os itens encontrados informando os valores e prazos (se estoque 0 ou preço 0, informe "Sob consulta — disponível em até 48h" ou sob encomenda).'

    chatMessages.push({
      role: 'system',
      content: preSearchNotice,
    })
  }

  // Despachante genérico de tool calls
  const dispatchToolCall = (toolName, toolArgs) => {
    if (toolName === 'buscar_produtos') {
      try {
        const termo = toolArgs && toolArgs.termo ? toolArgs.termo : ''
        return executeBuscarProdutos(termo)
      } catch (toolBuscarErr) {
        console.error(
          '[TOOL-BUSCAR-PRODUTOS-ERROR]',
          toolBuscarErr && toolBuscarErr.stack
            ? String(toolBuscarErr.stack)
            : String(toolBuscarErr),
        )
        return []
      }
    }
    if (toolName === 'consultar_estoque_ao_vivo') {
      const sku = toolArgs && toolArgs.sku ? toolArgs.sku : ''
      return executeConsultarEstoqueAoVivo(sku)
    }
    if (toolName === 'status_pedido') {
      if (
        globalThis.__aiStatusTools &&
        typeof globalThis.__aiStatusTools.executeStatusPedido === 'function'
      ) {
        return globalThis.__aiStatusTools.executeStatusPedido(phone)
      }
      return {
        status: 'nao_localizado',
        mensagem: 'Módulo de status de pedido indisponível no momento',
      }
    }
    if (toolName === 'status_nfe') {
      if (
        globalThis.__aiStatusTools &&
        typeof globalThis.__aiStatusTools.executeStatusNfe === 'function'
      ) {
        return globalThis.__aiStatusTools.executeStatusNfe(phone)
      }
      return {
        status: 'nao_localizado',
        mensagem: 'Módulo de status de NF-e indisponível no momento',
      }
    }
    if (toolName === 'segunda_via_danfe') {
      if (
        globalThis.__aiStatusTools &&
        typeof globalThis.__aiStatusTools.executeSegundaViaDanfe === 'function'
      ) {
        const key = toolArgs && toolArgs.access_key ? toolArgs.access_key : ''
        return globalThis.__aiStatusTools.executeSegundaViaDanfe(phone, key)
      }
      return { status: 'erro', mensagem: 'Módulo de segunda via indisponível no momento' }
    }
    return { erro: 'Ferramenta desconhecida: ' + toolName }
  }

  // 8. Início do processamento de IA com suporte a Function Calling
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
      toolsEnabled: true,
    }),
  )

  let aiReply = ''
  let aiError = ''
  let usedProvider = ''

  // Função para executar loop de chamadas com ferramentas via OpenAI
  const runOpenAiWithTools = () => {
    let currentMessages = chatMessages.slice()
    const MAX_TOOL_ROUNDS = 4
    let rounds = 0
    let didExecuteTool = false

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++

      // Se é mensagem claramente de produto/peça, não houve tool_call na 1ª rodada e não há produtos pré-injetados,
      // força tool_choice: { type: 'function', function: { name: 'buscar_produtos' } } na 2ª tentativa
      let currentToolChoice = 'auto'
      if (
        rounds === 2 &&
        !didExecuteTool &&
        isPieceOrProductQuery &&
        (!preSearchProductResults ||
          !preSearchProductResults.produtos ||
          preSearchProductResults.produtos.length === 0)
      ) {
        currentToolChoice = {
          type: 'function',
          function: { name: 'buscar_produtos' },
        }
      }

      const openAiRes = $http.send({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: currentMessages,
          tools: availableTools,
          tool_choice: currentToolChoice,
          max_tokens: 450,
          temperature: 0.2,
        }),
        timeout: 20,
      })

      if (openAiRes.statusCode < 200 || openAiRes.statusCode >= 300) {
        const errBody = openAiRes.json || openAiRes.body || {}
        throw new Error(
          'OpenAI HTTP ' +
            openAiRes.statusCode +
            ': ' +
            (errBody.error
              ? errBody.error.message || JSON.stringify(errBody.error)
              : 'Falha na requisição'),
        )
      }

      const parsed = openAiRes.json
      if (!parsed || !parsed.choices || !parsed.choices[0] || !parsed.choices[0].message) {
        throw new Error('Resposta da OpenAI sem choices válidas')
      }

      const choiceMsg = parsed.choices[0].message

      // Se a IA solicitou chamadas de ferramentas (tool_calls)
      if (
        choiceMsg.tool_calls &&
        Array.isArray(choiceMsg.tool_calls) &&
        choiceMsg.tool_calls.length > 0
      ) {
        currentMessages.push(choiceMsg)

        didExecuteTool = true
        for (let t = 0; t < choiceMsg.tool_calls.length; t++) {
          const tCall = choiceMsg.tool_calls[t]
          const fnName = tCall.function ? tCall.function.name : ''
          let fnArgs = {}
          try {
            fnArgs = JSON.parse(tCall.function.arguments || '{}')
          } catch (_) {
            fnArgs = {}
          }

          console.log(
            '[OPENAI-TOOL-CALL-RECEIVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              messageId: messageId,
              toolId: tCall.id,
              toolName: fnName,
              args: fnArgs,
            }),
          )

          const toolResult = dispatchToolCall(fnName, fnArgs)

          currentMessages.push({
            role: 'tool',
            tool_call_id: tCall.id,
            content: JSON.stringify(toolResult),
          })
        }

        // Continua no loop para a IA sintetizar a resposta com o resultado das ferramentas
        continue
      }

      // Resposta de texto final atingida
      if (choiceMsg.content) {
        return choiceMsg.content.trim()
      }
    }

    throw new Error('Limite de rodadas de ferramentas excedido sem resposta final')
  }

  // Função para executar loop com ferramentas via Skip Gateway ($ai.chat)
  const runSkipGatewayWithTools = () => {
    let currentMessages = chatMessages.slice()
    const MAX_TOOL_ROUNDS = 4
    let rounds = 0

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++
      const chatRes = $ai.chat({
        model: 'fast',
        messages: currentMessages,
        tools: availableTools,
        tool_choice: 'auto',
      })

      if (!chatRes || !chatRes.choices || !chatRes.choices[0] || !chatRes.choices[0].message) {
        throw new Error('Skip AI gateway retornou resposta vazia')
      }

      const choiceMsg = chatRes.choices[0].message

      if (
        choiceMsg.tool_calls &&
        Array.isArray(choiceMsg.tool_calls) &&
        choiceMsg.tool_calls.length > 0
      ) {
        currentMessages.push(choiceMsg)

        for (let t = 0; t < choiceMsg.tool_calls.length; t++) {
          const tCall = choiceMsg.tool_calls[t]
          const fnName = tCall.function ? tCall.function.name : ''
          let fnArgs = {}
          try {
            fnArgs = JSON.parse(tCall.function.arguments || '{}')
          } catch (_) {
            fnArgs = {}
          }

          console.log(
            '[SKIP-GATEWAY-TOOL-CALL-RECEIVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              messageId: messageId,
              toolId: tCall.id,
              toolName: fnName,
              args: fnArgs,
            }),
          )

          const toolResult = dispatchToolCall(fnName, fnArgs)

          currentMessages.push({
            role: 'tool',
            tool_call_id: tCall.id,
            content: JSON.stringify(toolResult),
          })
        }

        continue
      }

      if (choiceMsg.content) {
        return choiceMsg.content.trim()
      }
    }

    throw new Error('Limite de rodadas no Skip Gateway excedido')
  }

  // Execução com fallback
  if (openaiKey) {
    try {
      aiReply = runOpenAiWithTools()
      usedProvider = 'openai'
    } catch (openAiEx) {
      aiError = openAiEx.message || String(openAiEx)
      console.log(
        '[AI-FALLBACK-TO-SKIP-GATEWAY]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          messageId: messageId,
          reason: aiError,
        }),
      )
      try {
        aiReply = runSkipGatewayWithTools()
        usedProvider = 'skip_gateway'
        aiError = ''
      } catch (skipEx) {
        aiError = 'OpenAI: ' + aiError + ' | SkipGateway: ' + (skipEx.message || String(skipEx))
      }
    }
  } else {
    try {
      aiReply = runSkipGatewayWithTools()
      usedProvider = 'skip_gateway'
    } catch (skipEx) {
      aiError = skipEx.message || String(skipEx)
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

  // ==========================================
  // DETECÇÃO E PROCESSAMENTO DE MARCADORES (INTERESSE-COMPRA E TRANSFERIR-HUMANO)
  // ==========================================
  // 1. Extração do marcador de interesse de compra [INTERESSE-COMPRA: itens=..., qtd=..., app=...]
  const purchaseInterestRegex =
    /\[\s*INTERESSE\s*-\s*COMPRA\s*:\s*(?:itens=([^,\]]+))?(?:,\s*qtd=([^,\]]+))?(?:,\s*app=([^,\]]+))?\s*\]/i
  const purchaseMatch = aiReply.match(purchaseInterestRegex)
  let interestDetails = null
  if (purchaseMatch) {
    interestDetails = {
      itens: (purchaseMatch[1] || '').trim(),
      qtd: (purchaseMatch[2] || '').trim(),
      app: (purchaseMatch[3] || '').trim(),
    }
  }

  // 2. Extração do marcador de transferência para humano [TRANSFERIR-HUMANO]
  const transferMarkerRegex = /\[\s*TRANSFERIR\s*-\s*HUMANO\s*\]/gi
  const hasTransferMarker = transferMarkerRegex.test(aiReply) || Boolean(interestDetails)

  // 3. Limpeza completa dos marcadores para que o cliente NUNCA os veja
  // Preserva quebras de linha (\n) da formatação da IA, colapsando apenas espaços/tabs horizontais
  // e normalizando sequências excessivas de quebras de linha e \r\n
  let cleanAiReply = aiReply
    .replace(purchaseInterestRegex, '')
    .replace(transferMarkerRegex, '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (interestDetails || hasTransferMarker) {
    console.log(
      '[HUMAN-TRANSFER-DETECTED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        hasTransferMarker: true,
        interestDetails: interestDetails,
      }),
    )
  }

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
        message: cleanAiReply,
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
      procRecord.set('aiReplyText', cleanAiReply)
      procRecord.set('aiModel', usedModel)
      procRecord.set('zapiStatus', zapiHttpStatus)
      procRecord.set('errorMessage', '')
      $app.save(procRecord)
    } catch (saveCompletedErr) {
      console.log('[COMPLETED-SAVE-ERR]', saveCompletedErr.message || String(saveCompletedErr))
    }

    // Se houve transferência para humano, ativar human_mode na collection chat_control
    if (hasTransferMarker && phone) {
      try {
        // Detectar motivo específico da Camada 3 se especificado no marcador ou inferido do contexto
        let transferReason = 'atendimento_humano'
        const reasonMarkerMatch = aiReply.match(/\[\s*TRANSFERIR\s*-\s*HUMANO\s*:\s*([^\]]+)\s*\]/i)
        if (reasonMarkerMatch && reasonMarkerMatch[1]) {
          transferReason = reasonMarkerMatch[1].trim()
        } else {
          const lowerContext = (incomingText + ' ' + aiReply).toLowerCase()
          if (
            lowerContext.includes('reclama') ||
            lowerContext.includes('defeito') ||
            lowerContext.includes('quebr') ||
            lowerContext.includes('garantia') ||
            lowerContext.includes('errad')
          ) {
            transferReason = 'reclamacao'
          } else if (
            lowerContext.includes('danfe') ||
            lowerContext.includes('nota fiscal') ||
            lowerContext.includes('nf-e') ||
            lowerContext.includes('nfe')
          ) {
            transferReason = 'nota'
          } else if (
            lowerContext.includes('cobr') ||
            lowerContext.includes('pagamento') ||
            lowerContext.includes('pix') ||
            lowerContext.includes('boleto')
          ) {
            transferReason = 'cobranca'
          } else if (
            interestDetails ||
            lowerContext.includes('interesse') ||
            lowerContext.includes('comprar')
          ) {
            transferReason = 'interesse_compra'
          } else if (lowerContext.includes('aplic') || lowerContext.includes('compat')) {
            transferReason = 'aplicacao'
          }
        }

        let chatControlRec = null
        try {
          const foundControls = $app.findRecordsByFilter(
            'chat_control',
            'phone = {:phone}',
            '-created',
            1,
            0,
            { phone: phone },
          )
          if (foundControls && foundControls.length > 0) {
            chatControlRec = foundControls[0]
          }
        } catch (_) {}

        if (chatControlRec) {
          chatControlRec.set('human_mode', true)
          chatControlRec.set('paused_by', 'ia_transfer')
          chatControlRec.set('paused_reason', transferReason)
          $app.save(chatControlRec)
        } else {
          const controlCol = $app.findCollectionByNameOrId('chat_control')
          const newCtrl = new Record(controlCol)
          newCtrl.set('phone', normalizedSenderPhone)
          newCtrl.set('human_mode', true)
          newCtrl.set('paused_by', 'ia_transfer')
          newCtrl.set('paused_reason', transferReason)
          $app.save(newCtrl)
        }

        // Montar pacote de handoff estruturado para o atendente
        const handoffHelper = globalThis.__aiHandoffContext || globalThis.__aiHandoff || null
        let handoffPacket = null
        if (handoffHelper && typeof handoffHelper.buildHandoffPacket === 'function') {
          try {
            handoffPacket = handoffHelper.buildHandoffPacket($app, normalizedSenderPhone, {
              motivo: transferReason,
              itens_interesse: interestDetails ? JSON.stringify(interestDetails) : '',
              chat_context: aiReply,
            })
          } catch (hErr) {
            console.log('[AI-HANDOFF-PACKET-BUILD-ERR]', hErr.message || String(hErr))
          }
        }

        console.log(
          '[HUMAN-MODE-ON]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: maskedPhone,
            paused_by: 'ia_transfer',
            reason: transferReason,
            handoff_packet: handoffPacket,
          }),
        )

        // NOTIFICAÇÃO ADICIONAL DE ESCALADA VIA WHATSAPP (11947518805)
        // Dispara para qualquer motivo de transferência humana na Camada 3 (reclamacao, nota, cobranca, aplicacao, etc.)
        // Tolerante a erro: nunca bloqueia nem atrasa a escalada
        try {
          const fn =
            (typeof notifyEscalation === 'function' && notifyEscalation) ||
            (typeof globalThis !== 'undefined' &&
              globalThis.__aiEscalationNotifier &&
              typeof globalThis.__aiEscalationNotifier.notifyEscalation === 'function' &&
              globalThis.__aiEscalationNotifier.notifyEscalation) ||
            (typeof globalThis !== 'undefined' &&
              typeof globalThis.notifyEscalation === 'function' &&
              globalThis.notifyEscalation) ||
            null

          if (fn) {
            fn({
              $app: $app,
              phone: normalizedSenderPhone || phone,
              reason: transferReason,
              incomingText: incomingText,
              aiReply: aiReply,
            })
          }
        } catch (notifErr) {
          console.log('[ESCALATION-NOTIF-HOOK-ERR]', notifErr.message || String(notifErr))
        }
      } catch (transferSaveErr) {
        console.log(
          '[CHAT-CONTROL-TRANSFER-SAVE-ERR]',
          transferSaveErr.message || String(transferSaveErr),
        )
      }
    }

    // ==========================================
    // CRIAÇÃO / ATUALIZAÇÃO DE CARD NA COLUNA LEAD (DEDUPE POR TELEFONE)
    // ==========================================
    // No handoff de interesse de compra: criar ou atualizar card na coluna "novo_lead" (Lead)
    // deduplicado estritamente por telefone.
    if (hasTransferMarker && phone) {
      // Log do resumo de interesse com horário de Brasília (UTC-3)
      let brasiliaTimeStr = ''
      try {
        const bDate = new Date(Date.now() - 3 * 3600 * 1000)
        brasiliaTimeStr = bDate.toISOString().replace('T', ' ').replace('Z', ' UTC-3')
      } catch (_) {
        brasiliaTimeStr = new Date().toISOString()
      }

      const summaryLog = {
        horarioBrasilia: brasiliaTimeStr,
        telefone: phone,
        itens: interestDetails ? interestDetails.itens : 'Não especificado',
        quantidade: interestDetails ? interestDetails.qtd : 'Não especificado',
        aplicacao: interestDetails ? interestDetails.app : 'Não especificado',
        origem: 'IA (WhatsApp)',
      }

      console.log('[INTERESSE-COMPRA-RESUMO]', JSON.stringify(summaryLog))

      try {
        const cleanP = String(phone || '').replace(/\D/g, '')
        let pWithoutDdi = cleanP
        if (pWithoutDdi.startsWith('55') && pWithoutDdi.length >= 12) {
          pWithoutDdi = pWithoutDdi.slice(2)
        }

        let existingCustomer = null
        try {
          const foundCusts = $app.findRecordsByFilter(
            'customers',
            'phone ~ {:p1} || phone ~ {:p2}',
            '-created',
            1,
            0,
            { p1: cleanP, p2: pWithoutDdi },
          )
          if (foundCusts && foundCusts.length > 0) {
            existingCustomer = foundCusts[0]
          }
        } catch (findErr) {
          console.log('[CUSTOMER-FIND-FOR-LEAD-ERR]', String(findErr))
        }

        const buildInterestNote = (prevNotes) => {
          const timestampHeader = '[' + brasiliaTimeStr + ' - Interesse IA]'
          let noteLine = timestampHeader
          if (interestDetails && (interestDetails.itens || interestDetails.qtd)) {
            noteLine +=
              ' Itens: ' +
              (interestDetails.itens || 'N/A') +
              ' | Qtd: ' +
              (interestDetails.qtd || 'N/A') +
              (interestDetails.app ? ' | Aplicação: ' + interestDetails.app : '')
          } else {
            noteLine +=
              ' Cliente solicitou cotação/compra via WhatsApp e foi transferido para atendente.'
          }

          if (prevNotes && prevNotes.trim()) {
            return noteLine + '\n---\n' + prevNotes.trim()
          }
          return noteLine
        }

        if (existingCustomer) {
          const currentCol = String(existingCustomer.getString('pipeline_status') || '').trim()

          // DEDUPE: se já está na coluna Lead (novo_lead), atualiza o card existente:
          // acrescenta itens/quantidade, marca como não visto para piscar vermelho e atualiza timestamp
          if (!currentCol || currentCol === 'novo_lead') {
            existingCustomer.set('pipeline_status', 'novo_lead')
            existingCustomer.set('lead_source', 'whatsapp')
            existingCustomer.set('lead_viewed', false)
            existingCustomer.set('notes', buildInterestNote(existingCustomer.getString('notes')))
            $app.save(existingCustomer)

            console.log(
              '[PIPELINE-LEAD-UPDATED]',
              JSON.stringify({
                timestamp: brasiliaTimeStr,
                customerId: existingCustomer.id,
                phone: maskedPhone,
                column: 'novo_lead',
                lead_viewed: false,
              }),
            )
          } else {
            // Se o contato já está em OUTRA coluna (ex: em_atendimento, orcamento_enviado, etc.),
            // loga e NÃO move automaticamente para não quebrar o funil do vendedor
            existingCustomer.set('notes', buildInterestNote(existingCustomer.getString('notes')))
            $app.save(existingCustomer)

            console.log(
              '[PIPELINE-LEAD-MAINTAINED-OTHER-COLUMN]',
              JSON.stringify({
                timestamp: brasiliaTimeStr,
                customerId: existingCustomer.id,
                phone: maskedPhone,
                currentColumn: currentCol,
                action:
                  'Apenas notas atualizadas, mantido na coluna atual conforme regra de negócio',
              }),
            )
          }
        } else {
          // Contato ainda não existe: criar novo card na coluna Lead
          try {
            const custCol = $app.findCollectionByNameOrId('customers')
            const newLead = new Record(custCol)
            newLead.set('name', phone)
            newLead.set('phone', phone)
            newLead.set('type', 'PF')
            newLead.set('lead_source', 'whatsapp')
            newLead.set('pipeline_status', 'novo_lead')
            newLead.set('lead_viewed', false)
            newLead.set('notes', buildInterestNote(''))
            $app.save(newLead)

            console.log(
              '[PIPELINE-LEAD-CREATED]',
              JSON.stringify({
                timestamp: brasiliaTimeStr,
                customerId: newLead.id,
                phone: maskedPhone,
                column: 'novo_lead',
                lead_viewed: false,
              }),
            )
          } catch (createLeadErr) {
            console.log('[PIPELINE-LEAD-CREATE-ERR]', String(createLeadErr))
          }
        }
      } catch (leadPipelineErr) {
        console.log('[PIPELINE-LEAD-GLOBAL-ERR]', String(leadPipelineErr))
      }
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
      procRecord.set('aiReplyText', cleanAiReply)
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
