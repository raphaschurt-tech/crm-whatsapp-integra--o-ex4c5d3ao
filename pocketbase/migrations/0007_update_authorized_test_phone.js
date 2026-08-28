migrate(
  (app) => {
    // Atualizar o campo authorized_test_phone para '5511947518805' no registro válido existente
    try {
      const validRec = app.findRecordById('settings', 'ks86suaa4vn5xd4')
      validRec.set('authorized_test_phone', '5511947518805')
      validRec.set('ai_enabled', false)
      app.save(validRec)
    } catch (_) {
      // Fallback: se o ID não for fixo ou tiver outro ID, buscar registro com credenciais
      try {
        const records = app.findRecordsByFilter(
          'settings',
          'zapi_instance_id != "" && zapi_token != ""',
          '-created',
          1,
          0,
        )
        if (records.length > 0) {
          const rec = records[0]
          rec.set('authorized_test_phone', '5511947518805')
          rec.set('ai_enabled', false)
          app.save(rec)
        }
      } catch (err) {
        console.log('Erro ao atualizar authorized_test_phone em settings:', err)
      }
    }
  },
  (app) => {
    try {
      const validRec = app.findRecordById('settings', 'ks86suaa4vn5xd4')
      validRec.set('authorized_test_phone', '5511947861439')
      app.save(validRec)
    } catch (_) {}
  },
)
