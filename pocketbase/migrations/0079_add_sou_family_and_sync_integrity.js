migrate(
  (app) => {
    // 1. Campo sou_family (texto) na collection products
    const products = app.findCollectionByNameOrId('products')
    if (!products.fields.getByName('sou_family')) {
      products.fields.add(
        new TextField({
          name: 'sou_family',
          required: false,
        }),
      )
    }

    // Campo is_active (bool, default true) na collection products se não existir
    if (!products.fields.getByName('is_active')) {
      products.fields.add(
        new BoolField({
          name: 'is_active',
          required: false,
        }),
      )
    }
    app.save(products)

    // Inicializar is_active = true para produtos existentes sem is_active definido
    app
      .db()
      .newQuery(
        "UPDATE products SET is_active = 1 WHERE is_active IS NULL OR is_active = 0 AND (external_id IS NOT NULL AND external_id != '')",
      )
      .execute()

    // 2. Campos allowed_families (texto/json) e sync_integrity_floor (número, default 0.80) na collection settings
    const settings = app.findCollectionByNameOrId('settings')
    if (!settings.fields.getByName('allowed_families')) {
      settings.fields.add(
        new TextField({
          name: 'allowed_families',
          required: false,
        }),
      )
    }

    if (!settings.fields.getByName('sync_integrity_floor')) {
      settings.fields.add(
        new NumberField({
          name: 'sync_integrity_floor',
          required: false,
          min: 0,
          max: 1,
        }),
      )
    }
    app.save(settings)

    // Atualizar settings existente para preencher sync_integrity_floor = 0.80 se nulo
    app
      .db()
      .newQuery(
        'UPDATE settings SET sync_integrity_floor = 0.80 WHERE sync_integrity_floor IS NULL OR sync_integrity_floor = 0',
      )
      .execute()
  },
  (app) => {
    try {
      const products = app.findCollectionByNameOrId('products')
      if (products.fields.getByName('sou_family')) {
        products.fields.removeByName('sou_family')
      }
      app.save(products)
    } catch (_) {}

    try {
      const settings = app.findCollectionByNameOrId('settings')
      if (settings.fields.getByName('allowed_families')) {
        settings.fields.removeByName('allowed_families')
      }
      if (settings.fields.getByName('sync_integrity_floor')) {
        settings.fields.removeByName('sync_integrity_floor')
      }
      app.save(settings)
    } catch (_) {}
  },
)
