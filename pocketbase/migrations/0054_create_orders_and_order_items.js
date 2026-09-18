migrate(
  (app) => {
    // 1. Adicionar reserved_quantity (number, default 0) em products se não existir
    const productsCol = app.findCollectionByNameOrId('products')
    if (!productsCol.fields.getByName('reserved_quantity')) {
      productsCol.fields.add(
        new NumberField({
          name: 'reserved_quantity',
          min: 0,
        }),
      )
      app.save(productsCol)
    }

    // Inicializar registros existentes com reserved_quantity = 0 onde estiver nulo
    app
      .db()
      .newQuery('UPDATE products SET reserved_quantity = 0 WHERE reserved_quantity IS NULL')
      .execute()

    // 2. Resolver collectionIds de relações existentes
    const quotesCol = app.findCollectionByNameOrId('quotes')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // 3. Criar collection 'orders'
    let ordersCol
    try {
      ordersCol = app.findCollectionByNameOrId('orders')
    } catch (_) {
      ordersCol = new Collection({
        name: 'orders',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { name: 'code', type: 'text', required: true },
          {
            name: 'quote_id',
            type: 'relation',
            collectionId: quotesCol.id,
            maxSelect: 1,
            cascadeDelete: false,
            required: true,
          },
          { name: 'client_name', type: 'text', required: true },
          { name: 'total', type: 'number', required: true, min: 0 },
          {
            name: 'financial_status',
            type: 'select',
            required: true,
            values: ['pendente', 'pago'],
            maxSelect: 1,
          },
          {
            name: 'commercial_status',
            type: 'select',
            required: true,
            values: ['aberto', 'cancelado'],
            maxSelect: 1,
          },
          { name: 'promised_delivery_date', type: 'date' },
          {
            name: 'responsible',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_orders_code ON orders (code)',
          'CREATE INDEX idx_orders_quote ON orders (quote_id)',
          'CREATE INDEX idx_orders_commercial_status ON orders (commercial_status)',
          'CREATE INDEX idx_orders_financial_status ON orders (financial_status)',
        ],
      })
      app.save(ordersCol)
    }

    // Tentar adicionar índice único parcial em orders(quote_id) WHERE commercial_status != 'cancelado' (ADIÇÃO C)
    try {
      app
        .db()
        .newQuery(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_active_quote ON orders (quote_id) WHERE commercial_status != 'cancelado'",
        )
        .execute()
    } catch (idxErr) {
      console.log(
        '[MIGRATION-NOTE-PARTIAL-INDEX]',
        'Índice único parcial SQLite não aplicado ou já existente: ' + String(idxErr),
      )
    }

    // 4. Criar collection 'order_items'
    let orderItemsCol
    try {
      orderItemsCol = app.findCollectionByNameOrId('order_items')
    } catch (_) {
      orderItemsCol = new Collection({
        name: 'order_items',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          {
            name: 'order_id',
            type: 'relation',
            collectionId: ordersCol.id,
            maxSelect: 1,
            cascadeDelete: true,
            required: true,
          },
          {
            name: 'product_id',
            type: 'relation',
            collectionId: productsCol.id,
            maxSelect: 1,
            cascadeDelete: false,
            required: true,
          },
          { name: 'sku', type: 'text' },
          { name: 'name', type: 'text', required: true },
          { name: 'unit_price', type: 'number', required: true, min: 0 },
          { name: 'quantity_ordered', type: 'number', required: true, min: 1 },
          { name: 'quantity_reserved', type: 'number', required: true, min: 0 },
          { name: 'line_total', type: 'number', required: true, min: 0 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          // ADIÇÃO A: Índice único em order_items(order_id + product_id)
          'CREATE UNIQUE INDEX idx_order_items_order_product ON order_items (order_id, product_id)',
          'CREATE INDEX idx_order_items_order ON order_items (order_id)',
          'CREATE INDEX idx_order_items_product ON order_items (product_id)',
        ],
      })
      app.save(orderItemsCol)
    }
  },
  (app) => {
    try {
      const orderItems = app.findCollectionByNameOrId('order_items')
      app.delete(orderItems)
    } catch (_) {}

    try {
      const orders = app.findCollectionByNameOrId('orders')
      app.delete(orders)
    } catch (_) {}

    try {
      const products = app.findCollectionByNameOrId('products')
      const f = products.fields.getByName('reserved_quantity')
      if (f) {
        products.fields.remove(f)
        app.save(products)
      }
    } catch (_) {}
  },
)
