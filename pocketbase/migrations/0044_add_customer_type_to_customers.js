migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('customer_type')) {
      customers.fields.add(
        new TextField({
          name: 'customer_type',
          required: false,
        }),
      )
      app.save(customers)
    }
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const field = customers.fields.getByName('customer_type')
      if (field) {
        customers.fields.remove(field)
        app.save(customers)
      }
    } catch (_) {}
  },
)
