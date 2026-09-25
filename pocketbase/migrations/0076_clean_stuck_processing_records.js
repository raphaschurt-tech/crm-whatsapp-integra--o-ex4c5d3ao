/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Limpar os registros que ficaram presos no status 'processing' devido ao crash
    // para que novas tentativas ou testes com essas mensagens não falhem por idempotência falsa.
    try {
      const stuckRecords = app.findRecordsByFilter(
        'message_processing',
        "status = 'processing' && replySent = false",
        '-created',
        50,
        0,
      )
      if (stuckRecords && stuckRecords.length > 0) {
        for (let i = 0; i < stuckRecords.length; i++) {
          const rec = stuckRecords[i]
          rec.set('status', 'failed')
          rec.set('errorMessage', 'Reset após crash de checkAndRunAutoCloseHumanChatsGlobal')
          app.save(rec)
        }
      }
    } catch (err) {
      console.log('[Migration 0076] Erro ao resetar registros presos:', err)
    }
  },
  (app) => {
    // Reversão não é necessária (registros continuam como failed)
  },
)
