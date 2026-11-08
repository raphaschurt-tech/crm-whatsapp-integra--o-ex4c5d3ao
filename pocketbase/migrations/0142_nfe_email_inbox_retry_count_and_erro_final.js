/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('nfe_email_inbox')

    // Adicionar campo retry_count se não existir
    const existingRetry = collection.fields.getByName('retry_count')
    if (!existingRetry) {
      collection.fields.addAt(
        11,
        new Field({
          name: 'retry_count',
          type: 'number',
          required: false,
        }),
      )
    }

    // Atualizar campo status para aceitar 'erro_final'
    const statusField = collection.fields.getByName('status')
    if (statusField) {
      statusField.values = ['processado', 'sem_xml', 'erro', 'erro_final']
    }

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('nfe_email_inbox')
    const statusField = collection.fields.getByName('status')
    if (statusField) {
      statusField.values = ['processado', 'sem_xml', 'erro']
    }
    const retryField = collection.fields.getByName('retry_count')
    if (retryField) {
      collection.fields.removeByName('retry_count')
    }
    app.save(collection)
  },
)
