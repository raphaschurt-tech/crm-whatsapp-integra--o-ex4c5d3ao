migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('whatsapp_status')) {
      customers.fields.add(
        new TextField({
          name: 'whatsapp_status',
        }),
      )
    }

    app.save(customers)
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const field = customers.fields.getByName('whatsapp_status')
      if (field) {
        customers.fields.remove(field)
        app.save(customers)
      }
    } catch (_) {}
  },
)
