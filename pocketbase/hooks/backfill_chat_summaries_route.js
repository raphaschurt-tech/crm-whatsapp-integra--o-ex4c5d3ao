routerAdd('GET', '/backend/v1/run-summaries-backfill', (c) => {
  try {
    const computeCanonicalPhone = (p) => {
      if (!p) return ''
      const s = String(p).trim()
      if (s.toLowerCase().includes('@lid')) return ''
      const digits = s.replace(/\D/g, '')
      if (!digits || digits.length >= 14) return ''
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        return digits.slice(2)
      }
      return digits
    }

    // 1. Carregar mapa de leituras existentes
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
    } catch (errRead) {
      console.log('[BACKFILL-ROUTE-READ-STATES-WARN]', errRead.message || String(errRead))
    }

    // 2. Carregar resumos já existentes em um Map indexado por canonical_phone para permitir update
    const summariesMap = new Map()
    try {
      let existingSums = []
      try {
        existingSums = $app.findRecordsByFilter('chat_summaries', '', '-last_message_at', 20000, 0)
      } catch (_) {
        existingSums = $app.findRecordsByFilter('chat_summaries', '', '', 20000, 0)
      }
      for (let s = 0; s < existingSums.length; s++) {
        const rec = existingSums[s]
        const cPhone = rec.getString('canonical_phone')
        if (cPhone) summariesMap.set(cPhone, rec)
      }
    } catch (_) {}

    const extractPhoneString = (raw) => {
      if (!raw) return ''
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed && typeof parsed === 'object') {
              return String(parsed.phone || parsed.number || parsed.id || parsed.chatId || '')
            }
          } catch (_) {}
        }
        return trimmed
      }
      if (typeof raw === 'object') {
        return String(raw.phone || raw.number || raw.id || raw.chatId || '')
      }
      return String(raw)
    }

    const isXmlRecord = (rec) => {
      const attachName = String(rec.getString('attachment_name') || '').trim()
      const attachUrl = String(rec.getString('attachment_url') || '').trim()
      const attachType = String(rec.getString('attachment_type') || '').toLowerCase()
      if (attachName && /\.xml$/i.test(attachName)) return true
      if (attachUrl && /\.xml(\?|$)/i.test(attachUrl)) return true
      if (
        attachType === 'document' &&
        (attachName.toLowerCase().includes('.xml') || attachUrl.toLowerCase().includes('.xml'))
      )
        return true
      return false
    }

    // 3. Processar mensagens em lotes
    const convMap = new Map()
    let page = 1
    const batchSize = 1000
    let totalMessagesProcessed = 0

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
        console.log('[BACKFILL-ROUTE-BATCH-ERR]', eBatch.message || String(eBatch))
        break
      }

      if (!records || records.length === 0) break
      totalMessagesProcessed += records.length

      for (let i = 0; i < records.length; i++) {
        const rec = records[i]

        // Regra S3: XML / NF-e nunca vira conversa nem resumo
        if (isXmlRecord(rec)) continue

        let rawPhone = ''
        try {
          rawPhone = extractPhoneString(rec.get('phone'))
        } catch (_) {}
        if (!rawPhone) {
          try {
            rawPhone = extractPhoneString(rec.getString('phone'))
          } catch (_) {}
        }
        if (!rawPhone) {
          try {
            rawPhone = extractPhoneString(rec.get('chat'))
          } catch (_) {}
        }
        if (!rawPhone) {
          try {
            rawPhone = extractPhoneString(rec.getString('chat'))
          } catch (_) {}
        }
        if (!rawPhone) {
          try {
            rawPhone = extractPhoneString(rec.get('sender'))
          } catch (_) {}
        }
        if (!rawPhone) {
          try {
            rawPhone = extractPhoneString(rec.getString('sender'))
          } catch (_) {}
        }

        const canonicalPhone = computeCanonicalPhone(rawPhone)
        if (!canonicalPhone || canonicalPhone.length < 8) continue

        let conv = convMap.get(canonicalPhone)
        if (!conv) {
          const existingDbRec = summariesMap.get(canonicalPhone)
          let existingSeenIds = []
          if (existingDbRec) {
            try {
              const rawSeen = existingDbRec.get('last_seen_message_ids')
              if (Array.isArray(rawSeen)) existingSeenIds = rawSeen
              else if (typeof rawSeen === 'string') existingSeenIds = JSON.parse(rawSeen)
            } catch (_) {}
          }

          conv = {
            canonicalPhone,
            rawPhone:
              (existingDbRec && existingDbRec.getString('raw_phone')) || rawPhone || canonicalPhone,
            firstMessageAt: (existingDbRec && existingDbRec.getString('first_message_at')) || '',
            lastMessageAt: (existingDbRec && existingDbRec.getString('last_message_at')) || '',
            lastMessagePreview:
              (existingDbRec && existingDbRec.getString('last_message_preview')) || '',
            lastMessageDirection:
              (existingDbRec && existingDbRec.getString('last_message_direction')) || 'inbound',
            lastMessageId: (existingDbRec && existingDbRec.getString('last_message_id')) || '',
            unreadCount: (existingDbRec && Number(existingDbRec.get('unread_count'))) || 0,
            temMensagens: true,
            lastSeenIds: existingSeenIds,
            isExistingRecord: Boolean(existingDbRec),
            dbRecordId: existingDbRec ? existingDbRec.id : '',
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

        // 1a. firstMessageAt na primeira ocorrência
        if (!conv.firstMessageAt) {
          conv.firstMessageAt = msgDateIso
        }

        // Preview de mídia
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

        // 2c. Guard de leitura
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
    let updatedCount = 0

    convMap.forEach((conv, canonicalPhone) => {
      try {
        const existingRec = summariesMap.get(canonicalPhone)
        if (existingRec) {
          // Atualizar resumo existente
          existingRec.set('raw_phone', conv.rawPhone || existingRec.getString('raw_phone'))
          if (conv.lastMessagePreview)
            existingRec.set('last_message_preview', conv.lastMessagePreview)
          if (conv.lastMessageDirection)
            existingRec.set('last_message_direction', conv.lastMessageDirection)
          if (conv.lastMessageAt) existingRec.set('last_message_at', conv.lastMessageAt)
          if (!existingRec.getString('first_message_at') && conv.firstMessageAt) {
            existingRec.set('first_message_at', conv.firstMessageAt)
          }
          existingRec.set('unread_count', conv.unreadCount || 0)
          existingRec.set('tem_mensagens', true)
          if (conv.lastMessageId) existingRec.set('last_message_id', conv.lastMessageId)
          existingRec.set('last_seen_message_ids', conv.lastSeenIds)
          $app.save(existingRec)
          updatedCount++
        } else {
          // Criar novo resumo
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
          summariesMap.set(canonicalPhone, newRec)
          createdCount++
        }
      } catch (saveErr) {
        console.log('[BACKFILL-SAVE-ERR]', canonicalPhone, saveErr.message || String(saveErr))
      }
    })

    // 2b. Marcar chat_summaries_migrated = true em settings
    try {
      const settingsList = $app.findRecordsByFilter('settings', '', '-created', 1, 0)
      if (settingsList && settingsList.length > 0) {
        const s = settingsList[0]
        s.set('chat_summaries_migrated', true)
        $app.save(s)
      }
    } catch (sErr) {
      console.log('[BACKFILL-SETTINGS-ERR]', sErr.message || String(sErr))
    }

    return c.json(200, {
      success: true,
      totalMessagesProcessed,
      conversationsFound: convMap.size,
      createdCount,
      updatedCount,
    })
  } catch (err) {
    return c.json(500, { error: err.message || String(err) })
  }
})
