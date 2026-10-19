migrate(
  (app) => {
    const adminRule = "@request.auth.id != '' && @request.auth.role = 'admin'"
    const productsCol = app.findCollectionByNameOrId('products')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // 1. Criar nfe_product_mappings (MA-t / MA-t-2 / S1) com regras só-admin
    let mappingsCol
    try {
      mappingsCol = app.findCollectionByNameOrId('nfe_product_mappings')
    } catch (_) {
      mappingsCol = new Collection({
        name: 'nfe_product_mappings',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'supplier_cnpj', type: 'text', required: true },
          { name: 'supplier_name', type: 'text' },
          { name: 'supplier_code', type: 'text', required: true },
          { name: 'supplier_description', type: 'text' },
          {
            name: 'product',
            type: 'relation',
            collectionId: productsCol.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'product_sku', type: 'text', required: true },
          { name: 'product_name', type: 'text' },
          {
            name: 'confirmed_by',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_nfe_map_cnpj_code ON nfe_product_mappings (supplier_cnpj, supplier_code)',
          'CREATE INDEX idx_nfe_map_product ON nfe_product_mappings (product)',
        ],
      })
      app.save(mappingsCol)
    }

    // 2. Adicionar campos em settings (company_cnpj, family_margins, stock_phase)
    const settingsCol = app.findCollectionByNameOrId('settings')
    let settingsUpdated = false
    if (!settingsCol.fields.getByName('company_cnpj')) {
      settingsCol.fields.add(new TextField({ name: 'company_cnpj' }))
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('family_margins')) {
      settingsCol.fields.add(new JSONField({ name: 'family_margins' }))
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('stock_phase')) {
      settingsCol.fields.add(
        new SelectField({
          name: 'stock_phase',
          values: ['souis_master', 'crm_cutover'],
          maxSelect: 1,
        }),
      )
      settingsUpdated = true
    }
    if (settingsUpdated) {
      app.save(settingsCol)
    }

    // 3. Adicionar campos incrementais em nfe_processed
    // - exception_reason: motivo da fila/exceção (S7, S8, Guard 2a, Guard 2b, etc.)
    // - souis_stock_status: pendente | lancado (F1 - entrada pendente no SOU.IS)
    // - souis_stock_launched_at: data do clique 'marcar como lançado'
    // - souis_stock_launched_by: user que marcou
    const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
    let nfeUpdated = false
    if (!nfeProcessedCol.fields.getByName('exception_reason')) {
      nfeProcessedCol.fields.add(new TextField({ name: 'exception_reason' }))
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('dest_cnpj')) {
      nfeProcessedCol.fields.add(new TextField({ name: 'dest_cnpj' }))
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('c_stat')) {
      nfeProcessedCol.fields.add(new TextField({ name: 'c_stat' }))
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('prot_nfe')) {
      nfeProcessedCol.fields.add(new TextField({ name: 'prot_nfe' }))
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('source_channel')) {
      nfeProcessedCol.fields.add(
        new SelectField({
          name: 'source_channel',
          values: ['manual_upload', 'whatsapp'],
          maxSelect: 1,
        }),
      )
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('souis_stock_status')) {
      nfeProcessedCol.fields.add(
        new SelectField({
          name: 'souis_stock_status',
          values: ['pendente', 'lancado', 'nao_aplicavel'],
          maxSelect: 1,
        }),
      )
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('souis_stock_launched_at')) {
      nfeProcessedCol.fields.add(new DateField({ name: 'souis_stock_launched_at' }))
      nfeUpdated = true
    }
    if (!nfeProcessedCol.fields.getByName('souis_stock_launched_by')) {
      nfeProcessedCol.fields.add(
        new RelationField({
          name: 'souis_stock_launched_by',
          collectionId: usersCol.id,
          maxSelect: 1,
          cascadeDelete: false,
        }),
      )
      nfeUpdated = true
    }
    if (nfeUpdated) {
      app.save(nfeProcessedCol)
    }

    // 4. Adicionar campos em nfe_price_queue
    // - family: família do produto para conferência
    // - margin_factor: fator de margem aplicado
    // - price_source_payload: registro da view SOU.IS comprovando preço 0/vazio (S4-h)
    // - item_type: 'preco_sugerido' | 'reconciliacao_item' | 'ajuste_preco_existente'
    // - raw_item_data: json com os dados completos do item
    const nfePriceQueueCol = app.findCollectionByNameOrId('nfe_price_queue')
    let queueUpdated = false
    if (!nfePriceQueueCol.fields.getByName('product')) {
      nfePriceQueueCol.fields.add(
        new RelationField({
          name: 'product',
          collectionId: productsCol.id,
          maxSelect: 1,
          cascadeDelete: false,
        }),
      )
      queueUpdated = true
    }
    if (!nfePriceQueueCol.fields.getByName('family')) {
      nfePriceQueueCol.fields.add(new TextField({ name: 'family' }))
      queueUpdated = true
    }
    if (!nfePriceQueueCol.fields.getByName('margin_factor')) {
      nfePriceQueueCol.fields.add(new NumberField({ name: 'margin_factor' }))
      queueUpdated = true
    }
    if (!nfePriceQueueCol.fields.getByName('price_source_payload')) {
      nfePriceQueueCol.fields.add(new TextField({ name: 'price_source_payload' }))
      queueUpdated = true
    }
    if (!nfePriceQueueCol.fields.getByName('item_type')) {
      nfePriceQueueCol.fields.add(
        new SelectField({
          name: 'item_type',
          values: ['preco_sugerido', 'reconciliacao_item', 'ajuste_preco_existente', 'excecao'],
          maxSelect: 1,
        }),
      )
      queueUpdated = true
    }
    if (!nfePriceQueueCol.fields.getByName('raw_item_data')) {
      nfePriceQueueCol.fields.add(new JSONField({ name: 'raw_item_data' }))
      queueUpdated = true
    }
    if (queueUpdated) {
      app.save(nfePriceQueueCol)
    }
  },
  (app) => {
    try {
      const mappingsCol = app.findCollectionByNameOrId('nfe_product_mappings')
      app.delete(mappingsCol)
    } catch (_) {}
  },
)
