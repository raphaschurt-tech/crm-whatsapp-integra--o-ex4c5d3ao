migrate(
  (app) => {
    // Reset idempotente dos registros djguzidnr58j5es, fqy2ti5xma6kdax e hrc89xs06gsf3pj
    // de processing para received.
    // Seguro mesmo em banco vazio ou se o registro já não estiver em processing.
    const targetIds = ['djguzidnr58j5es', 'fqy2ti5xma6kdax', 'hrc89xs06gsf3pj']

    for (let i = 0; i < targetIds.length; i++) {
      const id = targetIds[i]
      try {
        const rec = app.findRecordById('message_processing', id)
        if (rec && rec.get('status') === 'processing') {
          rec.set('status', 'received')
          app.save(rec)
        }
      } catch (_) {
        // Se o registro não existir neste banco, no-op idempotente
      }
    }
  },
  (app) => {
    const targetIds = ['djguzidnr58j5es', 'fqy2ti5xma6kdax', 'hrc89xs06gsf3pj']

    for (let i = 0; i < targetIds.length; i++) {
      const id = targetIds[i]
      try {
        const rec = app.findRecordById('message_processing', id)
        if (rec && rec.get('status') === 'received') {
          rec.set('status', 'processing')
          app.save(rec)
        }
      } catch (_) {}
    }
  },
)
