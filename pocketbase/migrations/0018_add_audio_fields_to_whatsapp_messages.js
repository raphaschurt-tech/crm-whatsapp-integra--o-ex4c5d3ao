migrate(
  (app) => {
    // 1. Adicionar campo is_audio e audio_url em message_processing
    try {
      const msgCol = app.findCollectionByNameOrId('message_processing')
      if (!msgCol.fields.getByName('is_audio')) {
        msgCol.fields.add(
          new BoolField({
            name: 'is_audio',
          }),
        )
      }
      if (!msgCol.fields.getByName('audio_url')) {
        msgCol.fields.add(
          new TextField({
            name: 'audio_url',
          }),
        )
      }
      app.save(msgCol)
    } catch (e) {
      console.log('[MIGRATION-0018-MSG-PROC-ERR]', e.message || String(e))
    }

    // 2. Adicionar campo is_audio em webhook_received
    try {
      const whCol = app.findCollectionByNameOrId('webhook_received')
      if (!whCol.fields.getByName('is_audio')) {
        whCol.fields.add(
          new BoolField({
            name: 'is_audio',
          }),
        )
      }
      if (!whCol.fields.getByName('audio_url')) {
        whCol.fields.add(
          new TextField({
            name: 'audio_url',
          }),
        )
      }
      app.save(whCol)
    } catch (e) {
      console.log('[MIGRATION-0018-WH-ERR]', e.message || String(e))
    }
  },
  (app) => {
    try {
      const msgCol = app.findCollectionByNameOrId('message_processing')
      const f1 = msgCol.fields.getByName('is_audio')
      if (f1) msgCol.fields.remove(f1)
      const f2 = msgCol.fields.getByName('audio_url')
      if (f2) msgCol.fields.remove(f2)
      app.save(msgCol)
    } catch (_) {}

    try {
      const whCol = app.findCollectionByNameOrId('webhook_received')
      const f1 = whCol.fields.getByName('is_audio')
      if (f1) whCol.fields.remove(f1)
      const f2 = whCol.fields.getByName('audio_url')
      if (f2) whCol.fields.remove(f2)
      app.save(whCol)
    } catch (_) {}
  },
)
