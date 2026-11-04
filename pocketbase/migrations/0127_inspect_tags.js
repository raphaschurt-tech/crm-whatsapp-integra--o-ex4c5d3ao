/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0127: Inspecionar tags filhas de infNFe na nota 500503
    const k = '35260961136701000732550010005005031273283880'
    const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
    const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
    const xml = nfe.getString('xml_payload') || ''

    // Obter todas as tags de nível 1 dentro de infNFe
    const tags = []
    const re = /<([a-zA-Z0-9]+)[^>]*>/g
    let m
    while ((m = re.exec(xml)) !== null) {
      if (!tags.includes(m[1]) && tags.length < 30) {
        tags.push(m[1])
      }
    }
    ap.set('notes', '[TAGS:' + tags.join(',') + ']')
    app.save(ap)
  },
  (app) => {},
)
