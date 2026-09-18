migrate(
  (app) => {
    const settingsCol = app.findCollectionByNameOrId('settings')

    // 1. Garantir campo stock_api_token na collection settings
    if (!settingsCol.fields.getByName('stock_api_token')) {
      settingsCol.fields.add(
        new TextField({
          name: 'stock_api_token',
        }),
      )
      app.save(settingsCol)
    }

    // 2. Limpar settings.stock_api_url e salvar o token da ponte SOU.IS
    try {
      const setting = app.findFirstRecordByFilter('settings', "id != ''")
      if (setting) {
        setting.set('stock_api_url', 'https://bridge-souis.onrender.com')
        setting.set('stock_api_token', 'souis-2025-bR7xKm92QpLw4Tz8')
        // Limpar também payment_link_template se estiver com JSON residual
        const plt = setting.getString('payment_link_template')
        if (plt && plt.includes('SOIS_BRIDGE_URL ausente')) {
          setting.set('payment_link_template', '')
        }
        app.save(setting)
      }
    } catch (e) {
      console.log('[Migration 0058] Erro ao atualizar settings:', e)
    }
  },
  (app) => {
    try {
      const settingsCol = app.findCollectionByNameOrId('settings')
      const tokenField = settingsCol.fields.getByName('stock_api_token')
      if (tokenField) {
        settingsCol.fields.removeByName('stock_api_token')
        app.save(settingsCol)
      }
    } catch (_) {}
  },
)
