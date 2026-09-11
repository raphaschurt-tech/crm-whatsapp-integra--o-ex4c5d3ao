migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    // 1. Adicionar campos deleted (bool) e deleted_at (date)
    if (!customers.fields.getByName('deleted')) {
      customers.fields.add(
        new BoolField({
          name: 'deleted',
          required: false,
        }),
      )
    }

    if (!customers.fields.getByName('deleted_at')) {
      customers.fields.add(
        new DateField({
          name: 'deleted_at',
          required: false,
        }),
      )
    }

    app.save(customers)

    // Adicionar índice para performance de filtro por deleted
    try {
      customers.addIndex('idx_customers_deleted', false, 'deleted', '')
      app.save(customers)
    } catch (_) {}

    // 2. Limpar pipeline_status dos clientes já importados com status 'novo_lead' e sem nenhuma conversa ou orçamento
    // Buscar todos os clientes com pipeline_status = 'novo_lead'
    let leadsToEvaluate = []
    try {
      leadsToEvaluate = app.findRecordsByFilter(
        'customers',
        "pipeline_status = 'novo_lead'",
        '-created',
        10000,
        0,
      )
    } catch (err) {
      console.log('[MIGRATION-0045-FETCH-LEADS-ERR]', err.message || String(err))
    }

    // Carregar todas as quotes para verificar quais clientes têm orçamento
    const customerIdsWithQuotes = {}
    try {
      const allQuotes = app.findRecordsByFilter('quotes', '', '-created', 10000, 0)
      for (let i = 0; i < allQuotes.length; i++) {
        const cId = allQuotes[i].getString('customer')
        if (cId) customerIdsWithQuotes[cId] = true
      }
    } catch (err) {
      console.log('[MIGRATION-0045-FETCH-QUOTES-ERR]', err.message || String(err))
    }

    // Carregar todos os telefones que possuem mensagens em webhook_received
    const phonesWithWebhook = {}
    try {
      const allWebhooks = app.findRecordsByFilter('webhook_received', '', '-created', 10000, 0)
      for (let i = 0; i < allWebhooks.length; i++) {
        const item = allWebhooks[i]
        let p = ''
        const rawPStr = item.getString('phone') || item.getString('chat') || ''
        if (rawPStr) {
          try {
            const parsed = JSON.parse(rawPStr)
            if (parsed && typeof parsed === 'object') {
              p = String(parsed.phone || parsed.number || parsed.id || '')
            } else if (typeof parsed === 'string') {
              p = parsed
            }
          } catch (_) {
            p = rawPStr
          }
        }
        if (!p) {
          const pVal = item.get('phone')
          if (typeof pVal === 'string') p = pVal
          else if (pVal && typeof pVal === 'object') p = String(pVal.phone || pVal.number || '')
        }
        const digits = p.replace(/\D/g, '')
        if (digits) {
          phonesWithWebhook[digits] = true
          if (digits.startsWith('55') && digits.length >= 12) {
            phonesWithWebhook[digits.slice(2)] = true
          } else {
            phonesWithWebhook['55' + digits] = true
          }
        }
      }
    } catch (err) {
      console.log('[MIGRATION-0045-FETCH-WEBHOOKS-ERR]', err.message || String(err))
    }

    // Carregar telefones que possuem registro em message_processing
    try {
      const allProcessing = app.findRecordsByFilter('message_processing', '', '-created', 10000, 0)
      for (let i = 0; i < allProcessing.length; i++) {
        const procPhone = allProcessing[i].getString('phone').replace(/\D/g, '')
        if (procPhone) {
          phonesWithWebhook[procPhone] = true
          if (procPhone.startsWith('55') && procPhone.length >= 12) {
            phonesWithWebhook[procPhone.slice(2)] = true
          } else {
            phonesWithWebhook['55' + procPhone] = true
          }
        }
      }
    } catch (err) {
      console.log('[MIGRATION-0045-FETCH-PROCESSING-ERR]', err.message || String(err))
    }

    let cleanedCount = 0
    let keptCount = 0

    for (let c = 0; c < leadsToEvaluate.length; c++) {
      const custRec = leadsToEvaluate[c]
      const custId = custRec.id
      const custPhoneDigits = custRec.getString('phone').replace(/\D/g, '')

      const hasQuote = Boolean(customerIdsWithQuotes[custId])
      const hasChat = Boolean(
        phonesWithWebhook[custPhoneDigits] ||
        (custPhoneDigits.startsWith('55') && phonesWithWebhook[custPhoneDigits.slice(2)]) ||
        phonesWithWebhook['55' + custPhoneDigits],
      )

      if (!hasQuote && !hasChat) {
        // Limpar pipeline_status
        custRec.set('pipeline_status', '')
        app.save(custRec)
        cleanedCount++
      } else {
        keptCount++
      }
    }

    console.log(
      '[MIGRATION-0045-CLEANUP-FINISHED]',
      JSON.stringify({
        cleaned: cleanedCount,
        kept: keptCount,
        totalEvaluated: leadsToEvaluate.length,
      }),
    )
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      try {
        customers.removeIndex('idx_customers_deleted')
      } catch (_) {}
      const delField = customers.fields.getByName('deleted')
      if (delField) customers.fields.remove(delField)
      const delAtField = customers.fields.getByName('deleted_at')
      if (delAtField) customers.fields.remove(delAtField)
      app.save(customers)
    } catch (_) {}
  },
)
