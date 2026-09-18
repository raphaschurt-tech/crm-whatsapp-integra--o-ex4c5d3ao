migrate(
  (app) => {
    // 1. Criar collection chat_control de forma estritamente aditiva
    const collection = new Collection({
      name: 'chat_control',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      fields: [
        {
          name: 'phone',
          type: 'text',
          required: true,
        },
        {
          name: 'human_mode',
          type: 'bool',
          required: false,
        },
        {
          name: 'paused_by',
          type: 'text',
          required: false,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_chat_control_phone ON chat_control (phone)'],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('chat_control')
      app.delete(collection)
    } catch (_) {}
  },
)
