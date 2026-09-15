migrate(
  (app) => {
    const quotesCol = app.findCollectionByNameOrId('quotes')
    const purchasesCol = app.findCollectionByNameOrId('purchase_requests')
    const quoteItemsCol = app.findCollectionByNameOrId('quote_items')

    // 1. Adicionar campo purchase_request em quotes (relação com purchase_requests)
    if (!quotesCol.fields.getByName('purchase_request')) {
      quotesCol.fields.add(
        new RelationField({
          name: 'purchase_request',
          type: 'relation',
          collectionId: purchasesCol.id,
          maxSelect: 1,
          cascadeDelete: false,
          required: false,
        }),
      )
      app.save(quotesCol)
    }

    // 2. Adicionar campo quote em purchase_requests (relação com quotes)
    if (!purchasesCol.fields.getByName('quote')) {
      purchasesCol.fields.add(
        new RelationField({
          name: 'quote',
          type: 'relation',
          collectionId: quotesCol.id,
          maxSelect: 1,
          cascadeDelete: false,
          required: false,
        }),
      )
      app.save(purchasesCol)
    }

    // 3. Tornar quote_items.product opcional (se estiver required) para permitir produtos da compra
    // que não necessariamente têm cadastro prévio no catálogo de produtos
    const productField = quoteItemsCol.fields.getByName('product')
    if (productField && productField.required) {
      productField.required = false
      app.save(quoteItemsCol)
    }

    // Adicionar índice para performance de busca bidirecional
    try {
      quotesCol.addIndex('idx_quotes_purchase_request', false, 'purchase_request', '')
      app.save(quotesCol)
    } catch (_) {}

    try {
      purchasesCol.addIndex('idx_pr_quote', false, 'quote', '')
      app.save(purchasesCol)
    } catch (_) {}
  },
  (app) => {
    try {
      const quotesCol = app.findCollectionByNameOrId('quotes')
      const purchasesCol = app.findCollectionByNameOrId('purchase_requests')

      const prField = quotesCol.fields.getByName('purchase_request')
      if (prField) {
        quotesCol.fields.removeByName('purchase_request')
        app.save(quotesCol)
      }

      const qField = purchasesCol.fields.getByName('quote')
      if (qField) {
        purchasesCol.fields.removeByName('quote')
        app.save(purchasesCol)
      }
    } catch (_) {}
  },
)
