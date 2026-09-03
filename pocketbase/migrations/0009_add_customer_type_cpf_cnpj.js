migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    if (!customers.fields.getByName('type')) {
      customers.fields.add(
        new SelectField({
          name: 'type',
          values: ['PF', 'PJ'],
          maxSelect: 1,
        }),
      )
    }

    if (!customers.fields.getByName('cpf')) {
      customers.fields.add(
        new TextField({
          name: 'cpf',
        }),
      )
    }

    if (!customers.fields.getByName('cnpj')) {
      customers.fields.add(
        new TextField({
          name: 'cnpj',
        }),
      )
    }

    app.save(customers)
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const typeField = customers.fields.getByName('type')
      if (typeField) customers.fields.remove(typeField)
      const cpfField = customers.fields.getByName('cpf')
      if (cpfField) customers.fields.remove(cpfField)
      const cnpjField = customers.fields.getByName('cnpj')
      if (cnpjField) customers.fields.remove(cnpjField)
      app.save(customers)
    } catch (_) {}
  },
)
