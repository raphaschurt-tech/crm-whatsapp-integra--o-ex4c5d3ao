onRecordAfterCreateSuccess((e) => {
  try {
    const record = e.record
    const recordType = record.getString('type') || ''
    const messageId = record.getString('messageId') || ''
    const rawInstanceId = record.getString('instanceId') || ''

    let maskedInstanceId = ''
    if (rawInstanceId) {
      if (rawInstanceId.length > 8) {
        maskedInstanceId = rawInstanceId.slice(0, 4) + '****' + rawInstanceId.slice(-4)
      } else {
        maskedInstanceId = '****'
      }
    }

    let rawPhone = ''
    try {
      const phoneVal = record.get('phone')
      if (phoneVal) {
        if (typeof phoneVal === 'string') {
          rawPhone = phoneVal
        } else if (typeof phoneVal === 'object' && phoneVal.phone) {
          rawPhone = String(phoneVal.phone)
        }
      }
    } catch (_) {}

    if (!rawPhone) {
      try {
        const chatVal = record.get('chat')
        if (chatVal) {
          if (typeof chatVal === 'string') {
            rawPhone = chatVal
          } else if (typeof chatVal === 'object' && chatVal.phone) {
            rawPhone = String(chatVal.phone)
          }
        }
      } catch (_) {}
    }

    if (!rawPhone) {
      try {
        const senderVal = record.get('sender')
        if (senderVal) {
          if (typeof senderVal === 'string') {
            rawPhone = senderVal
          } else if (typeof senderVal === 'object' && senderVal.phone) {
            rawPhone = String(senderVal.phone)
          }
        }
      } catch (_) {}
    }

    rawPhone = String(rawPhone || '').replace(/\D/g, '')

    let maskedSenderPhone = ''
    if (rawPhone) {
      if (rawPhone.length > 4) {
        maskedSenderPhone = '****' + rawPhone.slice(-4)
      } else {
        maskedSenderPhone = '****'
      }
    }

    console.log(
      '[WEBHOOK-COLLECTION-RECEIVED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        type: recordType,
        instanceId: maskedInstanceId,
        senderPhone: maskedSenderPhone,
        messageId: messageId,
      }),
    )

    // ==========================================
    // UPSERT DO RESUMO DA CONVERSA (chat_summaries)
    // ==========================================
    // 1c. Telefone canônico: remove 55 se 12/13 dígitos, descarta LIDs
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

    const canonicalPhone = computeCanonicalPhone(rawPhone)
    if (canonicalPhone && canonicalPhone.length >= 8) {
      // Extrair texto da mensagem
      let text = ''
      try {
        const rawText = record.getString('text') || ''
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
          const textVal = record.get('text')
          if (typeof textVal === 'string') text = textVal
          else if (textVal && typeof textVal === 'object') {
            text = String(textVal.message || textVal.text || textVal.conversation || '')
          }
        }
      } catch (_) {}
      const textStr = String(text || '').trim()

      // 1d. Preview de mídia considerando o tipo da mensagem
      const computeMediaPreview = () => {
        const isAudio = Boolean(record.get('is_audio')) || Boolean(record.get('audio_url'))
        if (isAudio) return '🎤 Áudio'

        const attachType = String(record.getString('attachment_type') || '').toLowerCase()
        const attachUrl = String(record.getString('attachment_url') || '').trim()

        if (
          attachType === 'image' ||
          (!attachType && attachUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(attachUrl))
        ) {
          return textStr ? `📷 Foto: ${textStr}` : '📷 Foto'
        }
        if (
          attachType === 'video' ||
          (!attachType && attachUrl && /\.(mp4|mov|avi|mkv)/i.test(attachUrl))
        ) {
          return textStr ? `🎥 Vídeo: ${textStr}` : '🎥 Vídeo'
        }
        if (attachType === 'audio') {
          return '🎤 Áudio'
        }
        if (attachType === 'document' || attachUrl) {
          const attachName = String(record.getString('attachment_name') || '').trim()
          return attachName ? `📄 Documento: ${attachName}` : '📄 Documento'
        }

        if (textStr) {
          const lower = textStr.toLowerCase()
          if (lower.includes('figurinha') || lower.includes('sticker')) return '💟 Figurinha'
          if (
            lower.includes('localização') ||
            lower.includes('localizacao') ||
            lower.includes('maps.google')
          )
            return '📍 Localização'
          if (lower.includes('contato:') || lower.includes('vcard')) return '👤 Contato'
          return textStr.length > 90 ? textStr.slice(0, 90) + '...' : textStr
        }

        return 'Mensagem'
      }

      const preview = computeMediaPreview()
      const msgId = String(record.getString('messageId') || record.id || '').trim()
      const isFromMe = Boolean(record.get('fromMe'))
      const direction = isFromMe ? 'outbound' : 'inbound'

      let msgDate
      const momentVal = Number(record.get('moment'))
      if (momentVal && momentVal > 0) {
        msgDate = new Date(momentVal * 1000)
      } else {
        const createdStr = record.getString('created') || record.created
        msgDate = createdStr ? new Date(createdStr) : new Date()
      }
      const msgDateIso = !isNaN(msgDate.getTime())
        ? msgDate.toISOString()
        : new Date().toISOString()
      const msgDateTime = msgDate.getTime()

      let summaryRecord = null
      try {
        const found = $app.findRecordsByFilter(
          'chat_summaries',
          'canonical_phone = {:cphone}',
          '-created',
          1,
          0,
          { cphone: canonicalPhone },
        )
        if (found && found.length > 0) {
          summaryRecord = found[0]
        }
      } catch (lookupErr) {
        console.log('[CHAT-SUMMARY-LOOKUP-ERR]', lookupErr.message || String(lookupErr))
      }

      if (!summaryRecord) {
        // Criar novo resumo
        const summaryCol = $app.findCollectionByNameOrId('chat_summaries')
        const newSummary = new Record(summaryCol)
        newSummary.set('canonical_phone', canonicalPhone)
        newSummary.set('raw_phone', rawPhone || canonicalPhone)
        newSummary.set('last_message_preview', preview)
        newSummary.set('last_message_direction', direction)
        newSummary.set('last_message_at', msgDateIso)
        newSummary.set('first_message_at', msgDateIso) // 1a. Gravado na criação
        newSummary.set('unread_count', direction === 'inbound' ? 1 : 0) // 1b. Badge só se inbound
        newSummary.set('tem_mensagens', true)
        newSummary.set('last_message_id', msgId)
        newSummary.set('last_seen_message_ids', msgId ? [msgId] : [])
        $app.save(newSummary)
      } else {
        // 1e. Idempotência por messageId
        let seenIds = []
        try {
          const rawSeen = summaryRecord.get('last_seen_message_ids')
          if (Array.isArray(rawSeen)) seenIds = rawSeen
          else if (typeof rawSeen === 'string') seenIds = JSON.parse(rawSeen)
        } catch (_) {}

        const isDuplicate =
          msgId && (summaryRecord.getString('last_message_id') === msgId || seenIds.includes(msgId))

        if (!isDuplicate) {
          if (msgId) {
            seenIds.push(msgId)
            if (seenIds.length > 50) {
              seenIds = seenIds.slice(-50)
            }
            summaryRecord.set('last_seen_message_ids', seenIds)
          }

          // 1a. NUNCA sobrescrever first_message_at se já existir
          const curFirstAt = summaryRecord.getString('first_message_at')
          if (!curFirstAt) {
            summaryRecord.set('first_message_at', msgDateIso)
          }

          // 1e. last_message_at e preview seguem a mensagem de maior timestamp
          const existingLastAtStr = summaryRecord.getString('last_message_at')
          const existingLastAtTime = existingLastAtStr ? new Date(existingLastAtStr).getTime() : 0

          if (msgDateTime >= existingLastAtTime) {
            summaryRecord.set('last_message_preview', preview)
            summaryRecord.set('last_message_direction', direction)
            summaryRecord.set('last_message_at', msgDateIso)
            summaryRecord.set('last_message_id', msgId)
          }

          // 1b. Badge incrementado APENAS se direction === 'inbound'
          if (direction === 'inbound') {
            const curUnread = Number(summaryRecord.get('unread_count')) || 0
            summaryRecord.set('unread_count', curUnread + 1)
          }

          summaryRecord.set('tem_mensagens', true)
          $app.save(summaryRecord)
        }
      }
    }
  } catch (err) {
    console.log('[WEBHOOK-COLLECTION-RECEIVED-ERROR]', err.message || String(err))
  }

  e.next()
}, 'webhook_received')
