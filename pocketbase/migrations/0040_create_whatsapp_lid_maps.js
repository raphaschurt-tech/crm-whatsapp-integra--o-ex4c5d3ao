migrate(
  (app) => {
    // Migração 0040: Criar coleção whatsapp_lid_maps para relacionar WhatsApp LID ao telefone real
    const lidMaps = new Collection({
      name: 'whatsapp_lid_maps',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'lid', type: 'text', required: true },
        { name: 'phone', type: 'text', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_whatsapp_lid_maps_lid ON whatsapp_lid_maps (lid)',
        'CREATE INDEX idx_whatsapp_lid_maps_phone ON whatsapp_lid_maps (phone)',
      ],
    })
    app.save(lidMaps)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('whatsapp_lid_maps')
      if (col) app.delete(col)
    } catch (_) {}
  },
)
