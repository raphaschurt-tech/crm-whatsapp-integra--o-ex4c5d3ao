/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migração 0147 corretiva: atualiza os 4 e-mails da Jahu em erro_final para status 'pendente'
    try {
      app
        .db()
        .newQuery(
          "UPDATE nfe_email_inbox SET status = 'pendente', retry_count = 0, error_detail = '' WHERE status = 'erro_final' AND (id IN ('yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf', 'k302k30v4v454i3', '7302484f99qf5v5', 'e81f185f242m2y5', '9r4q196k0z3d2x9') OR subject LIKE '%001198484%' OR subject LIKE '%001198550%' OR subject LIKE '%001198992%' OR subject LIKE '%001199371%')",
        )
        .execute()
    } catch (err) {
      console.log('[MIGRATION-0147-UPDATE-ERR]', String(err))
    }
  },
  (app) => {
    try {
      app
        .db()
        .newQuery(
          "UPDATE nfe_email_inbox SET status = 'erro_final', retry_count = 3 WHERE status = 'pendente' AND (id IN ('yfwmromsh8t5egj', 'ueqcitnpi81v0im', 'dch60fldif0zkq4', 'w2xjfefwiidu7pf', 'k302k30v4v454i3', '7302484f99qf5v5', 'e81f185f242m2y5', '9r4q196k0z3d2x9') OR subject LIKE '%001198484%' OR subject LIKE '%001198550%' OR subject LIKE '%001198992%' OR subject LIKE '%001199371%')",
        )
        .execute()
    } catch (_) {}
  },
)
