migrate((app) => {
  // Backfill corretivo 19/10 (PARTE 1 — item 3):
  // Reprocessa os registros de webhook_received de 19/10 00:00:00 UTC em diante
  // para reconstruir e atualizar os chat_summaries com guards estritas:
  // - Idempotente: atualiza existentes ou cria novos sem duplicar registros
  // - Cascata ZERO: não dispara IA, não manda mensagem, não cria lead repetido
  // - Regra S3: ignora mensagens XML/NF-e (não viram conversa nem resumo nem badge)

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

  // 1. Carregar mapa de leituras de whatsapp_read_states
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
    console.log('[MIGRATION-0100-READ-STATES-WARN]', errRead.message || String(errRead))
  }

  // 2. Carregar TODOS os resumos existentes em chat_summaries em um Map indexado por canonical_phone
  // com sort VÁLIDO (-last_message_at) + fallback sem sort
  const summariesMap = new Map()
  try {
    let existingSums = []
    try {
      existingSums = app.findRecordsByFilter('chat_summaries', '', '-last_message_at', 20000, 0)
    } catch (_) {
      existingSums = app.findRecordsByFilter('chat_summaries', '', '', 20000, 0)
    }
    for (let s = 0; s < existingSums.length; s++) {
      const rec = existingSums[s]
      const cPhone = rec.getString('canonical_phone')
      if (cPhone) {
        summariesMap.set(cPhone, rec)
      }
    }
  } catch (errSums) {
    console.log('[MIGRATION-0100-SUMMARIES-WARN]', errSums.message || String(errSums))
  }

  // 3. Processar mensagens do webhook_received de 19/10/2026 00:00:00 UTC em diante
  // ordenadas por created ASC para reproduzir cronologia fiel
  const cutoffIso = '2026-10-19 00:00:00.000Z'
  const filterExpr = `created >= "${cutoffIso}"`

  let page = 1
  const batchSize = 1000
  let totalProcessed = 0
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
      console.log('[MIGRATION-0100-BATCH-ERR]', eBatch.message || String(eBatch))
      break
    }

    if (!records || records.length === 0) break
    totalProcessed += records.length

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

      // Verificar se já existe summaryRecord no Map
      let summaryRecord = summariesMap.get(canonicalPhone)

      if (!summaryRecord) {
        // Criar novo resumo
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
          summariesMap.set(canonicalPhone, newSummary)
          summariesCreated++
        } catch (saveNewErr) {
          const errMsg = saveNewErr.message || String(saveNewErr)
          if (
            errMsg.includes('Value must be unique') ||
            errMsg.includes('canonical_phone') ||
            errMsg.includes('UNIQUE constraint failed')
          ) {
            // Corrida detectada: rebuscar e reatribuir ao Map
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
                summariesMap.set(canonicalPhone, summaryRecord)
              }
            } catch (_) {}
          } else {
            console.log('[MIGRATION-0100-SAVE-NEW-ERR]', canonicalPhone, errMsg)
          }
        }
      }

      if (summaryRecord) {
        // Atualizar resumo existente se a mensagem for nova ou tiver maior timestamp
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
            console.log(
              '[MIGRATION-0100-UPDATE-ERR]',
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
    `[MIGRATION-0100] Concluída com sucesso: ${totalProcessed} mensagens do dia 19/10 processadas. Resumos criados: ${summariesCreated}, atualizados: ${summariesUpdated}.`,
  )
})
