migrate((app) => {
  let collection
  try {
    collection = app.findCollectionByNameOrId('chat_summaries')
  } catch (_) {
    // collection does not exist
  }

  if (!collection) {
    collection = new Collection({
      name: 'chat_summaries',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: null,
      fields: [
        {
          name: 'canonical_phone',
          type: 'text',
          required: true,
          presentable: true,
        },
        {
          name: 'raw_phone',
          type: 'text',
          required: false,
        },
        {
          name: 'last_message_preview',
          type: 'text',
          required: false,
        },
        {
          name: 'last_message_direction',
          type: 'text', // 'inbound' | 'outbound'
          required: false,
        },
        {
          name: 'last_message_at',
          type: 'text', // ISO string
          required: false,
        },
        {
          name: 'first_message_at',
          type: 'text', // ISO string
          required: false,
        },
        {
          name: 'unread_count',
          type: 'number',
          required: false,
        },
        {
          name: 'tem_mensagens',
          type: 'bool',
          required: false,
        },
        {
          name: 'last_message_id',
          type: 'text',
          required: false,
        },
        {
          name: 'last_seen_message_ids',
          type: 'json',
          required: false,
        },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_chat_summaries_canonical_phone ON chat_summaries (canonical_phone)',
        'CREATE INDEX idx_chat_summaries_last_message_at ON chat_summaries (last_message_at DESC)',
      ],
    })
    app.save(collection)
  }

  // Adicionar chave de cut-over / status de migração em settings caso não exista
  try {
    const settingsCol = app.findCollectionByNameOrId('settings')
    let hasMigrationField = false
    try {
      settingsCol.fields.forEach((f) => {
        if (f.name === 'chat_summaries_migrated') {
          hasMigrationField = true
        }
      })
    } catch (_) {}

    if (!hasMigrationField) {
      settingsCol.fields.add(
        new Field({
          name: 'chat_summaries_migrated',
          type: 'bool',
          required: false,
        }),
      )
      app.save(settingsCol)
    }
  } catch (errSettings) {
    console.log('[MIGRATION-0092-SETTINGS-FIELD-WARN]', errSettings.message || String(errSettings))
  }
})
