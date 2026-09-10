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

    // Inicialização amigável: se o cliente for PJ e tiver nome/empresa, ou caso o nome seja de pessoa
    // Não força sobrescrita indiscriminada, mas para o caso específico de teste/exemplo onde Edilson está com company 'Edilson DPA' ou similar:
    try {
      app
        .db()
        .newQuery(
          'UPDATE customers SET contact_name = name WHERE contact_name IS NULL AND name IS NOT NULL AND name != phone AND length(name) > 0',
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
