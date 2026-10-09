migrate(
  (app) => {
    const customers = app.findRecordsByFilter('customers', '', 'created', 10000, 0)
    console.log('[MIGRATION-0082-AUDIT] Total records in customers:', customers.length)

    // Normalização de telefone
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

    // Agrupar clientes e fornecedores
    const groups = {}
    for (let i = 0; i < customers.length; i++) {
      const c = customers[i]
      const p = cleanPhone(c.getString('phone'))
      if (!p) continue
      const isDeleted = c.getBool('deleted')
      const cType = (c.getString('customer_type') || '').toLowerCase()
      const name = c.getString('name')
      const id = c.id

      if (!groups[p]) groups[p] = []
      groups[p].push({
        id,
        name,
        customer_type: cType,
        deleted: isDeleted,
        phone: c.getString('phone'),
        cpf: c.getString('cpf'),
        cnpj: c.getString('cnpj'),
      })
    }

    const dupes = []
    for (const phoneKey in groups) {
      if (groups[phoneKey].length > 1) {
        dupes.push({ phoneKey, items: groups[phoneKey] })
      }
    }

    console.log('[MIGRATION-0082-AUDIT] Dupe groups count:', dupes.length)
    for (let j = 0; j < dupes.length; j++) {
      console.log('[MIGRATION-0082-AUDIT-DUPE]', JSON.stringify(dupes[j]))
    }
  },
  (app) => {},
)
