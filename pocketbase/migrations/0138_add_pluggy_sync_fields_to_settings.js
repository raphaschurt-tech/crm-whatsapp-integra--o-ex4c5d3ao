/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const settingsCol = app.findCollectionByNameOrId('settings')

    // pluggy_last_sync_at (date)
    try {
      settingsCol.fields.addAt(
        settingsCol.fields.length,
        new Field({
          name: 'pluggy_last_sync_at',
          type: 'date',
        }),
      )
    } catch (_) {}

    // pluggy_last_sync_status (text)
    try {
      settingsCol.fields.addAt(
        settingsCol.fields.length,
        new Field({
          name: 'pluggy_last_sync_status',
          type: 'text',
        }),
      )
    } catch (_) {}

    // pluggy_last_sync_message (text)
    try {
      settingsCol.fields.addAt(
        settingsCol.fields.length,
        new Field({
          name: 'pluggy_last_sync_message',
          type: 'text',
        }),
      )
    } catch (_) {}

    // pluggy_account_id (text - opcional caso o usuário configure um accountId específico)
    try {
      settingsCol.fields.addAt(
        settingsCol.fields.length,
        new Field({
          name: 'pluggy_account_id',
          type: 'text',
        }),
      )
    } catch (_) {}

    // pluggy_item_id (text - opcional caso o usuário configure um itemId específico)
    try {
      settingsCol.fields.addAt(
        settingsCol.fields.length,
        new Field({
          name: 'pluggy_item_id',
          type: 'text',
        }),
      )
    } catch (_) {}

    app.save(settingsCol)
    console.log('[MIGRATION-0138] Campos de controle Pluggy adicionados à coleção settings.')
  },
  (app) => {
    try {
      const settingsCol = app.findCollectionByNameOrId('settings')
      const fieldNames = [
        'pluggy_last_sync_at',
        'pluggy_last_sync_status',
        'pluggy_last_sync_message',
        'pluggy_account_id',
        'pluggy_item_id',
      ]
      for (let i = 0; i < fieldNames.length; i++) {
        const f = settingsCol.fields.getByName(fieldNames[i])
        if (f) settingsCol.fields.remove(f)
      }
      app.save(settingsCol)
    } catch (_) {}
  },
)
