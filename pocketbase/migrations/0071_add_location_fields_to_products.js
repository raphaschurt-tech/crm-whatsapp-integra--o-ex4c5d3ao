migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('products')

    if (!col.fields.getByName('location_1')) {
      col.fields.add(
        new TextField({
          name: 'location_1',
        }),
      )
    }

    if (!col.fields.getByName('location_2')) {
      col.fields.add(
        new TextField({
          name: 'location_2',
        }),
      )
    }

    if (!col.fields.getByName('location_3')) {
      col.fields.add(
        new TextField({
          name: 'location_3',
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('products')
    const f1 = col.fields.getByName('location_1')
    if (f1) col.fields.remove(f1)
    const f2 = col.fields.getByName('location_2')
    if (f2) col.fields.remove(f2)
    const f3 = col.fields.getByName('location_3')
    if (f3) col.fields.remove(f3)
    app.save(col)
  },
)
