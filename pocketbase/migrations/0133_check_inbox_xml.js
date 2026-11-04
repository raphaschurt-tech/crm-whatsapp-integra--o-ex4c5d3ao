/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0133: Inspecionar nfe_email_inbox para 500503 e 506038
    const KEYS = [
      '35260961136701000732550010005005031273283880',
      '35260961136701000732550010005060381548219210',
    ]

    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i]
      const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
      let inbox = null
      try {
        inbox = app.findFirstRecordByFilter('nfe_email_inbox', 'access_key = {:k}', { k: k })
      } catch (_) {}

      const hasInbox = !!inbox
      const inboxXml = inbox ? inbox.getString('xml_payload') || '' : ''
      ap.set('notes', '[INBOX:found=' + hasInbox + '|len=' + inboxXml.length + ']')
      app.save(ap)
    }
  },
  (app) => {},
)
