migrate(
  (app) => {
    // BLOCO 2 — BUG DA ALLOWLIST DE FAMÍLIAS
    // Alinhar o tipo do campo allowed_families na coleção 'settings':
    // Converter de TextField para JSONField (mesmo padrão já utilizado com sucesso por family_margins)
    const settings = app.findCollectionByNameOrId('settings')

    // 1. Ler o valor atual de allowed_families se houver
    let existingAllowed = []
    try {
      const records = app.findRecordsByFilter('settings', '', '-created', 1, 0)
      if (records && records.length > 0) {
        const raw = records[0].getString('allowed_families') || ''
        if (raw.trim()) {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              existingAllowed = parsed
            }
          } catch (_) {
            existingAllowed = raw
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
          }
        }
      }
    } catch (_) {}

    // 2. Remover o campo text antigo usando removeByName e recriar como JSONField
    if (settings.fields.getByName('allowed_families')) {
      settings.fields.removeByName('allowed_families')
    }

    settings.fields.add(
      new JSONField({
        name: 'allowed_families',
        maxSize: 2000000,
      }),
    )

    app.save(settings)

    // 3. Atualizar o registro de settings com o valor existente preservado como JSON array
    try {
      const records = app.findRecordsByFilter('settings', '', '-created', 1, 0)
      if (records && records.length > 0) {
        const s = records[0]
        s.set('allowed_families', existingAllowed)
        app.save(s)
      }
    } catch (_) {}

    console.log(
      '[MIGRATION-0105] allowed_families convertido para JSONField na coleção settings com sucesso.',
    )
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings')
    if (settings.fields.getByName('allowed_families')) {
      settings.fields.removeByName('allowed_families')
      settings.fields.add(
        new TextField({
          name: 'allowed_families',
        }),
      )
      app.save(settings)
    }
  },
)
