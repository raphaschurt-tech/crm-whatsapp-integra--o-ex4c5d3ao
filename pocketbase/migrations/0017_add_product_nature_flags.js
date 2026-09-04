migrate(
  (app) => {
    const products = app.findCollectionByNameOrId('products')

    // 1. Adicionar as três flags booleanas independentes
    // PocketBase v0.36: BoolField não deve ser required
    if (!products.fields.getByName('is_purchased')) {
      products.fields.add(
        new BoolField({
          name: 'is_purchased',
        }),
      )
    }

    if (!products.fields.getByName('is_produced')) {
      products.fields.add(
        new BoolField({
          name: 'is_produced',
        }),
      )
    }

    if (!products.fields.getByName('is_component')) {
      products.fields.add(
        new BoolField({
          name: 'is_component',
        }),
      )
    }

    app.save(products)

    // 2. Migrar os dados existentes:
    // - product_type = 'produzido' -> is_produced = 1
    // - Qualquer outro caso (ou comprado) -> is_purchased = 1
    // - Insumos da RPA Auto Parts ou que já estejam em item_families -> is_component = 1
    // Atualizar via SQL para rapidez e consistência
    app
      .db()
      .newQuery(`
      UPDATE products
      SET is_produced = 1, is_purchased = 0
      WHERE product_type = 'produzido'
    `)
      .execute()

    app
      .db()
      .newQuery(`
      UPDATE products
      SET is_purchased = 1, is_produced = 0
      WHERE product_type != 'produzido' OR product_type IS NULL OR product_type = ''
    `)
      .execute()

    // Para os itens de insumo já vinculados a famílias ou produtos de teste de peças (BOR-*, CAP-*, PIN-*, BUC-*),
    // marcamos is_component = 1 para que continuem funcionando imediatamente no módulo PCP
    app
      .db()
      .newQuery(`
      UPDATE products
      SET is_component = 1
      WHERE sku LIKE 'BOR-%'
         OR sku LIKE 'CAP-%'
         OR sku LIKE 'PIN-%'
         OR sku LIKE 'BUC-%'
         OR id IN (
           SELECT p.id FROM products p
           JOIN item_families f ON f.products LIKE '%' || p.id || '%'
         )
    `)
      .execute()
  },
  (app) => {
    try {
      const products = app.findCollectionByNameOrId('products')
      const p1 = products.fields.getByName('is_purchased')
      if (p1) products.fields.remove(p1)
      const p2 = products.fields.getByName('is_produced')
      if (p2) products.fields.remove(p2)
      const p3 = products.fields.getByName('is_component')
      if (p3) products.fields.remove(p3)
      app.save(products)
    } catch (_) {}
  },
)
