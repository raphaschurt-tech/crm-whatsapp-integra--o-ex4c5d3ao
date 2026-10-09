migrate(
  (app) => {
    // Cria coleção temporária _temp_audit
    const col = new Collection({
      name: '_temp_audit',
      type: 'base',
      listRule: '',
      viewRule: '',
      fields: [
        { name: 'summary', type: 'text', maxSize: 100000 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(col)

    // Coleta dados dos duplicados
    const customers = app.findRecordsByFilter('customers', 'deleted = false', 'created', 10000, 0)
    function cleanPhone(raw) {
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

    const supplierGroups = {}
    const customerGroups = {}

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i]
      const p = cleanPhone(c.getString('phone'))
      if (!p) continue
      const cType = (c.getString('customer_type') || '').toLowerCase()
      const isSupplier = cType === 'fornecedor' || cType === 'ambos'

      if (isSupplier) {
        if (!supplierGroups[p]) supplierGroups[p] = []
        supplierGroups[p].push(c)
      } else {
        if (!customerGroups[p]) customerGroups[p] = []
        customerGroups[p].push(c)
      }
    }

    function checkRefs(custId) {
      let quotesCount = 0
      let prCustCount = 0
      let prSupCount = 0
      try {
        quotesCount = app.findRecordsByFilter(
          'quotes',
          'customer = "' + custId + '"',
          '',
          100,
          0,
        ).length
      } catch (_) {}
      try {
        prCustCount = app.findRecordsByFilter(
          'purchase_requests',
          'customer = "' + custId + '"',
          '',
          100,
          0,
        ).length
      } catch (_) {}
      try {
        prSupCount = app.findRecordsByFilter(
          'purchase_requests',
          'supplier = "' + custId + '"',
          '',
          100,
          0,
        ).length
      } catch (_) {}
      return { quotesCount, prCustCount, prSupCount }
    }

    for (const phone in supplierGroups) {
      if (supplierGroups[phone].length > 1) {
        const items = supplierGroups[phone].map((c) => ({
          id: c.id,
          name: c.getString('name'),
          contact_name: c.getString('contact_name'),
          type: c.getString('customer_type'),
          phone: c.getString('phone'),
          company: c.getString('company'),
          notes: c.getString('notes'),
          families: c.getStringSlice('item_families').length,
          created: c.getString('created'),
          refs: checkRefs(c.id),
        }))
        const rec = new Record(col)
        rec.set('summary', 'SUPPLIER:' + phone + '::' + JSON.stringify(items))
        app.save(rec)
      }
    }

    for (const phone in customerGroups) {
      if (customerGroups[phone].length > 1) {
        const items = customerGroups[phone].map((c) => ({
          id: c.id,
          name: c.getString('name'),
          contact_name: c.getString('contact_name'),
          type: c.getString('customer_type'),
          phone: c.getString('phone'),
          created: c.getString('created'),
          refs: checkRefs(c.id),
        }))
        const rec = new Record(col)
        rec.set('summary', 'CUSTOMER:' + phone + '::' + JSON.stringify(items))
        app.save(rec)
      }
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('_temp_audit')
      app.delete(col)
    } catch (_) {}
  },
)
