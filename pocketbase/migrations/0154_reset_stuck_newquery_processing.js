migrate(
  (app) => {
    // Marca como failed os registros 1r7dgg3uekj3pnb e s3ysseb4xhgeu7h,
    // presos em 'processing' porque a busca por newQuery travava o JSVM
    // em silêncio (0.0.302). Idempotente: só altera quem está em processing.
    const targetIds = ['1r7dgg3uekj3pnb', 's3ysseb4xhgeu7h']

    for (let i = 0; i < targetIds.length; i++) {
      const id = targetIds[i]
      try {
        const rec = app.findRecordById('message_processing', id)
        if (rec && rec.get('status') === 'processing') {
          rec.set('status', 'failed')
          rec.set('errorMessage', 'worker travado na newQuery (0.0.302)')
          app.save(rec)
        }
      } catch (_) {
        // Registro não existe neste banco: no-op idempotente
      }
    }
  },
  (app) => {
    const targetIds = ['1r7dgg3uekj3pnb', 's3ysseb4xhgeu7h']
    for (let i = 0; i < targetIds.length; i++) {
      try {
        const rec = app.findRecordById('message_processing', targetIds[i])
        if (
          rec &&
          rec.get('status') === 'failed' &&
          rec.get('errorMessage') === 'worker travado na newQuery (0.0.302)'
        ) {
          rec.set('status', 'processing')
          rec.set('errorMessage', '')
          app.save(rec)
        }
      } catch (_) {}
    }
  },
)
