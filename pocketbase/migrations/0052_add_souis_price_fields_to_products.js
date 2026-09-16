migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('products')

    // Campo para armazenar o preço alternativo (tabela 110%)
    if (!col.fields.getByName('price_110')) {
      col.fields.add(
        new NumberField({
          name: 'price_110',
          min: 0,
        }),
      )
    }

    // Campo para armazenar o preço da tabela 130% de forma explícita (além de price/cost)
    if (!col.fields.getByName('price_130')) {
      col.fields.add(
        new NumberField({
          name: 'price_130',
          min: 0,
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('products')
    const f110 = col.fields.getByName('price_110')
    if (f110) col.fields.remove(f110)
    const f130 = col.fields.getByName('price_130')
    if (f130) col.fields.remove(f130)
    app.save(col)
  },
)
