/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0123: Gravar inspeção em settings temporariamente
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

    const TARGET_KEYS = [
      '35261061136701000147550010011955081731581098',
      '35261061136701000147550010011970241843930987',
      '35261059417469000173550010000329431406428669',
      '35260961136701000732550010005005031273283880',
      '35260961136701000732550010005013691913994109',
      '35260961136701000732550010005024981994937196',
      '35260961136701000732550010005039351330899154',
      '35260961136701000732550010005048201698057487',
      '35260961136701000732550010005060381548219210',
      '35261061136701000732550010005069041294114447',
      '35261062538228000197550010000561841438996935',
    ]

    const inspection = []

    for (let i = 0; i < TARGET_KEYS.length; i++) {
      const key = TARGET_KEYS[i]
      let nfeRec = null
      try {
        nfeRec = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:key}', { key: key })
      } catch (_) {}

      if (!nfeRec) {
        inspection.push({ key: key, found: false })
        continue
      }

      const xml = nfeRec.getString('xml_payload') || ''
      const infNFe = extractXmlTag(xml, 'infNFe')
      const ide = extractXmlTag(infNFe || xml, 'ide')
      const dhEmi = extractXmlTag(ide, 'dhEmi') || extractXmlTag(ide, 'dEmi')
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

      inspection.push({
        key: key,
        nfe_number: nfeRec.getString('nfe_number'),
        supplier: nfeRec.getString('supplier_name'),
        total_amount: nfeRec.get('total_amount'),
        issue_date: nfeRec.getString('issue_date') || dhEmi,
        hasXml: xml.length > 0,
        hasCobr: !!cobr,
        fatVenc: fatVenc,
        dups: dups,
      })
    }

    try {
      const sett = app.findFirstRecordByFilter('settings', "id != ''")
      if (sett) {
        sett.set('system_status', JSON.stringify(inspection))
        app.save(sett)
      }
    } catch (e) {
      console.log('[MIGRATION-0123-ERR]', e.message || String(e))
    }
  },
  (app) => {},
)
