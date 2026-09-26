migrate(
  (app) => {
    // 1. Adicionar campo ai_excluded_skus na collection settings
    const settings = app.findCollectionByNameOrId('settings')
    if (!settings.fields.getByName('ai_excluded_skus')) {
      settings.fields.add(
        new TextField({
          name: 'ai_excluded_skus',
          required: false,
        }),
      )
      app.save(settings)
    }

    // 2. Adicionar campo lead_viewed na collection customers para controle de visto/piscar no Pipeline
    const customers = app.findCollectionByNameOrId('customers')
    if (!customers.fields.getByName('lead_viewed')) {
      customers.fields.add(
        new BoolField({
          name: 'lead_viewed',
          required: false,
        }),
      )
      app.save(customers)
    }
  },
  (app) => {
    try {
      const settings = app.findCollectionByNameOrId('settings')
      const excludedField = settings.fields.getByName('ai_excluded_skus')
      if (excludedField) {
        settings.fields.removeByName('ai_excluded_skus')
        app.save(settings)
      }
    } catch (_) {}

    try {
      const customers = app.findCollectionByNameOrId('customers')
      const viewedField = customers.fields.getByName('lead_viewed')
      if (viewedField) {
        customers.fields.removeByName('lead_viewed')
        app.save(customers)
      }
    } catch (_) {}
  },
)
