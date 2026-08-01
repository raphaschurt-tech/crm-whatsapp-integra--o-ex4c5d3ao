migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    let adminRecord
    try {
      adminRecord = app.findAuthRecordByEmail('_pb_users_auth_', 'raphaschurt@gmail.com')
      adminRecord.set('role', 'admin')
      adminRecord.set('name', 'Raphael Schurt')
      app.save(adminRecord)
    } catch (_) {
      adminRecord = new Record(users)
      adminRecord.setEmail('raphaschurt@gmail.com')
      adminRecord.setPassword('Skip@Pass')
      adminRecord.setVerified(true)
      adminRecord.set('name', 'Raphael Schurt')
      adminRecord.set('role', 'admin')
      adminRecord.set('phone', '(11) 99999-8888')
      app.save(adminRecord)
    }

    const settingsCol = app.findCollectionByNameOrId('settings')
    try {
      app.findFirstRecordByData('settings', 'whatsapp_number', '5511999998888')
    } catch (_) {
      const s = new Record(settingsCol)
      s.set('whatsapp_number', '5511999998888')
      s.set('stock_api_url', 'https://dummyjson.com/products')
      s.set('payment_link_template', '')
      app.save(s)
    }

    const customersCol = app.findCollectionByNameOrId('customers')
    const customerList = [
      {
        name: 'Carlos Silva',
        phone: '(11) 98765-4321',
        email: 'carlos@empresa.com.br',
        company: 'Tech Solutions',
        notes: 'Cliente VIP',
      },
      {
        name: 'Ana Souza',
        phone: '(21) 99887-6543',
        email: 'ana.souza@design.com.br',
        company: 'Studio Design',
        notes: 'Aguardando orçamento anual',
      },
      {
        name: 'Mariana Oliveira',
        phone: '(31) 97654-3210',
        email: 'mariana@comercio.com.br',
        company: 'Comércio Oliveira',
        notes: 'Preferência contato via WhatsApp',
      },
    ]
    const savedCustomers = []
    for (const c of customerList) {
      try {
        const existing = app.findFirstRecordByData('customers', 'phone', c.phone)
        savedCustomers.push(existing)
      } catch (_) {
        const rec = new Record(customersCol)
        rec.set('name', c.name)
        rec.set('phone', c.phone)
        rec.set('email', c.email)
        rec.set('company', c.company)
        rec.set('notes', c.notes)
        app.save(rec)
        savedCustomers.push(rec)
      }
    }

    const productsCol = app.findCollectionByNameOrId('products')
    const productList = [
      {
        name: 'Notebook Pro 15',
        sku: 'NOTE-PRO-15',
        price: 4500.0,
        cost: 3200.0,
        stock_quantity: 12,
        min_stock: 3,
        description: 'Notebook 16GB RAM SSD 512GB',
      },
      {
        name: 'Monitor UltraWide 29',
        sku: 'MON-UW-29',
        price: 1250.0,
        cost: 850.0,
        stock_quantity: 2,
        min_stock: 5,
        description: 'Monitor 29 IPS 75Hz',
      },
      {
        name: 'Teclado Mecânico RGB',
        sku: 'TEC-MEC-01',
        price: 350.0,
        cost: 180.0,
        stock_quantity: 0,
        min_stock: 10,
        description: 'Teclado mecânico switch blue',
      },
      {
        name: 'Mouse Sem Fio Ergonômico',
        sku: 'MOU-SF-02',
        price: 180.0,
        cost: 90.0,
        stock_quantity: 25,
        min_stock: 5,
        description: 'Mouse óptico 1600 DPI',
      },
      {
        name: 'Cadeira Ergonômica Pro',
        sku: 'CAD-ERG-10',
        price: 890.0,
        cost: 550.0,
        stock_quantity: 8,
        min_stock: 2,
        description: 'Cadeira ajustável com suporte lombar',
      },
    ]
    const savedProducts = []
    for (const p of productList) {
      try {
        const existing = app.findFirstRecordByData('products', 'sku', p.sku)
        savedProducts.push(existing)
      } catch (_) {
        const rec = new Record(productsCol)
        rec.set('name', p.name)
        rec.set('sku', p.sku)
        rec.set('price', p.price)
        rec.set('cost', p.cost)
        rec.set('stock_quantity', p.stock_quantity)
        rec.set('min_stock', p.min_stock)
        rec.set('description', p.description)
        app.save(rec)
        savedProducts.push(rec)
      }
    }

    const quotesCol = app.findCollectionByNameOrId('quotes')
    const itemsCol = app.findCollectionByNameOrId('quote_items')

    try {
      app.findFirstRecordByData('quotes', 'number', 'ORC-2025-0001')
    } catch (_) {
      const q1 = new Record(quotesCol)
      q1.set('number', 'ORC-2025-0001')
      q1.set('customer', savedCustomers[0].id)
      q1.set('status', 'enviado')
      q1.set('subtotal', 5750.0)
      q1.set('discount', 150.0)
      q1.set('total', 5600.0)
      q1.set('notes', 'Entrega em até 3 dias úteis')
      q1.set('payment_token', 'tok_abc123')
      app.save(q1)

      const qi1 = new Record(itemsCol)
      qi1.set('quote', q1.id)
      qi1.set('product', savedProducts[0].id)
      qi1.set('quantity', 1)
      qi1.set('unit_price', 4500.0)
      qi1.set('total', 4500.0)
      app.save(qi1)

      const qi2 = new Record(itemsCol)
      qi2.set('quote', q1.id)
      qi2.set('product', savedProducts[1].id)
      qi2.set('quantity', 1)
      qi2.set('unit_price', 1250.0)
      qi2.set('total', 1250.0)
      app.save(qi2)
    }

    try {
      app.findFirstRecordByData('quotes', 'number', 'ORC-2025-0002')
    } catch (_) {
      const q2 = new Record(quotesCol)
      q2.set('number', 'ORC-2025-0002')
      q2.set('customer', savedCustomers[1].id)
      q2.set('status', 'rascunho')
      q2.set('subtotal', 350.0)
      q2.set('discount', 0.0)
      q2.set('total', 350.0)
      q2.set('notes', 'Aguardando aprovação de orçamento')
      q2.set('payment_token', 'tok_xyz456')
      app.save(q2)

      const qi3 = new Record(itemsCol)
      qi3.set('quote', q2.id)
      qi3.set('product', savedProducts[2].id)
      qi3.set('quantity', 1)
      qi3.set('unit_price', 350.0)
      qi3.set('total', 350.0)
      app.save(qi3)
    }
  },
  (app) => {},
)
