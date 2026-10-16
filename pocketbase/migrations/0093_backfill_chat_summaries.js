migrate((app) => {
  // Migração idempotente com escopo COMPLETO:
  // Popula chat_summaries varrendo o histórico INTEIRO de webhook_received em lotes.
  // 2a. GUARDA: criar APENAS resumos AUSENTES (upsert quando o registro não existe).
  // Nunca sobrescreve resumo existente que já foi criado ou mantido em tempo real.
  // 2c. GUARDA de inicialização do contador: porta o estado de leitura EXISTENTE (whatsapp_read_states).
  // Se não houver estado de leitura persistido, iniciar em 0. NUNCA contar histórico inteiro como não lido.

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

  // 1. Carregar mapa de leituras existentes de whatsapp_read_states
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
    console.log('[MIGRATION-0093-READ-STATES-WARN]', errRead.message || String(errRead))
  }

  // 2. Carregar resumos já existentes em chat_summaries para não tocar neles (Guard 2a)
  const existingSummariesSet = new Set()
  try {
    const existingSums = app.findRecordsByFilter('chat_summaries', '', '-created', 10000, 0)
    for (let s = 0; s < existingSums.length; s++) {
      const cPhone = existingSums[s].getString('canonical_phone')
      if (cPhone) existingSummariesSet.add(cPhone)
    }
  } catch (_) {}

  // 3. Processar mensagens do webhook em lotes cronológicos (created ASC)
  // Agrupar por canonical_phone para encontrar first_message_at, last_message_at, preview, unread_count
  const convMap = new Map()

  const BATCH_SIZE = 500
  let page = 0
  let hasMore = true

  while (hasMore) {
    let batch = []
    try {
      batch = app.findRecordsByFilter(
        'webhook_received',
        '',
        'created',
        BATCH_SIZE,
        page * BATCH_SIZE,
      )
    } catch (eBatch) {
      console.log('[MIGRATION-0093-BATCH-ERR]', eBatch.message || String(eBatch))
      break
    }

    if (!batch || batch.length === 0) {
      hasMore = false
      break
    }

    for (let i = 0; i < batch.length; i++) {
      const rec = batch[i]

      let rawPhone = ''
      try {
        const p = rec.get('phone')
        if (typeof p === 'string') rawPhone = p
        else if (p && typeof p === 'object' && p.phone) rawPhone = String(p.phone)
      } catch (_) {}
      if (!rawPhone) {
        try {
          const c = rec.get('chat')
          if (typeof c === 'string') rawPhone = c
          else if (c && typeof c === 'object' && c.phone) rawPhone = String(c.phone)
        } catch (_) {}
      }
      if (!rawPhone) {
        try {
          const s = rec.get('sender')
          if (typeof s === 'string') rawPhone = s
          else if (s && typeof s === 'object' && s.phone) rawPhone = String(s.phone)
        } catch (_) {}
      }

      const canonicalPhone = computeCanonicalPhone(rawPhone)
      if (!canonicalPhone || canonicalPhone.length < 8) continue

      // Se já existe resumo salvo em chat_summaries, pular agrupamento dele (Guard 2a)
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

      // 1a. firstMessageAt é a primeira encontrada (batch está em created ASC)
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

      // 1e. lastMessageAt segue a de maior timestamp
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

      // 2c. Guard de leitura: calcular unread_count se direção for inbound e timestamp > lastReadAt
      // Se não houver lastReadAt no mapa, NÃO soma todas (evita marcar histórico inteiro como unread)
      const lastRead = readStatesMap.get(canonicalPhone)
      if (direction === 'inbound') {
        if (typeof lastRead === 'number' && lastRead > 0) {
          if (msgDateTime > lastRead) {
            conv.unreadCount += 1
          }
        } else {
          // Se não há read_state persistido, inicia em 0 conforme Guard 2c
          conv.unreadCount = 0
        }
      }
    }

    page++
    if (batch.length < BATCH_SIZE) {
      hasMore = false
      break
    }
  }

  // 4. Salvar os novos resumos na coleção chat_summaries
  const summaryCol = app.findCollectionByNameOrId('chat_summaries')
  let createdCount = 0

  convMap.forEach((conv, canonicalPhone) => {
    // 2a. Guard: criar APENAS ausentes
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
      app.save(newRec)
      createdCount++
    } catch (saveErr) {
      console.log('[MIGRATION-0093-SAVE-ERR]', canonicalPhone, saveErr.message || String(saveErr))
    }
  })

  console.log(
    `[MIGRATION-0093] Concluída: ${createdCount} novos resumos criados em chat_summaries.`,
  )

  // 5. Marcar chat_summaries_migrated = true em settings (2b. Guard de cut-over)
  try {
    const settingsList = app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (settingsList && settingsList.length > 0) {
      const s = settingsList[0]
      s.set('chat_summaries_migrated', true)
      app.save(s)
      console.log('[MIGRATION-0093] Flag chat_summaries_migrated = true ativada com sucesso!')
    }
  } catch (errSet) {
    console.log('[MIGRATION-0093-FLAG-SET-WARN]', errSet.message || String(errSet))
  }
})
