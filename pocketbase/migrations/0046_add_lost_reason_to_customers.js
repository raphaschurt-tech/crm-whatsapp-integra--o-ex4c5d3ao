migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('lost_reason')) {
      customers.fields.add(
        new TextField({
          name: 'lost_reason',
          required: false,
        }),
      )
    }

    if (!customers.fields.getByName('lost_reason_detail')) {
      customers.fields.add(
        new TextField({
          name: 'lost_reason_detail',
          required: false,
        }),
      )
    }

    app.save(customers)
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const reasonField = customers.fields.getByName('lost_reason')
      if (reasonField) customers.fields.remove(reasonField)
      const detailField = customers.fields.getByName('lost_reason_detail')
      if (detailField) customers.fields.remove(detailField)
      app.save(customers)
    } catch (_) {}
  },
)
