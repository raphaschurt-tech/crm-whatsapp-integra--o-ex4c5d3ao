migrate(
  (app) => {
    // Migration 0112: Ampliar xml_payload para 1.000.000 de caracteres
    // nas coleções nfe_email_inbox e nfe_processed

    // 1. nfe_processed
    try {
      const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
      const nfeXmlField = nfeProcessedCol.fields.getByName('xml_payload')
      if (nfeXmlField) {
        nfeXmlField.max = 1000000
        app.save(nfeProcessedCol)
      } else {
        nfeProcessedCol.fields.add(
          new TextField({
            name: 'xml_payload',
            max: 1000000,
            required: false,
          }),
        )
        app.save(nfeProcessedCol)
      }
      console.log('[MIGRATION-0112] xml_payload ampliado para max 1.000.000 em nfe_processed.')
    } catch (err) {
      console.log('[MIGRATION-0112-ERR-NFE-PROCESSED]', String(err))
    }

    // 2. nfe_email_inbox
    try {
      const inboxCol = app.findCollectionByNameOrId('nfe_email_inbox')
      const inboxXmlField = inboxCol.fields.getByName('xml_payload')
      if (inboxXmlField) {
        inboxXmlField.max = 1000000
        app.save(inboxCol)
      } else {
        inboxCol.fields.add(
          new TextField({
            name: 'xml_payload',
            max: 1000000,
            required: false,
          }),
        )
        app.save(inboxCol)
      }
      console.log(
        '[MIGRATION-0112] xml_payload adicionado/ampliado para max 1.000.000 em nfe_email_inbox.',
      )
    } catch (err) {
      console.log('[MIGRATION-0112-ERR-INBOX]', String(err))
    }
  },
  (app) => {
    // Down
    try {
      const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
      const nfeXmlField = nfeProcessedCol.fields.getByName('xml_payload')
      if (nfeXmlField) {
        nfeXmlField.max = 5000
        app.save(nfeProcessedCol)
      }
    } catch (_) {}

    try {
      const inboxCol = app.findCollectionByNameOrId('nfe_email_inbox')
      if (inboxCol.fields.getByName('xml_payload')) {
        inboxCol.fields.removeByName('xml_payload')
        app.save(inboxCol)
      }
    } catch (_) {}
  },
)
