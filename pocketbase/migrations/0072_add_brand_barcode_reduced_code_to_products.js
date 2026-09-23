migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('products')

    if (!col.fields.getByName('brand')) {
      col.fields.add(
        new TextField({
          name: 'brand',
        }),
      )
    }

    if (!col.fields.getByName('barcode')) {
      col.fields.add(
        new TextField({
          name: 'barcode',
        }),
      )
    }

    if (!col.fields.getByName('reduced_code')) {
      col.fields.add(
        new TextField({
          name: 'reduced_code',
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('products')
    const brandField = col.fields.getByName('brand')
    if (brandField) col.fields.remove(brandField)
    const barcodeField = col.fields.getByName('barcode')
    if (barcodeField) col.fields.remove(barcodeField)
    const reducedCodeField = col.fields.getByName('reduced_code')
    if (reducedCodeField) col.fields.remove(reducedCodeField)
    app.save(col)
  },
)
