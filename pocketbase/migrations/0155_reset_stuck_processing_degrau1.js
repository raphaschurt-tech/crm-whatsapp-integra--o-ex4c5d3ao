migrate(
  (app) => {
    // Degrau 1: Reseta registros presos em 'processing' para 'failed'
    // Causa: busca de produtos travava o worker JSVM em silêncio (newQuery no 0.0.302)
    const targetIds = ['1r7dgg3uekj3pnb', 's3ysseb4xhgeu7h', '30kksfs8sjwtchs']

    for (let i = 0; i < targetIds.length; i++) {
      const id = targetIds[i]
      try {
        const rec = app.findRecordById('message_processing', id)
        if (rec && rec.get('status') === 'processing') {
          rec.set('status', 'failed')
          rec.set('errorMessage', 'busca travada na newQuery (0.0.302) — desligada no degrau 1')
          app.save(rec)
        } else if (rec && rec.get('status') === 'failed') {
          // Atualiza errorMessage para a mensagem exata do degrau 1
          rec.set('errorMessage', 'busca travada na newQuery (0.0.302) — desligada no degrau 1')
          app.save(rec)
        }
      } catch (_) {
        // Registro não existe neste banco: no-op idempotente
      }
    }

    // Varre outros registros presos em processing
    try {
      const stuckRecords = app.findRecordsByFilter(
        'message_processing',
        "status = 'processing'",
        '-created',
        50,
      )
      if (stuckRecords && stuckRecords.length > 0) {
        for (let j = 0; j < stuckRecords.length; j++) {
          const sRec = stuckRecords[j]
          sRec.set('status', 'failed')
          sRec.set('errorMessage', 'busca travada na newQuery (0.0.302) — desligada no degrau 1')
          app.save(sRec)
        }
      }
    } catch (_) {}
  },
  (app) => {
    // Down migration: no-op
  },
)
