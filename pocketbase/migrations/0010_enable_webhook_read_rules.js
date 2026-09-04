migrate(
  (app) => {
    // 1. Liberar listRule e viewRule para webhook_received
    const webhookCol = app.findCollectionByNameOrId('webhook_received')
    webhookCol.listRule = ''
    webhookCol.viewRule = ''
    app.save(webhookCol)

    // 2. Liberar listRule e viewRule para message_processing
    const msgProcCol = app.findCollectionByNameOrId('message_processing')
    msgProcCol.listRule = ''
    msgProcCol.viewRule = ''
    app.save(msgProcCol)
  },
  (app) => {
    try {
      const webhookCol = app.findCollectionByNameOrId('webhook_received')
      webhookCol.listRule = null
      webhookCol.viewRule = null
      app.save(webhookCol)
    } catch (_) {}

    try {
      const msgProcCol = app.findCollectionByNameOrId('message_processing')
      msgProcCol.listRule = null
      msgProcCol.viewRule = null
      app.save(msgProcCol)
    } catch (_) {}
  },
)
