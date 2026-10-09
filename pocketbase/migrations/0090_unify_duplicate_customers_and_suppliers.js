migrate(
  (app) => {
    // 1. Remove _temp_audit caso exista
    try {
      const tempCol = app.findCollectionByNameOrId('_temp_audit')
      if (tempCol) {
        app.delete(tempCol)
      }
    } catch (_) {}

    // 2. Funções auxiliares de normalização de telefone
    function cleanPhoneDigits(raw) {
      if (!raw) return ''
      const s = String(raw).trim()
      if (s.toLowerCase().indexOf('@lid') !== -1) return ''
      const digits = s.replace(/\D/g, '')
      if (digits.length >= 14 || digits.length < 8) return ''
      if ((digits.length === 12 || digits.length === 13) && digits.indexOf('55') === 0) {
        return digits.slice(2)
      }
      return digits
    }

    function getCanonicalCorePhone(raw) {
      const digits = cleanPhoneDigits(raw)
      if (!digits) return ''
      // DDD + 9 dígitos -> normalizar para DDD + 8 dígitos (sem o nono dígito)
      if (digits.length === 11 && digits[2] === '9') {
        return digits.slice(0, 2) + digits.slice(3)
      }
      return digits
    }

    // 3. Buscar todos os customers não excluídos
    const allCustomers = app.findRecordsByFilter(
      'customers',
      'deleted = false',
      'created',
      10000,
      0,
    )

    // Agrupar por tipo (Fornecedor/Ambos vs Cliente) e telefone canônico
    const groups = {}

    for (let i = 0; i < allCustomers.length; i++) {
      const c = allCustomers[i]
      const p = getCanonicalCorePhone(c.getString('phone'))
      if (!p) continue

      const cType = (c.getString('customer_type') || '').toLowerCase()
      const isSupplierGroup = cType === 'fornecedor' || cType === 'ambos'
      const groupType = isSupplierGroup ? 'fornecedor' : 'cliente'
      const key = groupType + ':' + p

      if (!groups[key]) {
        groups[key] = { groupType, phone: p, records: [] }
      }
      groups[key].records.push(c)
    }

    // Função para pontuar completude do registro
    function scoreRecord(r) {
      let score = 0
      // Nome mais completo (ignora nomes que são apenas números de telefone)
      const name = r.getString('name').trim()
      const digitsOnly = name.replace(/\D/g, '')
      if (name && digitsOnly !== name) score += 20 + Math.min(name.length, 30)

      if (r.getString('contact_name').trim()) score += 15
      if (r.getString('email').trim()) score += 15
      if (r.getString('company').trim()) score += 15
      if (r.getString('notes').trim()) score += 10
      if (r.getString('cpf').trim()) score += 20
      if (r.getString('cnpj').trim()) score += 20
      if (r.getString('customer_type').trim()) score += 10

      // Famílias vinculadas
      const fams = r.getStringSlice('item_families') || []
      score += fams.length * 10

      return score
    }

    const unificationLog = []

    // Executar unificação em transação
    app.runInTransaction((txApp) => {
      for (const k in groups) {
        const grp = groups[k]
        if (grp.records.length <= 1) continue

        // Ordenar por score decrescente (o de maior pontuação é o principal)
        grp.records.sort((a, b) => {
          const scoreA = scoreRecord(a)
          const scoreB = scoreRecord(b)
          if (scoreB !== scoreA) return scoreB - scoreA
          // Desempate: criado antes
          return a.getString('created').localeCompare(b.getString('created'))
        })

        const primary = grp.records[0]
        const duplicates = grp.records.slice(1)

        for (let d = 0; d < duplicates.length; d++) {
          const dupe = duplicates[d]
          let transferredCount = 0

          // 1. quotes: transferir campo customer
          const quotes = txApp.findRecordsByFilter(
            'quotes',
            'customer = "' + dupe.id + '"',
            '',
            1000,
            0,
          )
          for (let q = 0; q < quotes.length; q++) {
            quotes[q].set('customer', primary.id)
            txApp.save(quotes[q])
            transferredCount++
          }

          // 2. purchase_requests: transferir customer
          const prCusts = txApp.findRecordsByFilter(
            'purchase_requests',
            'customer = "' + dupe.id + '"',
            '',
            1000,
            0,
          )
          for (let pc = 0; pc < prCusts.length; pc++) {
            prCusts[pc].set('customer', primary.id)
            txApp.save(prCusts[pc])
            transferredCount++
          }

          // 3. purchase_requests: transferir supplier
          const prSups = txApp.findRecordsByFilter(
            'purchase_requests',
            'supplier = "' + dupe.id + '"',
            '',
            1000,
            0,
          )
          for (let ps = 0; ps < prSups.length; ps++) {
            prSups[ps].set('supplier', primary.id)
            txApp.save(prSups[ps])
            transferredCount++
          }

          // 4. Mesclar dados faltantes no primary
          let primaryUpdated = false
          if (!primary.getString('contact_name').trim() && dupe.getString('contact_name').trim()) {
            primary.set('contact_name', dupe.getString('contact_name'))
            primaryUpdated = true
          }
          if (!primary.getString('email').trim() && dupe.getString('email').trim()) {
            primary.set('email', dupe.getString('email'))
            primaryUpdated = true
          }
          if (!primary.getString('company').trim() && dupe.getString('company').trim()) {
            primary.set('company', dupe.getString('company'))
            primaryUpdated = true
          }
          if (!primary.getString('cpf').trim() && dupe.getString('cpf').trim()) {
            primary.set('cpf', dupe.getString('cpf'))
            primaryUpdated = true
          }
          if (!primary.getString('cnpj').trim() && dupe.getString('cnpj').trim()) {
            primary.set('cnpj', dupe.getString('cnpj'))
            primaryUpdated = true
          }
          if (
            !primary.getString('customer_type').trim() &&
            dupe.getString('customer_type').trim()
          ) {
            primary.set('customer_type', dupe.getString('customer_type'))
            primaryUpdated = true
          }

          // Se o nome do primary for só telefone mas o dupe tiver nome legível, atualizar nome
          const primaryName = primary.getString('name').trim()
          const dupeName = dupe.getString('name').trim()
          if (
            primaryName.replace(/\D/g, '') === primaryName &&
            dupeName.replace(/\D/g, '') !== dupeName
          ) {
            primary.set('name', dupeName)
            primaryUpdated = true
          }

          // Mesclar notas se houver novas notas
          const pNotes = primary.getString('notes').trim()
          const dNotes = dupe.getString('notes').trim()
          if (dNotes && pNotes.indexOf(dNotes) === -1) {
            primary.set('notes', pNotes ? pNotes + '\n' + dNotes : dNotes)
            primaryUpdated = true
          }

          // Mesclar item_families
          const pFams = primary.getStringSlice('item_families') || []
          const dFams = dupe.getStringSlice('item_families') || []
          const mergedFams = Array.from(new Set([...pFams, ...dFams]))
          if (mergedFams.length > pFams.length) {
            primary.set('item_families', mergedFams)
            primaryUpdated = true
          }

          if (primaryUpdated) {
            txApp.save(primary)
          }

          // 5. Remover o registro duplicado (após todas as transferências com sucesso)
          txApp.delete(dupe)

          unificationLog.push({
            groupType: grp.groupType,
            phone: grp.phone,
            primaryId: primary.id,
            primaryName: primary.getString('name'),
            duplicateId: dupe.id,
            duplicateName: dupe.getString('name'),
            transferredLinks: transferredCount,
            removed: true,
          })
        }
      }
    })

    console.log('[UNIFICATION-LOG] Total unifications:', unificationLog.length)
    for (let l = 0; l < unificationLog.length; l++) {
      console.log('[UNIFICATION-ENTRY]', JSON.stringify(unificationLog[l]))
    }
  },
  (app) => {},
)
