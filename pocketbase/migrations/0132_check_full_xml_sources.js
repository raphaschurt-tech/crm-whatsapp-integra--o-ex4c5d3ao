/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0132: Inspecionar xml_attachment_id ou dfe_history / raw_items
    const k = '35260961136701000732550010005005031273283880'
    const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
    const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })

    const attId = nfe.getString('xml_attachment_id') || ''
    let dfeHist = null
    try {
      dfeHist = app.findFirstRecordByFilter('dfe_history', 'access_key = {:k}', { k: k })
    } catch (_) {}

    const hasDfeXml = dfeHist ? (dfeHist.getString('xml_content') || '').length : 0

    ap.set(
      'notes',
      '[ATT_ID=' +
        attId +
        '|DFE_HIST=' +
        (dfeHist ? 'found' : 'none') +
        '|DFE_XML_LEN=' +
        hasDfeXml +
        ']',
    )
    app.save(ap)
  },
  (app) => {},
)
