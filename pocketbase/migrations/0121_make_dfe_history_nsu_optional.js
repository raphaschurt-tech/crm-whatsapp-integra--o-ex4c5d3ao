migrate(
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('dfe_history')
      const nsuField = col.fields.getByName('nsu')
      if (nsuField) {
        nsuField.required = false
        app.save(col)
        console.log('[MIGRATION-0121] Campo nsu em dfe_history tornado opcional (required=false).')
      }
    } catch (err) {
      console.log('[MIGRATION-0121-ERR]', String(err))
      throw err
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('dfe_history')
      const nsuField = col.fields.getByName('nsu')
      if (nsuField) {
        nsuField.required = true
        app.save(col)
      }
    } catch (_) {}
  },
)
