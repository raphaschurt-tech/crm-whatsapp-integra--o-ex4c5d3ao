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

    // Função auxiliar robusta para extrair telefone de qualquer formato:
    // - string pura: "5511999999999"
    // - string JSON: '{"phone":"5511..."}'
    // - objeto JS: { phone: "5511..." }
    const extractPhoneValue = (val) => {
      if (!val) return ''
      if (typeof val === 'string') {
        const trimmed = val.trim()
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
      if (typeof val === 'object') {
        return String(val.phone || val.number || val.id || val.chatId || '')
      }
      return String(val)
    }

    let rawPhone = ''
    const candidateFields = ['phone', 'chat', 'sender']
    for (let f = 0; f < candidateFields.length; f++) {
      const fieldName = candidateFields[f]
      // Tentar get (objeto/tipo nativo)
      try {
        const v = record.get(fieldName)
        rawPhone = extractPhoneValue(v)
        if (rawPhone) break
      } catch (_) {}

      // Tentar getString (se gravado como string ou retornado como string JSON)
      try {
        const s = record.getString(fieldName)
        rawPhone = extractPhoneValue(s)
        if (rawPhone) break
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
    } else {
      // FAIL-ALOUD EXPLÍCITO: NUNCA MAIS SILENCIOSO QUANDO NÃO CONSEGUIR EXTRAIR TELEFONE
      console.error(
        '[WEBHOOK-COLLECTION-RECEIVED-FAIL-ALOUD] [PHONE-EXTRACTION-FAILED]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          recordId: record.id,
          messageId: messageId,
          type: recordType,
          rawPhoneField: String(record.getString('phone') || record.get('phone') || ''),
          rawChatField: String(record.getString('chat') || record.get('chat') || ''),
          rawSenderField: String(record.getString('sender') || record.get('sender') || ''),
          error:
            'Não foi possível extrair número de telefone do registro webhook_received. Resumo não atualizado.',
        }),
      )
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

    // Função auxiliar para obter timestamp formatado em horário de Brasília (UTC-3)
    const getBrasiliaTimestamp = () => {
      try {
        const d = new Date()
        const spTime = new Date(d.getTime() - 3 * 3600 * 1000)
        return spTime.toISOString().replace('Z', '-03:00')
      } catch (_) {
        return new Date().toISOString()
      }
    }

    // Normalizador canônico para last_seen_message_ids:
    // Garante que o valor gravado seja SEMPRE um array JSON canônico contendo APENAS strings válidas.
    // Converte []byte do Go (array de números inteiros ASCII) de volta em string -> JSON.parse -> strings.
    // Qualquer valor corrompido ou ilegível é normalizado para [].
    const normalizeSeenIds = (raw) => {
      if (!raw) return []

      // Se for string JSON
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!trimmed) return []
        try {
          const parsed = JSON.parse(trimmed)
          return normalizeSeenIds(parsed)
        } catch (_) {
          return []
        }
      }

      // Se for Array
      if (Array.isArray(raw)) {
        if (raw.length === 0) return []

        // Verifica se é array de bytes ASCII do Go (números inteiros 0-255)
        const isByteArray = raw.every(
          (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255,
        )
        if (isByteArray) {
          try {
            // Ignora null terminator (\0) no fim se houver
            const cleanBytes = raw[raw.length - 1] === 0 ? raw.slice(0, -1) : raw
            const jsonStr = String.fromCharCode.apply(null, cleanBytes).trim()
            if (jsonStr) {
              const parsed = JSON.parse(jsonStr)
              return normalizeSeenIds(parsed)
            }
          } catch (e) {
            console.warn(
              '[CHAT-SUMMARY-BYTE-PARSE-WARN]',
              JSON.stringify({
                timestampBrasilia: getBrasiliaTimestamp(),
                reason: 'Falha ao converter []byte em JSON, redefinindo para []',
                error: e.message || String(e),
              }),
            )
          }
          return []
        }

        // Array regular: filtrar EXCLUSIVAMENTE strings não-vazias
        const stringOnlyIds = []
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i]
          if (typeof item === 'string' && item.trim().length > 0) {
            stringOnlyIds.push(item.trim())
          }
        }
        return stringOnlyIds
      }

      // Objeto ou qualquer outro tipo inesperado
      return []
    }

    // ==========================================
    // UPSERT DO RESUMO DA CONVERSA (chat_summaries)
    // ==========================================
    // REGRA S3 / XML: notas fiscais desviadas ou mensagens XML NUNCA viram conversa nem resumo nem badge!
    const isXmlMessage = Boolean(
      (record.getString('attachment_name') &&
        /\.xml$/i.test(record.getString('attachment_name').trim())) ||
      (record.getString('attachment_url') &&
        /\.xml(\?|$)/i.test(record.getString('attachment_url').trim())) ||
      (record.getString('attachment_type') === 'document' &&
        (record.getString('attachment_name').toLowerCase().includes('.xml') ||
          record.getString('attachment_url').toLowerCase().includes('.xml'))),
    )
    if (isXmlMessage) {
      console.log(
        '[WEBHOOK-COLLECTION-RECEIVED-XML-SKIPPED]',
        JSON.stringify({
          messageId: messageId,
          reason: 'Mensagem XML/NF-e ignorada no resumo de atendimento (Regra S3).',
        }),
      )
      return e.next()
    }

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
      // 1. Lookup com sort VÁLIDO (-last_message_at) + fallback sem sort se o sort falhar
      try {
        const found = $app.findRecordsByFilter(
          'chat_summaries',
          'canonical_phone = {:cphone}',
          '-last_message_at',
          1,
          0,
          { cphone: canonicalPhone },
        )
        if (found && found.length > 0) {
          summaryRecord = found[0]
        }
      } catch (lookupErr) {
        console.log(
          '[CHAT-SUMMARY-LOOKUP-WARN-SORT]',
          lookupErr.message || String(lookupErr),
          'Tentando fallback sem sort...',
        )
        try {
          const fallbackFound = $app.findRecordsByFilter(
            'chat_summaries',
            'canonical_phone = {:cphone}',
            '',
            1,
            0,
            { cphone: canonicalPhone },
          )
          if (fallbackFound && fallbackFound.length > 0) {
            summaryRecord = fallbackFound[0]
          }
        } catch (fallbackErr) {
          console.error(
            '[CHAT-SUMMARY-LOOKUP-FAIL-ALOUD]',
            fallbackErr.message || String(fallbackErr),
          )
        }
      }

      if (!summaryRecord) {
        // Criar novo resumo com guarda à prova de corrida (unique canonical_phone)
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

        try {
          $app.save(newSummary)
        } catch (saveNewErr) {
          const errMsg = saveNewErr.message || String(saveNewErr)
          // Se falhar por violação de unicidade de canonical_phone, recuperar por relookup e atualizar
          if (
            errMsg.includes('Value must be unique') ||
            errMsg.includes('canonical_phone') ||
            errMsg.includes('UNIQUE constraint failed')
          ) {
            console.log(
              '[CHAT-SUMMARY-RACE-RECOVER]',
              JSON.stringify({
                canonicalPhone: canonicalPhone,
                note: 'Colisão de índice único detectada ao criar resumo; recuperando registro existente para atualizar.',
              }),
            )
            try {
              const raceFound = $app.findRecordsByFilter(
                'chat_summaries',
                'canonical_phone = {:cphone}',
                '',
                1,
                0,
                { cphone: canonicalPhone },
              )
              if (raceFound && raceFound.length > 0) {
                summaryRecord = raceFound[0]
              }
            } catch (raceLookupErr) {
              console.error(
                '[CHAT-SUMMARY-RACE-RELOOKUP-FAIL-ALOUD]',
                raceLookupErr.message || String(raceLookupErr),
              )
            }
          } else {
            // Outro erro de salvamento
            console.error('[CHAT-SUMMARY-CREATE-FAIL-ALOUD]', errMsg)
          }
        }
      }

      if (summaryRecord) {
        // 1e. Idempotência por messageId com normalização robusta
        let seenIds = []
        try {
          const rawSeen = summaryRecord.get('last_seen_message_ids')
          seenIds = normalizeSeenIds(rawSeen)
          if (seenIds.length === 0) {
            const rawSeenStr = summaryRecord.getString('last_seen_message_ids')
            if (rawSeenStr) {
              seenIds = normalizeSeenIds(rawSeenStr)
            }
          }
        } catch (normErr) {
          console.warn(
            '[CHAT-SUMMARY-NORM-IDS-WARN]',
            JSON.stringify({
              timestampBrasilia: getBrasiliaTimestamp(),
              canonicalPhone: canonicalPhone,
              error: normErr.message || String(normErr),
            }),
          )
          seenIds = []
        }

        const isDuplicate =
          msgId && (summaryRecord.getString('last_message_id') === msgId || seenIds.includes(msgId))

        if (!isDuplicate) {
          if (msgId) {
            // Garante que não adicione duplicado e que msgId seja string
            if (!seenIds.includes(msgId)) {
              seenIds.push(String(msgId).trim())
            }
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
    // FAIL-ALOUD EXPLÍCITO: Log de erro alto para qualquer falha não capturada no processamento do resumo
    // Sempre com timestamp em horário de Brasília (UTC-3)
    let bTimestamp = new Date().toISOString()
    try {
      const d = new Date()
      bTimestamp = new Date(d.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
    } catch (_) {}

    console.error(
      '[WEBHOOK-COLLECTION-RECEIVED-ERROR-FAIL-ALOUD]',
      JSON.stringify({
        timestampBrasilia: bTimestamp,
        timestamp: new Date().toISOString(),
        error: err.message || String(err),
        stack: err.stack || undefined,
      }),
    )
  }

  e.next()
}, 'webhook_received')
