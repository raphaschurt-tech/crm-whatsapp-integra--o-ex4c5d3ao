/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 🟡 BACKUP PRIMEIRO: Registrar estado pré-reprocessamento das 4 notas Jahu
    const targetIds = ['yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf']
    try {
      const rows = app
        .db()
        .newQuery(
          "SELECT id, subject, status, retry_count, error_detail, updated FROM nfe_email_inbox WHERE id IN ('yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf')",
        )
        .all()
      console.log('[MIGRATION-0151-PRE-BACKUP]', JSON.stringify(rows))
    } catch (bErr) {
      console.log('[MIGRATION-0151-BACKUP-WARN]', String(bErr))
    }

    // Reset idempotente dos 4 e-mails de erro_final para pendente com retry_count = 0
    try {
      app
        .db()
        .newQuery(
          "UPDATE nfe_email_inbox SET status = 'pendente', retry_count = 0, error_detail = '' WHERE id IN ('yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf')",
        )
        .execute()
      console.log('[MIGRATION-0151-RESET-DONE] 4 e-mails da Jahu resetados para pendente.')
    } catch (err) {
      console.log('[MIGRATION-0151-RESET-ERR]', String(err))
      throw err
    }
  },
  (app) => {
    try {
      app
        .db()
        .newQuery(
          "UPDATE nfe_email_inbox SET status = 'erro_final', retry_count = 3, error_detail = 'Rollback migration 0151' WHERE id IN ('yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf')",
        )
        .execute()
    } catch (_) {}
  },
)
