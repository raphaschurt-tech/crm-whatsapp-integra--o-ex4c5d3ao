migrate(
  (app) => {
    const webhookReceived = new Collection({
      name: 'webhook_received',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: '',
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'type', type: 'text' },
        { name: 'phone', type: 'json' },
        { name: 'fromMe', type: 'bool' },
        { name: 'text', type: 'json' },
        { name: 'chat', type: 'json' },
        { name: 'sender', type: 'json' },
        { name: 'status', type: 'text' },
        { name: 'messageId', type: 'text' },
        { name: 'instanceId', type: 'text' },
        { name: 'moment', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_webhook_received_messageId ON webhook_received (messageId)',
        'CREATE INDEX idx_webhook_received_instanceId ON webhook_received (instanceId)',
        'CREATE INDEX idx_webhook_received_type ON webhook_received (type)',
        'CREATE INDEX idx_webhook_received_created ON webhook_received (created DESC)',
      ],
    })
    app.save(webhookReceived)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('webhook_received')
      if (col) app.delete(col)
    } catch (_) {}
  },
)
