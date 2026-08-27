migrate(
  (app) => {
    // 1. Atualizar a coleção settings: adicionar authorized_test_phone e ai_model se não existirem
    const settings = app.findCollectionByNameOrId('settings')
    if (!settings.fields.getByName('authorized_test_phone')) {
      settings.fields.add(
        new TextField({
          name: 'authorized_test_phone',
        }),
      )
    }
    if (!settings.fields.getByName('ai_model')) {
      settings.fields.add(
        new TextField({
          name: 'ai_model',
        }),
      )
    }
    app.save(settings)

    // Garantir valor inicial na coleção settings
    try {
      const records = app.findRecordsByFilter('settings', '', '-created', 1, 0)
      if (records && records.length > 0) {
        const record = records[0]
        record.set('ai_enabled', false) // Conforme requisito: ia_enabled=false durante o deploy inicial
        record.set('authorized_test_phone', '5511947861439')
        record.set('ai_model', 'gpt-4o-mini')
        app.save(record)
      } else {
        const record = new Record(settings)
        record.set('ai_enabled', false)
        record.set('authorized_test_phone', '5511947861439')
        record.set('ai_model', 'gpt-4o-mini')
        app.save(record)
      }
    } catch (e) {
      console.log('[MIGRATION-0005-SETTINGS-SEED-ERR]', e.message || String(e))
    }

    // 2. Criar coleção message_processing para controle de idempotência, fila e estado persistente
    try {
      app.findCollectionByNameOrId('message_processing')
    } catch (_) {
      const messageProcessing = new Collection({
        name: 'message_processing',
        type: 'base',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'messageId', type: 'text', required: true },
          { name: 'phone', type: 'text', required: true },
          {
            name: 'status',
            type: 'select',
            values: ['received', 'processing', 'completed', 'failed'],
            maxSelect: 1,
            required: true,
          },
          { name: 'replySent', type: 'bool' },
          { name: 'incomingText', type: 'text' },
          { name: 'aiReplyText', type: 'text' },
          { name: 'aiModel', type: 'text' },
          { name: 'zapiStatus', type: 'number' },
          { name: 'errorMessage', type: 'text' },
          { name: 'retryCount', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_msg_proc_messageId ON message_processing (messageId)',
          'CREATE INDEX idx_msg_proc_status ON message_processing (status)',
          'CREATE INDEX idx_msg_proc_phone ON message_processing (phone)',
        ],
      })
      app.save(messageProcessing)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('message_processing')
      if (col) app.delete(col)
    } catch (_) {}

    try {
      const settings = app.findCollectionByNameOrId('settings')
      const p = settings.fields.getByName('authorized_test_phone')
      if (p) settings.fields.remove(p)
      const m = settings.fields.getByName('ai_model')
      if (m) settings.fields.remove(m)
      app.save(settings)
    } catch (_) {}
  },
)
