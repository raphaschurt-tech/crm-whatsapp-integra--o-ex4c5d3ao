migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('products')
    const priceField = col.fields.getByName('price')
    if (priceField) {
      priceField.required = false
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('products')
    const priceField = col.fields.getByName('price')
    if (priceField) {
      priceField.required = true
      app.save(col)
    }
  },
)
