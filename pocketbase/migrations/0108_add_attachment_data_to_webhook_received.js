migrate(
  (app) => {
    // BUG 3: persistência de anexos (AGENT-SEND-PERSIST-ERR: attachment_url >5000 chars)
    // MIGRATION ADITIVA: criar campo texto longo novo (attachment_data) na coleção webhook_received
    // SEM limite de 5000 caracteres (ou seja, max: 0 / ilimitado no TextField do PocketBase).
    // GUARD: migration puramente aditiva; nenhum delete, nenhuma alteração em campo existente.
    const collection = app.findCollectionByNameOrId('webhook_received')

    if (!collection.fields.getByName('attachment_data')) {
      collection.fields.add(
        new TextField({
          name: 'attachment_data',
          max: 0, // sem limite de caracteres
          required: false,
        }),
      )
      app.save(collection)
      console.log(
        '[MIGRATION-0108] Campo aditivo attachment_data adicionado com sucesso em webhook_received.',
      )
    }
  },
  (app) => {
    // Rollback: remove o campo aditivo attachment_data se necessário
    const collection = app.findCollectionByNameOrId('webhook_received')
    if (collection.fields.getByName('attachment_data')) {
      collection.fields.removeByName('attachment_data')
      app.save(collection)
    }
  },
)
