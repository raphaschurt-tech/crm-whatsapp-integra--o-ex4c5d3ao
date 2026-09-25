/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId('settings')

    if (!settings.fields.getByName('ai_payment_methods')) {
      settings.fields.add(
        new TextField({
          name: 'ai_payment_methods',
        }),
      )
    }

    if (!settings.fields.getByName('ai_auto_close_minutes')) {
      settings.fields.add(
        new NumberField({
          name: 'ai_auto_close_minutes',
          min: 0,
        }),
      )
    }

    if (!settings.fields.getByName('ai_auto_close_message')) {
      settings.fields.add(
        new TextField({
          name: 'ai_auto_close_message',
        }),
      )
    }

    app.save(settings)

    // Inicializar valores padrão na configuração existente se vazios
    try {
      const records = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
      if (records && records.length > 0) {
        const rec = records[0]
        let changed = false
        if (!rec.getString('ai_payment_methods')) {
          rec.set('ai_payment_methods', 'Pix, cartão em até 3x sem juros, link de pagamento')
          changed = true
        }
        if (
          rec.get('ai_auto_close_minutes') === null ||
          rec.get('ai_auto_close_minutes') === undefined ||
          rec.get('ai_auto_close_minutes') === 0
        ) {
          rec.set('ai_auto_close_minutes', 60)
          changed = true
        }
        if (!rec.getString('ai_auto_close_message')) {
          rec.set(
            'ai_auto_close_message',
            'Atendimento encerrado por inatividade. Se precisar de algo, me chame aqui que continuo te ajudando! 🙂',
          )
          changed = true
        }
        if (changed) {
          app.save(rec)
        }
      }
    } catch (_) {}
  },
  (app) => {
    try {
      const settings = app.findCollectionByNameOrId('settings')
      const f1 = settings.fields.getByName('ai_payment_methods')
      if (f1) settings.fields.remove(f1)
      const f2 = settings.fields.getByName('ai_auto_close_minutes')
      if (f2) settings.fields.remove(f2)
      const f3 = settings.fields.getByName('ai_auto_close_message')
      if (f3) settings.fields.remove(f3)
      app.save(settings)
    } catch (_) {}
  },
)
