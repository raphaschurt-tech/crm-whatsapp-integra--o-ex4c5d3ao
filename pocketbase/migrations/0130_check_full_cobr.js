/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0130: Checar fechamento da tag </cobr> nas notas 500503 e 506038
    const k = '35260961136701000732550010005005031273283880'
    const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
    const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
    const xml = nfe.getString('xml_payload') || ''

    const startIdx = xml.indexOf('<cobr')
    const endIdx = xml.indexOf('</cobr>')
    let fullCobr = 'NO_FULL_COBR'
    if (startIdx !== -1 && endIdx !== -1) {
      fullCobr = xml
        .slice(startIdx, endIdx + 7)
        .replace(/</g, '[')
        .replace(/>/g, ']')
    }

    ap.set('notes', '[FULL_COBR:' + fullCobr + ']')
    app.save(ap)
  },
  (app) => {},
)
