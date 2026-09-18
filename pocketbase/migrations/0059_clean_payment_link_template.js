migrate(
  (app) => {
    try {
      const setting = app.findFirstRecordByFilter('settings', "id != ''")
      if (setting) {
        // Limpar poluição residual do payment_link_template (JSON de diagnóstico/keepalive)
        setting.set('payment_link_template', '')
        app.save(setting)
      }
    } catch (err) {
      console.log('[Migration 0059] Erro ao limpar payment_link_template:', err)
    }
  },
  () => {},
)
