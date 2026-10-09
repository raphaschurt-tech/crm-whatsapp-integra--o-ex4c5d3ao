migrate(
  (app) => {
    // 1. Adicionar campos first_message_at e last_interaction_at em customers se não existirem
    const customersCol = app.findCollectionByNameOrId('customers')

    if (!customersCol.fields.getByName('first_message_at')) {
      customersCol.fields.add(new DateField({ name: 'first_message_at' }))
    }
    if (!customersCol.fields.getByName('last_interaction_at')) {
      customersCol.fields.add(new DateField({ name: 'last_interaction_at' }))
    }
    app.save(customersCol)

    // 2. Auxiliares de normalização de telefone (Goja / SQLite compatível)
    function cleanPhoneDigits(raw) {
      if (!raw) return ''
      let s = ''
      if (typeof raw === 'object') {
        s = String(raw.phone || raw.number || raw.id || raw.chatId || '')
      } else {
        s = String(raw).trim()
      }
      if (s.toLowerCase().indexOf('@lid') !== -1 || s.toLowerCase().indexOf('@g.us') !== -1) {
        return ''
      }
      const digits = s.replace(/\D/g, '')
      if (digits.length >= 14 || digits.length < 8) return ''
      return digits
    }

    function getNormalizedPhoneKey(raw) {
      const d = cleanPhoneDigits(raw)
      if (!d) return ''
      if (d.length === 10 || d.length === 11) {
        return '55' + d
      }
      return d
    }

    function getPhoneVariants(raw) {
      const d = cleanPhoneDigits(raw)
      if (!d) return []
      const set = {}
      set[d] = true
      if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        set[d.slice(2)] = true
      } else if (d.length === 10 || d.length === 11) {
        set['55' + d] = true
      }
      return Object.keys(set)
    }

    // 3. Varrer histórico em lotes para calcular first_message_at e last_interaction_at por telefone
    // map: phoneKey -> { firstTime: number, lastTime: number, firstIso: string, lastIso: string }
    const phoneActivityMap = {}

    function recordActivity(phoneRaw, timestampMs, isoString) {
      if (!phoneRaw || !timestampMs || isNaN(timestampMs)) return
      const key = getNormalizedPhoneKey(phoneRaw)
      if (!key) return

      if (!phoneActivityMap[key]) {
        phoneActivityMap[key] = {
          firstTime: timestampMs,
          lastTime: timestampMs,
          firstIso: isoString,
          lastIso: isoString,
        }
      } else {
        const item = phoneActivityMap[key]
        if (timestampMs < item.firstTime) {
          item.firstTime = timestampMs
          item.firstIso = isoString
        }
        if (timestampMs > item.lastTime) {
          item.lastTime = timestampMs
          item.lastIso = isoString
        }
      }
    }

    // 3.1 Ler webhook_received em lotes
    let page = 1
    const batchSize = 1000
    while (true) {
      const records = app.findRecordsByFilter(
        'webhook_received',
        '',
        'created',
        batchSize,
        (page - 1) * batchSize,
      )
      if (!records || records.length === 0) break

      for (let i = 0; i < records.length; i++) {
        const r = records[i]
        const phone = r.get('phone') || r.get('chat') || r.get('sender')
        const createdStr = r.getString('created')
        const moment = r.getInt('moment')
        let ts = 0
        let iso = createdStr
        if (moment && moment > 0) {
          ts = moment * 1000
          try {
            iso = new Date(ts).toISOString()
          } catch (_) {
            iso = createdStr
          }
        } else if (createdStr) {
          ts = new Date(createdStr).getTime()
        }
        if (ts > 0) {
          recordActivity(phone, ts, iso)
        }
      }

      if (records.length < batchSize) break
      page++
    }

    // 3.2 Ler message_processing em lotes
    page = 1
    while (true) {
      const procRecords = app.findRecordsByFilter(
        'message_processing',
        '',
        'created',
        batchSize,
        (page - 1) * batchSize,
      )
      if (!procRecords || procRecords.length === 0) break

      for (let i = 0; i < procRecords.length; i++) {
        const pr = procRecords[i]
        const phone = pr.getString('phone')
        const createdStr = pr.getString('created')
        const updatedStr = pr.getString('updated')
        if (createdStr) {
          const ts = new Date(createdStr).getTime()
          recordActivity(phone, ts, createdStr)
        }
        if (updatedStr) {
          const ts = new Date(updatedStr).getTime()
          recordActivity(phone, ts, updatedStr)
        }
      }

      if (procRecords.length < batchSize) break
      page++
    }

    console.log(
      '[MIGRATE-0091] Calculated activity for phone count:',
      Object.keys(phoneActivityMap).length,
    )

    // 4. Atualizar os customers existentes
    const allCustomers = app.findRecordsByFilter('customers', '', 'created', 10000, 0)
    let updatedCustomersCount = 0

    app.runInTransaction((txApp) => {
      for (let i = 0; i < allCustomers.length; i++) {
        const cust = allCustomers[i]
        const rawPhone = cust.getString('phone')
        const variants = getPhoneVariants(rawPhone)

        let bestActivity = null
        for (let v = 0; v < variants.length; v++) {
          const vKey = getNormalizedPhoneKey(variants[v])
          if (phoneActivityMap[vKey]) {
            const act = phoneActivityMap[vKey]
            if (!bestActivity) {
              bestActivity = { ...act }
            } else {
              if (act.firstTime < bestActivity.firstTime) {
                bestActivity.firstTime = act.firstTime
                bestActivity.firstIso = act.firstIso
              }
              if (act.lastTime > bestActivity.lastTime) {
                bestActivity.lastTime = act.lastTime
                bestActivity.lastIso = act.lastIso
              }
            }
          }
        }

        if (bestActivity) {
          cust.set('first_message_at', bestActivity.firstIso)
          cust.set('last_interaction_at', bestActivity.lastIso)
          txApp.save(cust)
          updatedCustomersCount++
        }
      }
    })

    console.log(
      '[MIGRATE-0091] Successfully migrated customers with message timestamps:',
      updatedCustomersCount,
    )
  },
  (app) => {
    // Reverter campos
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (customersCol.fields.getByName('first_message_at')) {
        customersCol.fields.removeByName('first_message_at')
      }
      if (customersCol.fields.getByName('last_interaction_at')) {
        customersCol.fields.removeByName('last_interaction_at')
      }
      app.save(customersCol)
    } catch (_) {}
  },
)
