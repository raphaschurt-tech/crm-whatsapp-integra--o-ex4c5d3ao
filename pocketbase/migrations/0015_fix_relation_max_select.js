migrate(
  (app) => {
    // Definir maxSelect alto nas relations de item_families e product_compositions
    const itemFamilies = app.findCollectionByNameOrId('item_families')
    const prodField = itemFamilies.fields.getByName('products')
    if (prodField) {
      prodField.maxSelect = 200
      app.save(itemFamilies)
    }

    const prodComp = app.findCollectionByNameOrId('product_compositions')
    const allowedField = prodComp.fields.getByName('allowed_products')
    if (allowedField) {
      allowedField.maxSelect = 200
      app.save(prodComp)
    }

    // Atualizar os relacionamentos para conter todos os itens
    const allSeed = [
      { fam: 'Borracha', skus: ['BOR-VED-70', 'BOR-EPDM-90'] },
      { fam: 'Capa', skus: ['CAP-ACO-01', 'CAP-TERM-02'] },
      { fam: 'Pino', skus: ['PIN-ACO-12', 'PIN-INOX-12'] },
      { fam: 'Bucha', skus: ['BUC-BRZ-20', 'BUC-PU-85A'] },
    ]

    for (const item of allSeed) {
      try {
        const f = app.findFirstRecordByData('item_families', 'name', item.fam)
        const pIds = []
        for (const sku of item.skus) {
          try {
            const p = app.findFirstRecordByData('products', 'sku', sku)
            pIds.push(p.id)
          } catch (_) {}
        }
        f.set('products', pIds)
        app.save(f)

        // Atualizar também product_compositions para o Kit Articulação
        try {
          const kit = app.findFirstRecordByData('products', 'sku', 'KIT-ART-SUSP-PRO')
          const comps = app.findRecordsByFilter(
            'product_compositions',
            `product = '${kit.id}' && family = '${f.id}'`,
            '',
            1,
            0,
          )
          if (comps && comps.length > 0) {
            comps[0].set('allowed_products', pIds)
            app.save(comps[0])
          }
        } catch (_) {}
      } catch (_) {}
    }
  },
  (app) => {},
)
