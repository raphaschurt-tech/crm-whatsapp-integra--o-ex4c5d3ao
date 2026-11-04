/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0126: Inspecionar pag/detPag/tPag das notas 500503 e 506038
    function extractXmlTag(xml, tag) {
      if (!xml) return ''
      const regex = new RegExp(
        '<(?:[a-zA-Z0-9]+:)?' + tag + '[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?' + tag + '>',
        'i',
      )
      const match = xml.match(regex)
      return match ? match[1].trim() : ''
    }

    const KEYS = [
      '35260961136701000732550010005005031273283880', // 500503
      '35260961136701000732550010005060381548219210', // 506038
    ]

    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i]
      const nfe = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: k })
      const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:k}', { k: k })
      const xml = nfe.getString('xml_payload') || ''
      const pag = extractXmlTag(xml, 'pag')
      const detPag = extractXmlTag(pag, 'detPag')
      const tPag = extractXmlTag(detPag || pag, 'tPag')
      const vPag = extractXmlTag(detPag || pag, 'vPag')
      const dVenc = extractXmlTag(detPag || pag, 'dVenc')
      const infAdic = extractXmlTag(xml, 'infAdic')
      const infCpl = extractXmlTag(infAdic, 'infCpl')

      ap.set(
        'notes',
        '[PAG:tPag=' +
          tPag +
          '|vPag=' +
          vPag +
          '|dVenc=' +
          dVenc +
          '|cpl=' +
          (infCpl ? infCpl.slice(0, 100) : '') +
          ']',
      )
      app.save(ap)
    }
  },
  (app) => {},
)
