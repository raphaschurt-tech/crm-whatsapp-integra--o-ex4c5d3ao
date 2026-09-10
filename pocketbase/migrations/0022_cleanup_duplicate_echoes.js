migrate(
  (app) => {
    // Migração 0022: Limpeza de ecos duplicados no webhook_received
    // Mantém exatamente UMA cópia de cada mensagem e remove duplicatas causadas por:
    // 1. Ecos da Z-API de AgentSentMessage (mesmo telefone, fromMe=true, mesmo texto em intervalo próximo)
    //    mantendo o registro original (ex: AgentSentMessage ou o primeiro recebido)
    // 2. Ecos da Z-API de respostas enviadas pela IA gravadas em message_processing.aiReplyText
    //    onde a Z-API enviou um ReceivedCallback com fromMe=true duplicando a resposta da IA.

    try {
      // 1. Buscar todos os registros webhook_received com fromMe = true
      const fromMeRecords = app.findRecordsByFilter(
        'webhook_received',
        'fromMe = true',
        'created',
        1000,
        0,
      )

      console.log('[MIGRATION-0022] Total fromMe records:', fromMeRecords.length)

      // 2. Buscar todas as mensagens de message_processing com replySent = true ou status = 'completed'
      const aiProcessedRecords = app.findRecordsByFilter(
        'message_processing',
        "replySent = true || status = 'completed'",
        'created',
        1000,
        0,
      )

      console.log('[MIGRATION-0022] Total AI processed records:', aiProcessedRecords.length)

      // Mapear respostas da IA por telefone normalizado
      // aiRepliesMap: phone -> array de { text, time }
      const aiRepliesMap = {}
      for (let i = 0; i < aiProcessedRecords.length; i++) {
        const aiRec = aiProcessedRecords[i]
        const replyText = String(aiRec.getString('aiReplyText') || '').trim()
        if (!replyText) continue

        const pStr = String(aiRec.getString('phone') || '').replace(/\D/g, '')
        const normPhone = pStr.length === 10 || pStr.length === 11 ? '55' + pStr : pStr
        if (!normPhone) continue

        const createdTime = new Date(aiRec.getString('created')).getTime()

        if (!aiRepliesMap[normPhone]) {
          aiRepliesMap[normPhone] = []
        }
        aiRepliesMap[normPhone].push({
          text: replyText,
          time: createdTime,
          id: aiRec.id,
        })
      }

      // Função auxiliar interna para extrair telefone normalizado de um record
      const getNormPhone = (rec) => {
        let raw = ''
        const pVal = rec.get('phone')
        if (typeof pVal === 'string') raw = pVal
        else if (pVal && typeof pVal === 'object') {
          raw = String(pVal.phone || pVal.number || '')
        }
        if (!raw) {
          const cVal = rec.get('chat')
          if (typeof cVal === 'string') raw = cVal
          else if (cVal && typeof cVal === 'object') {
            raw = String(cVal.phone || cVal.number || '')
          }
        }
        const digits = raw.replace(/\D/g, '')
        if (!digits) return ''
        return digits.length === 10 || digits.length === 11 ? '55' + digits : digits
      }

      // Função auxiliar interna para extrair texto da mensagem
      const getMessageText = (rec) => {
        const tVal = rec.get('text')
        if (typeof tVal === 'string') return tVal.trim()
        if (tVal && typeof tVal === 'object') {
          return String(tVal.message || tVal.text || tVal.conversation || '').trim()
        }
        return ''
      }

      // Rastrear IDs a deletar
      const idsToDelete = {}

      // A) Detectar duplicatas de eco da IA em webhook_received
      // Se um webhook_received (fromMe=true) tem o mesmo telefone e mesmo texto de uma resposta da IA
      // em janela próxima (+- 30 minutos) e tipo 'ReceivedCallback', ele é um eco desnecessário
      // pois message_processing já renderiza a resposta da IA no chat com badge "Assistente IA".
      for (let j = 0; j < fromMeRecords.length; j++) {
        const rec = fromMeRecords[j]
        const phone = getNormPhone(rec)
        const text = getMessageText(rec)
        const recType = String(rec.getString('type') || '')

        if (!phone || !text) continue

        // Se o registro não for AgentSentMessage (ex: ReceivedCallback)
        // e coincidir com resposta da IA para aquele telefone
        if (recType !== 'AgentSentMessage' && aiRepliesMap[phone]) {
          const recTime = rec.get('moment')
            ? Number(rec.get('moment')) * 1000
            : new Date(rec.getString('created')).getTime()

          const aiList = aiRepliesMap[phone]
          for (let k = 0; k < aiList.length; k++) {
            const aiItem = aiList[k]
            // Comparação de texto exato ou com diferença mínima
            if (aiItem.text === text || text.startsWith(aiItem.text.slice(0, 50))) {
              const diff = Math.abs(recTime - aiItem.time)
              // Janela de até 30 minutos
              if (diff < 30 * 60 * 1000) {
                idsToDelete[rec.id] = true
                console.log(
                  '[MIGRATION-0022] Marcado para deleção (Eco de IA duplicado):',
                  rec.id,
                  'texto:',
                  text.slice(0, 30),
                )
                break
              }
            }
          }
        }
      }

      // B) Detectar duplicatas entre múltiplos webhook_received (ex: AgentSentMessage vs ReceivedCallback)
      // Agrupar por chave: phone + ':::' + text
      const groups = {}
      for (let m = 0; m < fromMeRecords.length; m++) {
        const r = fromMeRecords[m]
        if (idsToDelete[r.id]) continue // já marcado

        const p = getNormPhone(r)
        const t = getMessageText(r)
        if (!p || !t) continue

        const key = p + ':::' + t
        if (!groups[key]) {
          groups[key] = []
        }
        groups[key].push(r)
      }

      // Para cada grupo com mais de 1 registro:
      // se foram criados em janela curta (ex: menos de 10 minutos entre eles), é eco duplicado
      for (const groupKey in groups) {
        const list = groups[groupKey]
        if (list.length <= 1) continue

        // Ordenar: preferir manter AgentSentMessage primeiro, ou o mais antigo
        list.sort((a, b) => {
          const aType = String(a.getString('type') || '')
          const bType = String(b.getString('type') || '')
          if (aType === 'AgentSentMessage' && bType !== 'AgentSentMessage') return -1
          if (bType === 'AgentSentMessage' && aType !== 'AgentSentMessage') return 1

          const aTime = a.get('moment')
            ? Number(a.get('moment')) * 1000
            : new Date(a.getString('created')).getTime()
          const bTime = b.get('moment')
            ? Number(b.get('moment')) * 1000
            : new Date(b.getString('created')).getTime()
          return aTime - bTime
        })

        // O primeiro da lista ordenada é mantido como legítimo
        for (let idx = 1; idx < list.length; idx++) {
          const dup = list[idx]
          idsToDelete[dup.id] = true
          console.log(
            '[MIGRATION-0022] Marcado para deleção (Eco de envio do atendente duplicado):',
            dup.id,
            'tipo:',
            dup.getString('type'),
          )
        }
      }

      // C) Efetuar a remoção via app.delete de forma limpa e segura
      let deletedCount = 0
      for (const id in idsToDelete) {
        try {
          const recordToDelete = app.findRecordById('webhook_received', id)
          if (recordToDelete) {
            app.delete(recordToDelete)
            deletedCount++
          }
        } catch (delErr) {
          console.log('[MIGRATION-0022-DEL-ERR]', id, delErr.message || String(delErr))
        }
      }

      console.log('[MIGRATION-0022] Concluída com sucesso! Total de ecos removidos:', deletedCount)
    } catch (err) {
      console.log('[MIGRATION-0022-ERROR]', err.message || String(err))
    }
  },
  (app) => {
    // Reversão no-op
  },
)
