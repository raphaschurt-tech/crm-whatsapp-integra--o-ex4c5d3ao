migrate(
  (app) => {
    const settings = app.findRecordById('settings', 'ks86suaa4vn5xd4')
    settings.set('ai_enabled', true)
    app.save(settings)
    console.log('[MIGRATION-0008] ai_enabled ativado para a configuração principal')
  },
  (app) => {
    const settings = app.findRecordById('settings', 'ks86suaa4vn5xd4')
    settings.set('ai_enabled', false)
    app.save(settings)
    console.log('[MIGRATION-0008-DOWN] ai_enabled restaurado para false')
  },
)
