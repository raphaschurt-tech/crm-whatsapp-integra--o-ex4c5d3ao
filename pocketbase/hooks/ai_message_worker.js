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
