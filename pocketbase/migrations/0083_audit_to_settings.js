migrate(
  (app) => {
    const customers = app.findRecordsByFilter('customers', '', 'created', 10000, 0)

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
        type: cType,
        del: isDeleted ? 1 : 0,
        phone: c.getString('phone'),
      })
    }

    const dupes = []
    for (const phoneKey in groups) {
      if (groups[phoneKey].length > 1) {
        dupes.push({ phoneKey, items: groups[phoneKey] })
      }
    }

    const settingsRecords = app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (settingsRecords.length > 0) {
      const setRec = settingsRecords[0]
      setRec.set('ai_excluded_skus', JSON.stringify(dupes).slice(0, 4900))
      app.save(setRec)
    }
  },
  (app) => {},
)
