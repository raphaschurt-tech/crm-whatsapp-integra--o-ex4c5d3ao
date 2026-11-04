/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0131: Onde termina o xml_payload da nota 500503?
    const k = '35260961136701000732550010005005031273283880'
    const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
    const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
    const xml = nfe.getString('xml_payload') || ''

    ap.set(
      'notes',
      '[LEN=' + xml.length + '|END=' + xml.slice(-150).replace(/</g, '[').replace(/>/g, ']') + ']',
    )
    app.save(ap)
  },
  (app) => {},
)
