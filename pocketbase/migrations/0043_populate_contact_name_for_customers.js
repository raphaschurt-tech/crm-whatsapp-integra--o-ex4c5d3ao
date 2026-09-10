migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('contact_name')) {
      customers.fields.add(
        new TextField({
          name: 'contact_name',
          required: false,
        }),
      )
      app.save(customers)
    }

    // Preencher contact_name caso Edilson ou clientes existentes já tenham nome de pessoa
    try {
      app
        .db()
        .newQuery(
          "UPDATE customers SET contact_name = name WHERE (contact_name IS NULL OR contact_name = '') AND name IS NOT NULL AND name != phone AND length(name) > 0",
        )
        .execute()
    } catch (err) {
      console.log('[MIGRATION-0042-CONTACT-NAME-ERR]', err.message || String(err))
    }
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const field = customers.fields.getByName('contact_name')
      if (field) {
        customers.fields.remove(field)
        app.save(customers)
      }
    } catch (_) {}
  },
)
