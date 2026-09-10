migrate(
  (app) => {
    // Migração 0041: Criar coleção whatsapp_read_states para guardar estado de leitura por conversa (telefone)
    const readStates = new Collection({
      name: 'whatsapp_read_states',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'phone', type: 'text', required: true },
        { name: 'lastReadAt', type: 'number', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_whatsapp_read_states_phone ON whatsapp_read_states (phone)',
      ],
    })
    app.save(readStates)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('whatsapp_read_states')
      if (col) app.delete(col)
    } catch (_) {}
  },
)
