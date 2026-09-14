migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('purchase_requests')

    // 1. Adicionar campo items (JSON) se não existir
    if (!col.fields.getByName('items')) {
      col.fields.add(
        new JSONField({
          name: 'items',
          required: false,
        }),
      )
    }

    // 2. Adicionar campo os_number (Text) se não existir
    if (!col.fields.getByName('os_number')) {
      col.fields.add(
        new TextField({
          name: 'os_number',
          required: false,
        }),
      )
    }

    // 3. Deixar part_name e vehicle não-obrigatórios para suportar compras com lista de itens
    const partNameField = col.fields.getByName('part_name')
    if (partNameField) {
      partNameField.required = false
    }

    const vehicleField = col.fields.getByName('vehicle')
    if (vehicleField) {
      vehicleField.required = false
    }

    app.save(col)

    // 4. Migrar registros existentes para preencher items a partir de part_name e vehicle
    try {
      const records = app.findRecordsByFilter(
        'purchase_requests',
        'items = null || items = ""',
        '',
        500,
        0,
      )
      for (const record of records) {
        const pName = record.getString('part_name') || 'Item'
        const vModel = record.getString('vehicle') || ''
        record.set('items', [
          {
            part_name: pName,
            vehicle: vModel,
            quantity: 1,
          },
        ])
        app.save(record)
      }
    } catch (err) {
      console.log('Aviso ao migrar items existentes em purchase_requests:', err)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('purchase_requests')
      if (col.fields.getByName('items')) {
        col.fields.removeByName('items')
      }
      if (col.fields.getByName('os_number')) {
        col.fields.removeByName('os_number')
      }
      app.save(col)
    } catch (_) {}
  },
)
