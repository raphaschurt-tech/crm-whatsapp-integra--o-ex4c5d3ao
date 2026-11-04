/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0129: Extrair o bloco <cobr> exato das notas 500503 e 506038
    const KEYS = [
      '35260961136701000732550010005005031273283880', // 500503
      '35260961136701000732550010005060381548219210', // 506038
    ]

    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i]
      const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
      const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
      const xml = nfe.getString('xml_payload') || ''

      const idx = xml.indexOf('<cobr')
      let cobrSnippet = 'NO_COBR'
      if (idx !== -1) {
        cobrSnippet = xml
          .slice(idx, idx + 300)
          .replace(/</g, '[')
          .replace(/>/g, ']')
      }

      ap.set('notes', '[COBR_RAW:' + cobrSnippet + ']')
      app.save(ap)
    }
  },
  (app) => {},
)
