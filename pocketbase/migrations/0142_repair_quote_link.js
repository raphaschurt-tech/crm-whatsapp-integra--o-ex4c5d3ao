migrate(
  (app) => {
    // Correção da migração 0141 usando o nome de campo correto ('number')
    const authorizedPhone = '5511947518805'

    let targetCustomer = null
    try {
      targetCustomer = app.findFirstRecordByFilter(
        'customers',
        "phone = {:p} || phone = '11947518805' || phone = '(11) 94751-8805'",
        { p: authorizedPhone },
      )
    } catch (_) {}

    if (!targetCustomer) {
      try {
        const allMatches = app.findRecordsByFilter('customers', "phone ~ '947518805'", '', 1, 0)
        if (allMatches && allMatches.length > 0) {
          targetCustomer = allMatches[0]
        }
      } catch (_) {}
    }

    if (targetCustomer) {
      try {
        const quote = app.findFirstRecordByFilter('quotes', "number = 'ORC-2026-0033'")
        if (quote) {
          quote.set('customer', targetCustomer.id)
          quote.set('status', 'enviado')
          app.save(quote)
          console.log(
            '[MIGRATION-0142-SUCCESS] ORC-2026-0033 vinculado com sucesso ao customer ' +
              targetCustomer.id,
          )
        }
      } catch (qErr) {
        console.log('[MIGRATION-0142-QUOTE-LINK-ERR]', String(qErr))
      }
    }
  },
  (app) => {},
)
