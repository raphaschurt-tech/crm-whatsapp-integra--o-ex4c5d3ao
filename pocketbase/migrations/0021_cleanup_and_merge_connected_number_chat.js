migrate(
  (app) => {
    // Migração 0021: Mesclar mensagens da conversa-fantasma do número conectado (5511947861439)
    // para os clientes legítimos com base na proximidade cronológica de mensagens recebidas,
    // e remover a conversa/cliente fantasma com o número conectado.

    try {
      // 1. Obter número conectado de settings
      let connectedPhone = '5511947861439'
      try {
        const setRecs = app.findRecordsByFilter(
          'settings',
          "whatsapp_number != ''",
          '-created',
          1,
          0,
        )
        if (setRecs && setRecs.length > 0) {
          const wp = String(setRecs[0].get('whatsapp_number') || '').replace(/\D/g, '')
          if (wp) {
            connectedPhone = wp.length === 10 || wp.length === 11 ? '55' + wp : wp
          }
        }
      } catch (_) {}

      // 2. Buscar todas as mensagens de webhook_received associadas ao número conectado
      const ghostMessages = app.findRecordsByFilter(
        'webhook_received',
        'phone ~ {:cp} || chat ~ {:cp}',
        'created',
        500,
        0,
        { cp: '947861439' },
      )

      console.log(
        '[MIGRATION-0021] Mensagens encontradas para o número conectado:',
        ghostMessages.length,
      )

      // 3. Buscar todas as mensagens legítimas de clientes (fromMe = false) que NÃO são o número conectado
      const clientIncoming = app.findRecordsByFilter(
        'webhook_received',
        'fromMe = false && !(phone ~ {:cp})',
        'created',
        500,
        0,
        { cp: '947861439' },
      )

      console.log(
        '[MIGRATION-0021] Mensagens legítimas de clientes encontradas:',
        clientIncoming.length,
      )

      // Mapear momentos e telefones de clientes legítimos
      const clientTimestamps = []
      for (let i = 0; i < clientIncoming.length; i++) {
        const cRec = clientIncoming[i]
        const cDate = cRec.get('moment')
          ? Number(cRec.get('moment')) * 1000
          : new Date(cRec.getString('created')).getTime()

        let cPhone = ''
        const pVal = cRec.get('phone')
        if (typeof pVal === 'string') cPhone = pVal
        else if (pVal && typeof pVal === 'object' && pVal.phone) cPhone = String(pVal.phone)
        const clean = cPhone.replace(/\D/g, '')
        if (clean && clean.length >= 10 && clean.length <= 13) {
          const norm = clean.length === 10 || clean.length === 11 ? '55' + clean : clean
          clientTimestamps.push({
            phone: norm,
            time: cDate,
            id: cRec.id,
          })
        }
      }

      // Ordenar cronologicamente
      clientTimestamps.sort((a, b) => a.time - b.time)

      // Para cada mensagem fantasma:
      // se tiver texto de resposta, achar o cliente que mandou mensagem imediatamente antes
      // (dentro de uma janela razoável, ex.: até 4 horas antes)
      for (let j = 0; j < ghostMessages.length; j++) {
        const gRec = ghostMessages[j]
        const isFromMe = Boolean(gRec.get('fromMe'))
        let gText = ''
        const tVal = gRec.get('text')
        if (typeof tVal === 'string') gText = tVal
        else if (tVal && typeof tVal === 'object') gText = String(tVal.message || tVal.text || '')

        // Se for mensagem vazia ou sem texto útil e fromMe=false no número conectado (como echoes),
        // pode ser deletada para não poluir
        if (!isFromMe || !gText.trim()) {
          try {
            app.delete(gRec)
            continue
          } catch (_) {}
        }

        const gTime = gRec.get('moment')
          ? Number(gRec.get('moment')) * 1000
          : new Date(gRec.getString('created')).getTime()

        // Encontrar a mensagem de cliente com tempo <= gTime mais próxima
        let matchedClientPhone = ''
        let minDiff = Infinity

        for (let k = 0; k < clientTimestamps.length; k++) {
          const cItem = clientTimestamps[k]
          // A mensagem do cliente deve ter chegado antes ou até no máximo 1 minuto depois da resposta
          const diff = gTime - cItem.time
          if (diff >= -60000 && diff < 4 * 60 * 60 * 1000) {
            // Se tiver múltiplos, queremos o menor diff positivo (a mensagem mais próxima imediatamente antes)
            const absDiff = Math.abs(diff)
            if (absDiff < minDiff) {
              minDiff = absDiff
              matchedClientPhone = cItem.phone
            }
          }
        }

        if (matchedClientPhone) {
          // Reatribuir a mensagem para o telefone do cliente correto!
          gRec.set('phone', { phone: matchedClientPhone })
          gRec.set('chat', { phone: matchedClientPhone })
          gRec.set('sender', { role: 'agent', source: 'mobile_whatsapp_migrated' })
          app.save(gRec)
          console.log(
            '[MIGRATION-0021] Reatribuída mensagem',
            gRec.id,
            'para o cliente:',
            matchedClientPhone,
          )
        } else {
          // Se não foi possível casar com nenhum cliente com segurança, mas é fromMe legítimo,
          // deletamos se estiver sem texto, ou mantemos com phone null
          try {
            app.delete(gRec)
          } catch (_) {}
        }
      }

      // 4. Remover cliente-fantasma da coleção customers que tenha o próprio número conectado
      try {
        app
          .db()
          .newQuery(`
          DELETE FROM customers 
          WHERE phone LIKE '%947861439%' 
             OR name LIKE '%947861439%'
        `)
          .execute()
        console.log('[MIGRATION-0021] Cliente fantasma do número conectado removido de customers.')
      } catch (custDelErr) {
        console.log('[MIGRATION-0021-ERR] Erro ao remover cliente de customers:', custDelErr)
      }
    } catch (migErr) {
      console.log('[MIGRATION-0021-ERROR]', migErr.message || String(migErr))
    }
  },
  (app) => {
    // Reversão no-op
  },
)
