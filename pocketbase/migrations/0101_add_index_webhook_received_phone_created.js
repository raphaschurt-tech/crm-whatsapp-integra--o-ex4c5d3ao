migrate(
  (app) => {
    // Bloco B - Performance da Conversa:
    // Criar índice composto em webhook_received para otimizar busca e ordenação de mensagens
    const col = app.findCollectionByNameOrId('webhook_received')
    col.addIndex('idx_webhook_received_phone_created', false, 'phone, created', '')
    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('webhook_received')
      col.removeIndex('idx_webhook_received_phone_created')
      app.save(col)
    } catch (_) {}
  },
)
