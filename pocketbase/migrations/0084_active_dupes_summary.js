migrate(
  (app) => {
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

    // Apenas fornecedores (customer_type = Fornecedor ou Ambos) e clientes
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
        supplierGroups[p].push({
          id: c.id,
          name: c.getString('name'),
          type: c.getString('customer_type'),
          phone: c.getString('phone'),
        })
      } else {
        if (!customerGroups[p]) customerGroups[p] = []
        customerGroups[p].push({
          id: c.id,
          name: c.getString('name'),
          type: c.getString('customer_type'),
          phone: c.getString('phone'),
        })
      }
    }

    const supplierDupes = []
    for (const k in supplierGroups) {
      if (supplierGroups[k].length > 1) supplierDupes.push({ phone: k, items: supplierGroups[k] })
    }

    const customerDupes = []
    for (const k in customerGroups) {
      if (customerGroups[k].length > 1) customerDupes.push({ phone: k, items: customerGroups[k] })
    }

    const setRec = app.findRecordsByFilter('settings', '', '-created', 1, 0)[0]
    setRec.set(
      'ai_excluded_skus',
      JSON.stringify({ suppliers: supplierDupes, customers: customerDupes }),
    )
    app.save(setRec)
  },
  (app) => {},
)
