migrate(
  (app) => {
    // Backup dos 2 registros fantasmas de settings criados em 2026-09-20:
    // 1) id: '5gylcbuoj2du8ra' (created: 2026-09-20 16:46:47.143Z)
    // 2) id: 'xzpz5x4vj316qfu' (created: 2026-09-20 16:46:58.287Z)
    // Ambos foram gerados vazios (sem credenciais Z-API nem OpenAI) e receberam JSON de sync de diagnóstico
    // no campo payment_link_template.

    const ghostIds = ['5gylcbuoj2du8ra', 'xzpz5x4vj316qfu']
    for (let i = 0; i < ghostIds.length; i++) {
      try {
        const rec = app.findRecordById('settings', ghostIds[i])
        console.log(
          '[MIGRATION-0074-CLEANUP-GHOST] Removendo registro fantasma settings:',
          ghostIds[i],
        )
        app.delete(rec)
      } catch (err) {
        console.log(
          '[MIGRATION-0074-CLEANUP-GHOST] Registro nao encontrado ou ja removido:',
          ghostIds[i],
          err.message || String(err),
        )
      }
    }

    // Garantir que o registro real ks86suaa4vn5xd4 permaneça limpo no campo payment_link_template
    try {
      const realRec = app.findRecordById('settings', 'ks86suaa4vn5xd4')
      const currentPlt = realRec.getString('payment_link_template')
      if (currentPlt && (currentPlt.startsWith('{') || currentPlt.includes('timestamp'))) {
        realRec.set('payment_link_template', '')
        app.save(realRec)
      }
    } catch (realErr) {
      console.log('[MIGRATION-0074-REAL-SETTINGS-ERR]', realErr.message || String(realErr))
    }
  },
  () => {},
)
