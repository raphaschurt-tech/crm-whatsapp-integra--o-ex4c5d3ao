migrate(
  (app) => {
    // 1. Atualizar a collection 'products' com tipo ('comprado' | 'produzido') e fornecedor
    const products = app.findCollectionByNameOrId('products')
    if (!products.fields.getByName('product_type')) {
      products.fields.add(
        new SelectField({
          name: 'product_type',
          values: ['comprado', 'produzido'],
          maxSelect: 1,
        }),
      )
    }
    if (!products.fields.getByName('supplier')) {
      products.fields.add(
        new TextField({
          name: 'supplier',
        }),
      )
    }
    app.save(products)

    // 2. Collection 'item_families' (Famílias de insumos)
    const itemFamilies = new Collection({
      name: 'item_families',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'description', type: 'text' },
        {
          name: 'products',
          type: 'relation',
          collectionId: products.id,
          cascadeDelete: false,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_item_families_name ON item_families (name)'],
    })
    app.save(itemFamilies)

    // 3. Collection 'product_compositions'
    // Define a obrigatoriedade de famílias e quais itens específicos daquela família são permitidos para um produto produzido
    const productCompositions = new Collection({
      name: 'product_compositions',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'family',
          type: 'relation',
          required: true,
          collectionId: itemFamilies.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'allowed_products',
          type: 'relation',
          collectionId: products.id,
          cascadeDelete: false,
        },
        { name: 'required', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_prod_comp_product ON product_compositions (product)',
        'CREATE INDEX idx_prod_comp_family ON product_compositions (family)',
      ],
    })
    app.save(productCompositions)

    // 4. Collection 'production_orders' (Ordens de Produção - OP)
    const productionOrders = new Collection({
      name: 'production_orders',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'code', type: 'text', required: true },
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          maxSelect: 1,
        },
        { name: 'quantity', type: 'number', required: true, min: 1 },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['aberta', 'em_producao', 'concluida', 'cancelada'],
          maxSelect: 1,
        },
        { name: 'total_cost', type: 'number', min: 0 },
        { name: 'unit_cost', type: 'number', min: 0 },
        // selected_items armazena JSON com array de:
        // { family_id, family_name, product_id, product_name, sku, unit_cost, quantity_used, total_cost, is_produced }
        { name: 'selected_items', type: 'json' },
        { name: 'notes', type: 'text' },
        { name: 'completed_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_po_code ON production_orders (code)',
        'CREATE INDEX idx_po_product ON production_orders (product)',
        'CREATE INDEX idx_po_status ON production_orders (status)',
        'CREATE INDEX idx_po_created ON production_orders (created DESC)',
      ],
    })
    app.save(productionOrders)
  },
  (app) => {
    try {
      const po = app.findCollectionByNameOrId('production_orders')
      if (po) app.delete(po)
    } catch (_) {}

    try {
      const pc = app.findCollectionByNameOrId('product_compositions')
      if (pc) app.delete(pc)
    } catch (_) {}

    try {
      const fam = app.findCollectionByNameOrId('item_families')
      if (fam) app.delete(fam)
    } catch (_) {}

    try {
      const products = app.findCollectionByNameOrId('products')
      const ptField = products.fields.getByName('product_type')
      if (ptField) products.fields.remove(ptField)
      const supField = products.fields.getByName('supplier')
      if (supField) products.fields.remove(supField)
      app.save(products)
    } catch (_) {}
  },
)
