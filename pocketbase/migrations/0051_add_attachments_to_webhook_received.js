migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('webhook_received')

    if (!col.fields.getByName('attachment_url')) {
      col.fields.add(new TextField({ name: 'attachment_url' }))
    }
    if (!col.fields.getByName('attachment_name')) {
      col.fields.add(new TextField({ name: 'attachment_name' }))
    }
    if (!col.fields.getByName('attachment_type')) {
      col.fields.add(new TextField({ name: 'attachment_type' }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('webhook_received')

    const fUrl = col.fields.getByName('attachment_url')
    if (fUrl) col.fields.remove(fUrl)

    const fName = col.fields.getByName('attachment_name')
    if (fName) col.fields.remove(fName)

    const fType = col.fields.getByName('attachment_type')
    if (fType) col.fields.remove(fType)

    app.save(col)
  },
)
