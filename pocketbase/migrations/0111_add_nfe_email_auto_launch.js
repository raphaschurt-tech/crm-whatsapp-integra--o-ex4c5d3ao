migrate(
  (app) => {
    // 1. Chave de controle: flag nfe_email_auto_launch (bool, default true) em settings
    const settingsCol = app.findCollectionByNameOrId('settings')
    if (!settingsCol.fields.getByName('nfe_email_auto_launch')) {
      // BoolField não deve ser required para permitir false / absent
      settingsCol.fields.add(new BoolField({ name: 'nfe_email_auto_launch' }))
      app.save(settingsCol)
    }

    // 2. Definir valor default LIGADO (true) no registro de settings existente (ou criar se vazio)
    try {
      const records = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
      if (records && records.length > 0) {
        const s = records[0]
        s.set('nfe_email_auto_launch', true)
        app.save(s)
      }
    } catch (err) {
      console.log(
        '[MIGRATION-0111-WARN] Não foi possível atualizar registro settings:',
        String(err),
      )
    }

    // 3. Estender select de origin em accounts_payable para incluir 'email' se ainda não existir
    try {
      const apCol = app.findCollectionByNameOrId('accounts_payable')
      const originField = apCol.fields.getByName('origin')
      if (originField) {
        apCol.fields.removeByName('origin')
        apCol.fields.add(
          new SelectField({
            name: 'origin',
            values: ['manual', 'nfe', 'recorrente', 'dfe', 'email'],
            maxSelect: 1,
          }),
        )
        app.save(apCol)
      }
    } catch (apErr) {
      console.log(
        '[MIGRATION-0111-WARN] Erro ao atualizar origin de accounts_payable:',
        String(apErr),
      )
    }
  },
  (app) => {
    try {
      const settingsCol = app.findCollectionByNameOrId('settings')
      if (settingsCol.fields.getByName('nfe_email_auto_launch')) {
        settingsCol.fields.removeByName('nfe_email_auto_launch')
        app.save(settingsCol)
      }
    } catch (_) {}

    try {
      const apCol = app.findCollectionByNameOrId('accounts_payable')
      const originField = apCol.fields.getByName('origin')
      if (originField) {
        apCol.fields.removeByName('origin')
        apCol.fields.add(
          new SelectField({
            name: 'origin',
            values: ['manual', 'nfe', 'recorrente', 'dfe'],
            maxSelect: 1,
          }),
        )
        app.save(apCol)
      }
    } catch (_) {}
  },
)
