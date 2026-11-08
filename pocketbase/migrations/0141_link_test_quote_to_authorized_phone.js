migrate(
  (app) => {
    // Âncora 🟡: BACKUP PRIMEIRO & Dados de Teste
    // Vincula o orçamento ORC-2026-0033 ao cliente real do telefone de teste (5511947518805)
    // O campo do número do orçamento na collection 'quotes' chama-se 'number', não 'quote_number'.
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
            '[MIGRATION-0141-SUCCESS] ORC-2026-0033 vinculado ao customer',
            targetCustomer.id,
          )
        }
      } catch (qErr) {
        console.log('[MIGRATION-0141-QUOTE-LINK-ERR]', String(qErr))
      }
    }
  },
  (app) => {
    // Revert opcional no-op
  },
)
