migrate(
  (app) => {
    // Reset idempotente do registro m018r348s62tq4u de processing para received
    // Seguro mesmo em banco vazio ou se o registro já não estiver em processing
    try {
      const rec = app.findRecordById('message_processing', 'm018r348s62tq4u')
      if (rec && rec.get('status') === 'processing') {
        rec.set('status', 'received')
        app.save(rec)
      }
    } catch (_) {
      // Se o registro não existir neste banco (ex: réplica/vazio), operação é no-op idempotente
    }
  },
  (app) => {
    try {
      const rec = app.findRecordById('message_processing', 'm018r348s62tq4u')
      if (rec && rec.get('status') === 'received') {
        rec.set('status', 'processing')
        app.save(rec)
      }
    } catch (_) {}
  },
)
