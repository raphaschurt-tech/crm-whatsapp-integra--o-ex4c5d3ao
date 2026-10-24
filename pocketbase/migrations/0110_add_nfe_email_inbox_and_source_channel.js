migrate(
  (app) => {
    // 1. Adicionar valor 'email' ao select 'source_channel' de nfe_processed
    const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
    const sourceField = nfeProcessedCol.fields.getByName('source_channel')
    if (sourceField) {
      nfeProcessedCol.fields.removeByName('source_channel')
      nfeProcessedCol.fields.add(
        new SelectField({
          name: 'source_channel',
          values: ['manual_upload', 'whatsapp', 'dfe', 'email'],
          maxSelect: 1,
        }),
      )
      app.save(nfeProcessedCol)
    }

    // 2. Criar coleção nfe_email_inbox (idempotente)
    let inboxCol = null
    try {
      inboxCol = app.findCollectionByNameOrId('nfe_email_inbox')
    } catch (_) {}

    if (!inboxCol) {
      const adminRule = "@request.auth.id != '' && @request.auth.role = 'admin'"
      inboxCol = new Collection({
        name: 'nfe_email_inbox',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'gmail_message_id', type: 'text', required: true },
          { name: 'gmail_thread_id', type: 'text' },
          { name: 'sender_email', type: 'text' },
          { name: 'sender_known', type: 'bool' },
          { name: 'sender_name', type: 'text' },
          { name: 'subject', type: 'text' },
          { name: 'email_date', type: 'text' },
          { name: 'xml_count', type: 'number' },
          { name: 'xml_keys', type: 'json' },
          {
            name: 'status',
            type: 'select',
            values: ['processado', 'sem_xml', 'erro'],
            maxSelect: 1,
          },
          { name: 'error_detail', type: 'text' },
          { name: 'processed_at', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_nfe_email_msg_id ON nfe_email_inbox (gmail_message_id)',
          'CREATE INDEX idx_nfe_email_status ON nfe_email_inbox (status)',
          'CREATE INDEX idx_nfe_email_sender ON nfe_email_inbox (sender_email)',
        ],
      })
      app.save(inboxCol)
    }
  },
  (app) => {
    try {
      const inboxCol = app.findCollectionByNameOrId('nfe_email_inbox')
      app.delete(inboxCol)
    } catch (_) {}

    try {
      const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
      const sourceField = nfeProcessedCol.fields.getByName('source_channel')
      if (sourceField) {
        nfeProcessedCol.fields.removeByName('source_channel')
        nfeProcessedCol.fields.add(
          new SelectField({
            name: 'source_channel',
            values: ['manual_upload', 'whatsapp', 'dfe'],
            maxSelect: 1,
          }),
        )
        app.save(nfeProcessedCol)
      }
    } catch (_) {}
  },
)
