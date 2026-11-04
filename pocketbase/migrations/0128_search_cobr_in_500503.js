/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0128: Checar presença de cobr e pag na nota 500503
    const k = '35260961136701000732550010005005031273283880'
    const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
    const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
    const xml = nfe.getString('xml_payload') || ''

    const hasCobrTag = xml.indexOf('<cobr') !== -1
    const hasPagTag = xml.indexOf('<pag') !== -1
    const hasFatTag = xml.indexOf('<fat') !== -1
    const hasDupTag = xml.indexOf('<dup') !== -1
    const hasVencTag = xml.indexOf('Venc') !== -1

    let snippet = ''
    const idx = xml.indexOf('<total')
    if (idx !== -1) {
      snippet = xml
        .slice(idx, idx + 400)
        .replace(/</g, '[')
        .replace(/>/g, ']')
    }

    ap.set(
      'notes',
      '[SEARCH:cobr=' +
        hasCobrTag +
        '|pag=' +
        hasPagTag +
        '|fat=' +
        hasFatTag +
        '|dup=' +
        hasDupTag +
        '|venc=' +
        hasVencTag +
        '|snip=' +
        snippet.slice(0, 150) +
        ']',
    )
    app.save(ap)
  },
  (app) => {},
)
