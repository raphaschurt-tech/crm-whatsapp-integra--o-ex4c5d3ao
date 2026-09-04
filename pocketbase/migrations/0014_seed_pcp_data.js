migrate(
  (app) => {
    const productsCol = app.findCollectionByNameOrId('products')
    const familiesCol = app.findCollectionByNameOrId('item_families')

    // Itens de insumos para RPA Auto Parts (ex: Borracha, Capa, Pino, Bucha)
    const seedItems = [
      {
        name: 'Borracha de Vedação Nitrílica 70',
        sku: 'BOR-VED-70',
        description: 'Borracha nitrílica para vedação automotiva de alta durabilidade',
        price: 15.0,
        cost: 6.5,
        stock_quantity: 150,
        min_stock: 20,
        product_type: 'comprado',
        supplier: 'Borrachas Brasil Ltda',
      },
      {
        name: 'Borracha EPDM Alta Temperatura',
        sku: 'BOR-EPDM-90',
        description: 'Borracha EPDM resistente a altas temperaturas e intempéries',
        price: 22.0,
        cost: 9.8,
        stock_quantity: 80,
        min_stock: 15,
        product_type: 'comprado',
        supplier: 'Vulcanizados Sul',
      },
      {
        name: 'Capa Protetora de Aço Carbono',
        sku: 'CAP-ACO-01',
        description: 'Capa estampada em chapa de aço carbono zincada',
        price: 35.0,
        cost: 16.0,
        stock_quantity: 75,
        min_stock: 10,
        product_type: 'comprado',
        supplier: 'Estamparia Metalúrgica Central',
      },
      {
        name: 'Capa Protetora Termoplástica Reforçada',
        sku: 'CAP-TERM-02',
        description: 'Capa injetada em polímero reforçado com fibra de vidro',
        price: 28.0,
        cost: 12.5,
        stock_quantity: 110,
        min_stock: 25,
        product_type: 'comprado',
        supplier: 'Injeção Plásticos Real',
      },
      {
        name: 'Pino Guia de Aço Temperado 12mm',
        sku: 'PIN-ACO-12',
        description: 'Pino guia retificado em aço 1045 com tratamento térmico',
        price: 18.5,
        cost: 8.2,
        stock_quantity: 200,
        min_stock: 30,
        product_type: 'comprado',
        supplier: 'Usinagem & Fixadores Precisão',
      },
      {
        name: 'Pino Guia Inox 304',
        sku: 'PIN-INOX-12',
        description: 'Pino guia em aço inoxidável 304 antiferrugem',
        price: 32.0,
        cost: 15.4,
        stock_quantity: 60,
        min_stock: 10,
        product_type: 'comprado',
        supplier: 'Inoxparts Distribuidora',
      },
      {
        name: 'Bucha de Bronze Autolubrificante',
        sku: 'BUC-BRZ-20',
        description: 'Bucha sinterizada de bronze com lubrificação permanente',
        price: 25.0,
        cost: 11.0,
        stock_quantity: 90,
        min_stock: 15,
        product_type: 'comprado',
        supplier: 'Sinterizados do Brasil',
      },
      {
        name: 'Bucha de Poliuretano Alta Carga',
        sku: 'BUC-PU-85A',
        description: 'Bucha em poliuretano dureza 85 Shore A para suspensão pesada',
        price: 30.0,
        cost: 13.8,
        stock_quantity: 70,
        min_stock: 10,
        product_type: 'comprado',
        supplier: 'Poliuretanos Tech',
      },
    ]

    const itemRecordIdsBySku = {}

    for (const item of seedItems) {
      try {
        const existing = app.findFirstRecordByData('products', 'sku', item.sku)
        itemRecordIdsBySku[item.sku] = existing.id
      } catch (_) {
        const record = new Record(productsCol)
        record.set('name', item.name)
        record.set('sku', item.sku)
        record.set('description', item.description)
        record.set('price', item.price)
        record.set('cost', item.cost)
        record.set('stock_quantity', item.stock_quantity)
        record.set('min_stock', item.min_stock)
        record.set('product_type', item.product_type)
        record.set('supplier', item.supplier)
        app.save(record)
        itemRecordIdsBySku[item.sku] = record.id
      }
    }

    // Famílias de Insumos: Borracha, Capa, Pino, Bucha
    const familiesDef = [
      {
        name: 'Borracha',
        description: 'Componentes de vedação e amortecimento elastomérico',
        itemSkus: ['BOR-VED-70', 'BOR-EPDM-90'],
      },
      {
        name: 'Capa',
        description: 'Capas e invólucros protetores metálicos e plásticos',
        itemSkus: ['CAP-ACO-01', 'CAP-TERM-02'],
      },
      {
        name: 'Pino',
        description: 'Pinos de fixação, articulação e guia',
        itemSkus: ['PIN-ACO-12', 'PIN-INOX-12'],
      },
      {
        name: 'Bucha',
        description: 'Buchas de articulação, deslizamento e amortecimento',
        itemSkus: ['BUC-BRZ-20', 'BUC-PU-85A'],
      },
    ]

    const familyRecordIdsByName = {}

    for (const fam of familiesDef) {
      const productIds = fam.itemSkus.map((sku) => itemRecordIdsBySku[sku]).filter(Boolean)

      try {
        const existing = app.findFirstRecordByData('item_families', 'name', fam.name)
        existing.set('products', productIds)
        app.save(existing)
        familyRecordIdsByName[fam.name] = existing.id
      } catch (_) {
        const record = new Record(familiesCol)
        record.set('name', fam.name)
        record.set('description', fam.description)
        record.set('products', productIds)
        app.save(record)
        familyRecordIdsByName[fam.name] = record.id
      }
    }

    // Criar um produto final Produzido modelo: "Kit Articulação de Suspensão Pro"
    let finishedProduct
    try {
      finishedProduct = app.findFirstRecordByData('products', 'sku', 'KIT-ART-SUSP-PRO')
    } catch (_) {
      finishedProduct = new Record(productsCol)
      finishedProduct.set('name', 'Kit Articulação de Suspensão Pro')
      finishedProduct.set('sku', 'KIT-ART-SUSP-PRO')
      finishedProduct.set(
        'description',
        'Kit completo montado com pino guia, bucha autolubrificante, borracha de vedação e capa protetora.',
      )
      finishedProduct.set('price', 189.9)
      finishedProduct.set('cost', 41.7)
      finishedProduct.set('stock_quantity', 12)
      finishedProduct.set('min_stock', 5)
      finishedProduct.set('product_type', 'produzido')
      finishedProduct.set('supplier', 'Fabricação Própria (PCP)')
      app.save(finishedProduct)
    }

    // Configurar Composição por Famílias para o Kit Articulação
    const compositionsCol = app.findCollectionByNameOrId('product_compositions')
    const familiesToBind = [
      { name: 'Borracha', allowedSkus: ['BOR-VED-70', 'BOR-EPDM-90'], required: true },
      { name: 'Capa', allowedSkus: ['CAP-ACO-01', 'CAP-TERM-02'], required: true },
      { name: 'Pino', allowedSkus: ['PIN-ACO-12', 'PIN-INOX-12'], required: true },
      { name: 'Bucha', allowedSkus: ['BUC-BRZ-20', 'BUC-PU-85A'], required: true },
    ]

    for (const comp of familiesToBind) {
      const famId = familyRecordIdsByName[comp.name]
      if (!famId) continue

      const allowedIds = comp.allowedSkus.map((sku) => itemRecordIdsBySku[sku]).filter(Boolean)

      // Verificar se já existe composição deste produto com esta família
      const existingFilter = `product = '${finishedProduct.id}' && family = '${famId}'`
      const existingRecords = app.findRecordsByFilter(
        'product_compositions',
        existingFilter,
        '',
        1,
        0,
      )

      if (existingRecords && existingRecords.length > 0) {
        const rec = existingRecords[0]
        rec.set('allowed_products', allowedIds)
        rec.set('required', comp.required)
        app.save(rec)
      } else {
        const rec = new Record(compositionsCol)
        rec.set('product', finishedProduct.id)
        rec.set('family', famId)
        rec.set('allowed_products', allowedIds)
        rec.set('required', comp.required)
        app.save(rec)
      }
    }
  },
  (app) => {
    // Reversão limpa registros criados
    try {
      const skus = [
        'BOR-VED-70',
        'BOR-EPDM-90',
        'CAP-ACO-01',
        'CAP-TERM-02',
        'PIN-ACO-12',
        'PIN-INOX-12',
        'BUC-BRZ-20',
        'BUC-PU-85A',
        'KIT-ART-SUSP-PRO',
      ]
      for (const sku of skus) {
        try {
          const p = app.findFirstRecordByData('products', 'sku', sku)
          app.delete(p)
        } catch (_) {}
      }
    } catch (_) {}
  },
)
