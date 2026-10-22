migrate(
  (app) => {
    // 1. G5 — Chave de controle: flag dfe_auto_launch (bool, default false) em settings
    const settingsCol = app.findCollectionByNameOrId('settings')
    if (!settingsCol.fields.getByName('dfe_auto_launch')) {
      // BoolField não deve ser required para permitir false / absent
      settingsCol.fields.add(new BoolField({ name: 'dfe_auto_launch' }))
      app.save(settingsCol)
    }

    // 2. Campo worker_mode em dfe_pointer_state (real | simulacao)
    const pointerCol = app.findCollectionByNameOrId('dfe_pointer_state')
    if (!pointerCol.fields.getByName('worker_mode')) {
      pointerCol.fields.add(new TextField({ name: 'worker_mode' }))
      app.save(pointerCol)
    }

    // 3. G4 — Origem accounts_payable: estender select de origin para incluir 'dfe'
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

    // 4. G6 — Idempotência de eventos: índice único em dfe_events (access_key, event_type, event_seq)
    // Limpar duplicatas prévias se existirem antes de criar o índice
    app
      .db()
      .newQuery(
        `
      DELETE FROM dfe_events WHERE id NOT IN (
        SELECT MIN(id) FROM dfe_events GROUP BY access_key, event_type, event_seq
      ) AND access_key IS NOT NULL AND access_key != ''
    `,
      )
      .execute()

    const eventsCol = app.findCollectionByNameOrId('dfe_events')
    eventsCol.addIndex('idx_dfe_events_dedupe', true, 'access_key, event_type, event_seq', '')
    app.save(eventsCol)
  },
  (app) => {
    try {
      const eventsCol = app.findCollectionByNameOrId('dfe_events')
      eventsCol.removeIndex('idx_dfe_events_dedupe')
      app.save(eventsCol)
    } catch (_) {}

    try {
      const pointerCol = app.findCollectionByNameOrId('dfe_pointer_state')
      if (pointerCol.fields.getByName('worker_mode')) {
        pointerCol.fields.removeByName('worker_mode')
        app.save(pointerCol)
      }
    } catch (_) {}

    try {
      const settingsCol = app.findCollectionByNameOrId('settings')
      if (settingsCol.fields.getByName('dfe_auto_launch')) {
        settingsCol.fields.removeByName('dfe_auto_launch')
        app.save(settingsCol)
      }
    } catch (_) {}
  },
)
