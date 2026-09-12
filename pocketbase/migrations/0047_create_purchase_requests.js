migrate(
  (app) => {
    const customers = app.findCollectionByNameOrId('customers')

    const purchaseRequests = new Collection({
      name: 'purchase_requests',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'part_name', type: 'text', required: true },
        { name: 'vehicle', type: 'text', required: true },
        {
          name: 'customer',
          type: 'relation',
          required: true,
          collectionId: customers.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'supplier',
          type: 'relation',
          required: false,
          collectionId: customers.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: [
            'solicitada',
            'cotacao',
            'aprovada',
            'pedido_emitido',
            'em_transito',
            'recebida',
            'entregue',
          ],
          maxSelect: 1,
        },
        { name: 'cost_price', type: 'number', min: 0 },
        { name: 'sell_price', type: 'number', min: 0 },
        { name: 'delivery_days', type: 'number', min: 0 },
        { name: 'received_at', type: 'date' },
        { name: 'is_completed', type: 'bool' },
        { name: 'notes', type: 'text' },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_pr_customer ON purchase_requests (customer)',
        'CREATE INDEX idx_pr_supplier ON purchase_requests (supplier)',
        'CREATE INDEX idx_pr_status ON purchase_requests (status)',
        'CREATE INDEX idx_pr_created ON purchase_requests (created DESC)',
      ],
    })

    app.save(purchaseRequests)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('purchase_requests')
      if (col) app.delete(col)
    } catch (_) {}
  },
)
