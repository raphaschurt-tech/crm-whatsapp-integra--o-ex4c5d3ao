/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0124: Gravar auditoria em notes das contas a pagar temporariamente
    function extractXmlTag(xml, tag) {
      if (!xml) return ''
      const regex = new RegExp(
        '<(?:[a-zA-Z0-9]+:)?' + tag + '[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?' + tag + '>',
        'i',
      )
      const match = xml.match(regex)
      return match ? match[1].trim() : ''
    }

    function extractAllXmlTags(xml, tag) {
      if (!xml) return []
      const regex = new RegExp(
        '<(?:[a-zA-Z0-9]+:)?' + tag + '[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?' + tag + '>',
        'gi',
      )
      const results = []
      let match
      while ((match = regex.exec(xml)) !== null) {
        results.push(match[1])
      }
      return results
    }

    const aps = app.findRecordsByFilter('accounts_payable', "origin = 'nfe'", '-created', 50, 0)
    for (let i = 0; i < aps.length; i++) {
      const ap = aps[i]
      const key = ap.getString('nfe_access_key')
      let nfeRec = null
      try {
        nfeRec = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: key })
      } catch (_) {}

      if (!nfeRec) continue

      const xml = nfeRec.getString('xml_payload') || ''
      const infNFe = extractXmlTag(xml, 'infNFe')
      const cobr = extractXmlTag(infNFe || xml, 'cobr')
      const fat = extractXmlTag(cobr || xml, 'fat')
      const fatVenc = extractXmlTag(fat, 'venc') || extractXmlTag(fat, 'dVenc')
      const dupBlocks = extractAllXmlTags(cobr || xml, 'dup')

      const dups = []
      for (let j = 0; j < dupBlocks.length; j++) {
        const d = dupBlocks[j]
        dups.push({
          nDup: extractXmlTag(d, 'nDup'),
          dVenc: extractXmlTag(d, 'dVenc'),
          vDup: extractXmlTag(d, 'vDup'),
        })
      }

      const auditTag =
        '[AUDIT_DUE:xml=' +
        (xml.length > 0 ? 'yes' : 'no') +
        '|cobr=' +
        (cobr ? 'yes' : 'no') +
        '|fatVenc=' +
        (fatVenc || 'none') +
        '|dups=' +
        JSON.stringify(dups) +
        ']'

      ap.set('notes', ap.getString('notes') + ' ' + auditTag)
      app.save(ap)
    }
  },
  (app) => {},
)
