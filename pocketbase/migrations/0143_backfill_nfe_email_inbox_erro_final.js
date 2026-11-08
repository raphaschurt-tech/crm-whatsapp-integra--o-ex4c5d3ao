/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Backfill: registros existentes com status 'erro' recebem retry_count = 3 e status = 'erro_final'
    // para interromper imediatamente o loop de reprocessamento a cada minuto dos e-mails históricos.
    try {
      const errorRecords = app.findRecordsByFilter(
        'nfe_email_inbox',
        "status = 'erro'",
        '-created',
        100,
        0,
      )
      for (let i = 0; i < errorRecords.length; i++) {
        const rec = errorRecords[i]
        rec.set('retry_count', 3)
        rec.set('status', 'erro_final')
        app.save(rec)
      }
    } catch (err) {
      console.log('[MIGRATION-0143-BACKFILL-ERR]', String(err))
    }
  },
  (app) => {
    // Reverter erro_final para erro se necessário
    try {
      const finalRecords = app.findRecordsByFilter(
        'nfe_email_inbox',
        "status = 'erro_final'",
        '-created',
        100,
        0,
      )
      for (let i = 0; i < finalRecords.length; i++) {
        const rec = finalRecords[i]
        rec.set('status', 'erro')
        app.save(rec)
      }
    } catch (_) {}
  },
)
