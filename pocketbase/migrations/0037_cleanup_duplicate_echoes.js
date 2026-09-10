migrate(
  (app) => {
    // Migração 0037: Limpeza real e definitiva de ecos duplicados no webhook_received
    // Regra:
    // Para cada registro com fromMe=true e type='ReceivedCallback':
    // Se existir:
    // (a) outro webhook_received com mesmo telefone e mesmo texto criado até ~5 minutos antes, OU
    // (b) um registro em message_processing do mesmo telefone com aiReplyText igual ao texto criado até ~10 minutos antes
    // então o eco é duplicado e deve ser DELETADO.
    // Manter sempre o registro original (AgentSentMessage) ou a resposta da IA.

    function extractPhoneFromRec(rec) {
      if (!rec) return ''
      let raw = rec.getString('phone') || rec.getString('chat') || ''
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            raw = String(parsed.phone || parsed.number || parsed.id || raw)
          }
        } catch (_) {}
      }
      let digits = String(raw).replace(/\D/g, '')
      if (!digits) return ''
      if (digits.length === 10 || digits.length === 11) {
        digits = '55' + digits
      }
      return digits
    }

    function extractTextFromRec(rec) {
      if (!rec) return ''
      let raw = rec.getString('text') || ''
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            return String(parsed.message || parsed.text || parsed.conversation || '').trim()
          }
        } catch (_) {}
        return String(raw).trim()
      }
      return ''
    }

    function getTimestampMs(createdStr, momentVal) {
      if (momentVal && Number(momentVal) > 0) {
        const m = Number(momentVal)
        return m > 1e11 ? m : m * 1000
      }
      if (createdStr) {
        const t = new Date(createdStr).getTime()
        if (!isNaN(t)) return t
      }
      return 0
    }

    try {
      const fromMeWebhooks = app.findRecordsByFilter(
        'webhook_received',
        'fromMe = true',
        'created',
        5000,
        0,
      )

      const aiProcessedList = app.findRecordsByFilter(
        'message_processing',
        "replySent = true || status = 'completed'",
        'created',
        5000,
        0,
      )

      const aiReplies = []
      for (let i = 0; i < aiProcessedList.length; i++) {
        const aiRec = aiProcessedList[i]
        const rawText = aiRec.getString('aiReplyText') || ''
        const text = String(rawText).trim()
        if (!text) continue

        const phone = extractPhoneFromRec(aiRec)
        if (!phone) continue

        const createdStr = aiRec.getString('created')
        const timeMs = getTimestampMs(createdStr, null)

        aiReplies.push({
          id: aiRec.id,
          phone: phone,
          text: text,
          timeMs: timeMs,
        })
      }

      const parsedWebhooks = []
      for (let j = 0; j < fromMeWebhooks.length; j++) {
        const r = fromMeWebhooks[j]
        const phone = extractPhoneFromRec(r)
        const text = extractTextFromRec(r)
        const type = String(r.getString('type') || '')
        const createdStr = r.getString('created')
        const momentVal = r.get('moment')
        const timeMs = getTimestampMs(createdStr, momentVal)

        parsedWebhooks.push({
          record: r,
          id: r.id,
          phone: phone,
          text: text,
          type: type,
          timeMs: timeMs,
        })
      }

      const toDeleteIds = []

      for (let k = 0; k < parsedWebhooks.length; k++) {
        const item = parsedWebhooks[k]
        if (item.type !== 'ReceivedCallback') continue
        if (!item.phone || !item.text) continue

        let isDuplicate = false

        // (a) Outro webhook_received com mesmo telefone e mesmo texto
        for (let m = 0; m < parsedWebhooks.length; m++) {
          if (m === k) continue
          const other = parsedWebhooks[m]
          if (other.phone !== item.phone) continue
          if (other.text !== item.text) continue

          if (other.type === 'AgentSentMessage') {
            const diff = item.timeMs - other.timeMs
            if (diff >= -5000 && diff <= 5 * 60 * 1000) {
              isDuplicate = true
              break
            }
          } else if (other.timeMs < item.timeMs && item.timeMs - other.timeMs <= 5 * 60 * 1000) {
            isDuplicate = true
            break
          }
        }

        // (b) Resposta da IA em message_processing
        if (!isDuplicate) {
          for (let n = 0; n < aiReplies.length; n++) {
            const ai = aiReplies[n]
            if (ai.phone !== item.phone) continue

            const textMatch =
              item.text === ai.text ||
              (item.text.length > 30 &&
                ai.text.length > 30 &&
                item.text.slice(0, 40) === ai.text.slice(0, 40))

            if (textMatch) {
              const diff = item.timeMs - ai.timeMs
              if (diff >= -10000 && diff <= 10 * 60 * 1000) {
                isDuplicate = true
                break
              }
            }
          }
        }

        if (isDuplicate) {
          toDeleteIds.push(item.id)
        }
      }

      let deletedCount = 0
      for (let d = 0; d < toDeleteIds.length; d++) {
        const idToDelete = toDeleteIds[d]
        try {
          const rec = app.findRecordById('webhook_received', idToDelete)
          if (rec) {
            app.delete(rec)
            deletedCount++
          }
        } catch (_) {}
      }

      console.log('[MIGRATION-0037] Total de ecos duplicados deletados:', deletedCount)
    } catch (err) {
      console.log('[MIGRATION-0037-ERROR]', err.message || String(err))
    }
  },
  (app) => {
    // Reversão no-op
  },
)
