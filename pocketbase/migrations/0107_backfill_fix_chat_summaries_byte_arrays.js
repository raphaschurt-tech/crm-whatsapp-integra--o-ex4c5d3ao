migrate((app) => {
  // Backfill corretivo Bug 1:
  // Restaura os resumos de chat_summaries corrompidos com byte-lixo ([]byte do Go),
  // normalizando last_seen_message_ids para arrays JSON canônicos contendo APENAS strings,
  // e reprocessando mensagens de webhook_received desde 2026-10-20T00:00:00Z para recompor
  // as mensagens recebidas recentemente, de forma estritamente idempotente.

  const getBrasiliaTimestamp = () => {
    try {
      const d = new Date()
      const spTime = new Date(d.getTime() - 3 * 3600 * 1000)
      return spTime.toISOString().replace('Z', '-03:00')
    } catch (_) {
      return new Date().toISOString()
    }
  }

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

  const isXmlRecord = (rec) => {
    const attachName = String(rec.getString('attachment_name') || '').trim()
    const attachUrl = String(rec.getString('attachment_url') || '').trim()
    const attachType = String(rec.getString('attachment_type') || '').toLowerCase()
    if (attachName && /\.xml$/i.test(attachName)) return true
    if (attachUrl && /\.xml(\?|$)/i.test(attachUrl)) return true
    if (
      attachType === 'document' &&
      (attachName.toLowerCase().includes('.xml') || attachUrl.toLowerCase().includes('.xml'))
    ) {
      return true
    }
    return false
  }

  const normalizeSeenIds = (raw) => {
    if (!raw) return []

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

    if (Array.isArray(raw)) {
      if (raw.length === 0) return []

      const isByteArray = raw.every(
        (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255,
      )
      if (isByteArray) {
        try {
          const cleanBytes = raw[raw.length - 1] === 0 ? raw.slice(0, -1) : raw
          const jsonStr = String.fromCharCode.apply(null, cleanBytes).trim()
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr)
            return normalizeSeenIds(parsed)
          }
        } catch (_) {}
        return []
      }

      const stringOnlyIds = []
      for (let i = 0; i < raw.length; i++) {
        const item = raw[i]
        if (typeof item === 'string' && item.trim().length > 0) {
          stringOnlyIds.push(item.trim())
        }
      }
      return stringOnlyIds
    }

    return []
  }

  // ETAPA 1: Carregar todos os resumos e higienizar os arrays de IDs corrompidos
  let allSummaries = []
  try {
    allSummaries = app.findRecordsByFilter('chat_summaries', '', '', 20000, 0)
  } catch (errFind) {
    console.error('[MIGRATION-0107-FIND-ERROR]', errFind.message || String(errFind))
  }

  const summariesByPhone = new Map()
  let sanitizedCount = 0

  for (let i = 0; i < allSummaries.length; i++) {
    const summary = allSummaries[i]
    const cPhone = summary.getString('canonical_phone')
    if (cPhone) {
      summariesByPhone.set(cPhone, summary)
    }

    // Verificar se o campo last_seen_message_ids atual tem byte-lixo ou precisa de limpeza
    const rawVal = summary.get('last_seen_message_ids')
    const rawStr = summary.getString('last_seen_message_ids')

    let isCorrupted = false
    if (Array.isArray(rawVal) && rawVal.length > 0) {
      const hasNumber = rawVal.some((x) => typeof x === 'number')
      if (hasNumber) isCorrupted = true
    }

    // Normaliza
    const cleanIds = normalizeSeenIds(rawVal.length ? rawVal : rawStr)

    if (isCorrupted || JSON.stringify(rawVal) !== JSON.stringify(cleanIds)) {
      summary.set('last_seen_message_ids', cleanIds)
      try {
        app.save(summary)
        sanitizedCount++
      } catch (errSaveSan) {
        console.warn(
          '[MIGRATION-0107-SANITIZE-WARN]',
          cPhone,
          errSaveSan.message || String(errSaveSan),
        )
      }
    }
  }

  console.log(
    `[MIGRATION-0107-INIT] Horário de Brasília: ${getBrasiliaTimestamp()} | Total resumos existentes: ${allSummaries.length} | Higienizados de imediato: ${sanitizedCount}`,
  )

  // ETAPA 2: Carregar read_states para cálculo preciso de unread_count
  const readStatesMap = new Map()
  try {
    const readRecords = app.findRecordsByFilter('whatsapp_read_states', '', '-created', 10000, 0)
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
    console.warn('[MIGRATION-0107-READ-STATES-WARN]', errRead.message || String(errRead))
  }

  // ETAPA 3: Reprocessar webhook_received desde 2026-10-20T00:00:00Z de forma IDEMPOTENTE
  const cutoffIso = '2026-10-20 00:00:00.000Z'
  const filterExpr = `created >= "${cutoffIso}"`

  let page = 1
  const batchSize = 1000
  let totalMessagesProcessed = 0
  let summariesUpdated = 0
  let summariesCreated = 0

  while (true) {
    let records = []
    try {
      records = app.findRecordsByFilter(
        'webhook_received',
        filterExpr,
        'created',
        batchSize,
        (page - 1) * batchSize,
      )
    } catch (eBatch) {
      console.error('[MIGRATION-0107-BATCH-ERR]', eBatch.message || String(eBatch))
      break
    }

    if (!records || records.length === 0) break
    totalMessagesProcessed += records.length

    for (let i = 0; i < records.length; i++) {
      const rec = records[i]

      // Guard S3: XML / NF-e ignorado
      if (isXmlRecord(rec)) continue

      let rawPhone = ''
      const candidateFields = ['phone', 'chat', 'sender']
      for (let f = 0; f < candidateFields.length; f++) {
        const fn = candidateFields[f]
        try {
          rawPhone = extractPhoneValue(rec.get(fn))
          if (rawPhone) break
        } catch (_) {}
        try {
          rawPhone = extractPhoneValue(rec.getString(fn))
          if (rawPhone) break
        } catch (_) {}
      }

      rawPhone = String(rawPhone || '').replace(/\D/g, '')
      const canonicalPhone = computeCanonicalPhone(rawPhone)
      if (!canonicalPhone || canonicalPhone.length < 8) continue

      // Extrair texto e preview
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
        ) {
          preview = '📍 Localização'
        } else if (lower.includes('contato:') || lower.includes('vcard')) {
          preview = '👤 Contato'
        } else {
          preview = textStr.length > 90 ? textStr.slice(0, 90) + '...' : textStr
        }
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

      let summaryRecord = summariesByPhone.get(canonicalPhone)

      if (!summaryRecord) {
        const summaryCol = app.findCollectionByNameOrId('chat_summaries')
        const newSummary = new Record(summaryCol)
        newSummary.set('canonical_phone', canonicalPhone)
        newSummary.set('raw_phone', rawPhone || canonicalPhone)
        newSummary.set('last_message_preview', preview)
        newSummary.set('last_message_direction', direction)
        newSummary.set('last_message_at', msgDateIso)
        newSummary.set('first_message_at', msgDateIso)

        const lastRead = readStatesMap.get(canonicalPhone)
        let unread = 0
        if (direction === 'inbound') {
          if (typeof lastRead === 'number' && lastRead > 0) {
            if (msgDateTime > lastRead) unread = 1
          } else {
            unread = 1
          }
        }
        newSummary.set('unread_count', unread)
        newSummary.set('tem_mensagens', true)
        newSummary.set('last_message_id', msgId)
        newSummary.set('last_seen_message_ids', msgId ? [msgId] : [])

        try {
          app.save(newSummary)
          summariesByPhone.set(canonicalPhone, newSummary)
          summariesCreated++
        } catch (saveNewErr) {
          const errMsg = saveNewErr.message || String(saveNewErr)
          if (
            errMsg.includes('Value must be unique') ||
            errMsg.includes('canonical_phone') ||
            errMsg.includes('UNIQUE constraint failed')
          ) {
            try {
              const raceFound = app.findRecordsByFilter(
                'chat_summaries',
                'canonical_phone = {:cphone}',
                '',
                1,
                0,
                { cphone: canonicalPhone },
              )
              if (raceFound && raceFound.length > 0) {
                summaryRecord = raceFound[0]
                summariesByPhone.set(canonicalPhone, summaryRecord)
              }
            } catch (_) {}
          } else {
            console.error('[MIGRATION-0107-SAVE-NEW-ERR]', canonicalPhone, errMsg)
          }
        }
      }

      if (summaryRecord) {
        let seenIds = normalizeSeenIds(summaryRecord.get('last_seen_message_ids'))
        if (seenIds.length === 0) {
          seenIds = normalizeSeenIds(summaryRecord.getString('last_seen_message_ids'))
        }

        const isDuplicate =
          msgId && (summaryRecord.getString('last_message_id') === msgId || seenIds.includes(msgId))

        if (!isDuplicate) {
          if (msgId) {
            if (!seenIds.includes(msgId)) {
              seenIds.push(String(msgId).trim())
            }
            if (seenIds.length > 50) {
              seenIds = seenIds.slice(-50)
            }
            summaryRecord.set('last_seen_message_ids', seenIds)
          }

          const curFirstAt = summaryRecord.getString('first_message_at')
          if (!curFirstAt) {
            summaryRecord.set('first_message_at', msgDateIso)
          }

          const existingLastAtStr = summaryRecord.getString('last_message_at')
          const existingLastAtTime = existingLastAtStr ? new Date(existingLastAtStr).getTime() : 0

          if (msgDateTime >= existingLastAtTime) {
            summaryRecord.set('last_message_preview', preview)
            summaryRecord.set('last_message_direction', direction)
            summaryRecord.set('last_message_at', msgDateIso)
            summaryRecord.set('last_message_id', msgId)
          }

          if (direction === 'inbound') {
            const lastRead = readStatesMap.get(canonicalPhone)
            if (typeof lastRead === 'number' && lastRead > 0) {
              if (msgDateTime > lastRead) {
                const curUnread = Number(summaryRecord.get('unread_count')) || 0
                summaryRecord.set('unread_count', curUnread + 1)
              }
            } else {
              const curUnread = Number(summaryRecord.get('unread_count')) || 0
              summaryRecord.set('unread_count', curUnread + 1)
            }
          }

          summaryRecord.set('tem_mensagens', true)

          try {
            app.save(summaryRecord)
            summariesUpdated++
          } catch (updateErr) {
            console.error(
              '[MIGRATION-0107-UPDATE-ERR]',
              canonicalPhone,
              updateErr.message || String(updateErr),
            )
          }
        }
      }
    }

    if (records.length < batchSize) break
    page++
  }

  console.log(
    `[MIGRATION-0107-SUCCESS] Horário de Brasília: ${getBrasiliaTimestamp()} | Registros higienizados: ${sanitizedCount} | Mensagens reprocessadas: ${totalMessagesProcessed} | Resumos atualizados: ${summariesUpdated} | Resumos criados: ${summariesCreated}`,
  )
})
