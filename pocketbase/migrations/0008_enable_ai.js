migrate(
  (app) => {
    // No-op: não sobrescrever ai_enabled no boot/deploy.
    // O controle deve permanecer exclusivamente com o usuário via painel de configurações.
    console.log('[MIGRATION-0008] Mantendo valor de ai_enabled definido pelo usuário no banco')
  },
  (app) => {
    console.log('[MIGRATION-0008-DOWN] no-op')
  },
)
