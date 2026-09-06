migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('lead_source')) {
      customers.fields.add(
        new SelectField({
          name: 'lead_source',
          values: ['whatsapp', 'instagram', 'google', 'other'],
          maxSelect: 1,
        }),
      )
      app.save(customers)
    }

    // Preencher retroativamente os clientes existentes:
    // clientes cuja nota contém "Lead originado pelo WhatsApp" -> 'whatsapp'
    // demais ou vazio -> 'other'
    try {
      app
        .db()
        .newQuery(
          "UPDATE customers SET lead_source = 'whatsapp' WHERE notes LIKE '%Lead originado pelo WhatsApp%'",
        )
        .execute()

      app
        .db()
        .newQuery(
          "UPDATE customers SET lead_source = 'other' WHERE lead_source IS NULL OR lead_source = ''",
        )
        .execute()
    } catch (err) {
      console.log('[MIGRATION-0020-UPDATE-ERR]', err.message || String(err))
    }
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const field = customers.fields.getByName('lead_source')
      if (field) {
        customers.fields.remove(field)
        app.save(customers)
      }
    } catch (_) {}
  },
)
