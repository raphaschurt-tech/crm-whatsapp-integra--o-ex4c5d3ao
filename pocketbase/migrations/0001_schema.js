migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    if (!users.fields.getByName('role')) {
      users.fields.add(
        new SelectField({ name: 'role', values: ['admin', 'colaborador'], maxSelect: 1 }),
      )
    }
    if (!users.fields.getByName('phone')) {
      users.fields.add(new TextField({ name: 'phone' }))
    }
    app.save(users)

    const customers = new Collection({
      name: 'customers',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'phone', type: 'text', required: true },
        { name: 'email', type: 'text' },
        { name: 'company', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_customers_phone ON customers (phone)',
        'CREATE INDEX idx_customers_name ON customers (name)',
      ],
    })
    app.save(customers)

    const products = new Collection({
      name: 'products',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'sku', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'price', type: 'number', required: true, min: 0 },
        { name: 'cost', type: 'number', min: 0 },
        { name: 'stock_quantity', type: 'number', required: true, min: 0 },
        { name: 'min_stock', type: 'number', min: 0 },
        { name: 'external_id', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_products_sku ON products (sku)',
        'CREATE INDEX idx_products_stock ON products (stock_quantity)',
        'CREATE INDEX idx_products_min_stock ON products (min_stock)',
      ],
    })
    app.save(products)

    const quotes = new Collection({
      name: 'quotes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: '',
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        { name: 'number', type: 'text', required: true },
        {
          name: 'customer',
          type: 'relation',
          required: true,
          collectionId: customers.id,
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['rascunho', 'enviado', 'aprovado', 'rejeitado', 'pago'],
          maxSelect: 1,
        },
        { name: 'subtotal', type: 'number', min: 0 },
        { name: 'discount', type: 'number', min: 0 },
        { name: 'total', type: 'number', min: 0 },
        { name: 'notes', type: 'text' },
        { name: 'payment_link', type: 'text' },
        { name: 'payment_token', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_quotes_number ON quotes (number)',
        'CREATE INDEX idx_quotes_customer ON quotes (customer)',
        'CREATE INDEX idx_quotes_status ON quotes (status)',
        'CREATE INDEX idx_quotes_created ON quotes (created DESC)',
      ],
    })
    app.save(quotes)

    const quoteItems = new Collection({
      name: 'quote_items',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        {
          name: 'quote',
          type: 'relation',
          required: true,
          collectionId: quotes.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          maxSelect: 1,
        },
        { name: 'quantity', type: 'number', required: true, min: 1 },
        { name: 'unit_price', type: 'number', required: true, min: 0 },
        { name: 'total', type: 'number', required: true, min: 0 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_qi_quote ON quote_items (quote)',
        'CREATE INDEX idx_qi_product ON quote_items (product)',
      ],
    })
    app.save(quoteItems)

    const payments = new Collection({
      name: 'payments',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: '',
      createRule: '',
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        { name: 'quote', type: 'relation', required: true, collectionId: quotes.id, maxSelect: 1 },
        { name: 'amount', type: 'number', required: true, min: 0 },
        {
          name: 'method',
          type: 'select',
          required: true,
          values: ['pix', 'cartao', 'boleto', 'dinheiro', 'outros'],
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['pendente', 'aprovado'],
          maxSelect: 1,
        },
        { name: 'paid_at', type: 'date' },
        {
          name: 'receipt',
          type: 'file',
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_payments_quote ON payments (quote)',
        'CREATE INDEX idx_payments_status ON payments (status)',
      ],
    })
    app.save(payments)

    const settings = new Collection({
      name: 'settings',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      updateRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        { name: 'whatsapp_number', type: 'text' },
        { name: 'stock_api_url', type: 'text' },
        { name: 'payment_link_template', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(settings)
  },
  (app) => {
    const collections = ['settings', 'payments', 'quote_items', 'quotes', 'products', 'customers']
    for (const name of collections) {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col) app.delete(col)
      } catch (_) {}
    }
  },
)
