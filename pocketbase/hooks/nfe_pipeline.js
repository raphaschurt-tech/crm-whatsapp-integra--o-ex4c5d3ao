// pocketbase/hooks/nfe_pipeline.js
// Pipeline completo de Ingestão de NF-e (PROMPT 2)
// Todas as rotas e funções encapsulam seus próprios helpers para compatibilidade total com o Goja JSVM do PocketBase.

// Rota POST do Upload Manual de NF-e (Frontend / Financeiro / Admin)
routerAdd('POST', '/backend/v1/nfe/upload', (e) => {
  function getBrasiliaIsoDate() {
    try {
      const bDate = new Date(Date.now() - 3 * 3600 * 1000)
      return bDate.toISOString().replace('Z', '-03:00')
    } catch (_) {
      return new Date().toISOString()
    }
  }

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

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

  function parseNfeXml(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
      return { valid: false, error: 'Conteúdo vazio ou inválido' }
    }

    if (
      !xmlString.includes('<nfeProc') &&
      !xmlString.includes('<NFe') &&
      !xmlString.includes('<infNFe')
    ) {
      if (
        xmlString.includes('<procEventoNFe') ||
        xmlString.includes('<retEnvEvento') ||
        xmlString.includes('<infEvento')
      ) {
        return {
          valid: false,
          isEvent: true,
          error: 'XML de evento (cancelamento, carta de correção) não é NF-e',
        }
      }
      return {
        valid: false,
        error: 'Schema inválido: não é um XML de NF-e válido (PDF/DANFE ou formato desconhecido)',
      }
    }

    const infNFeBlock = extractXmlTag(xmlString, 'infNFe')
    if (!infNFeBlock) {
      return { valid: false, error: 'Tag <infNFe> não encontrada' }
    }

    let accessKey = ''
    const idMatch =
      infNFeBlock.match(/Id\s*=\s*["']NFe([0-9]{44})["']/i) ||
      xmlString.match(/<infNFe[^>]+Id\s*=\s*["']NFe([0-9]{44})["']/i)
    if (idMatch && idMatch[1]) {
      accessKey = idMatch[1]
    } else {
      const chNFe = extractXmlTag(xmlString, 'chNFe')
      if (chNFe && cleanDigits(chNFe).length === 44) {
        accessKey = cleanDigits(chNFe)
      }
    }

    const ideBlock = extractXmlTag(infNFeBlock, 'ide')
    const nfeNumber = extractXmlTag(ideBlock, 'nNF')
    const series = extractXmlTag(ideBlock, 'serie')
    const dhEmi = extractXmlTag(ideBlock, 'dhEmi') || extractXmlTag(ideBlock, 'dEmi')

    const emitBlock = extractXmlTag(infNFeBlock, 'emit')
    const emitCnpj = cleanDigits(extractXmlTag(emitBlock, 'CNPJ'))
    const emitName = extractXmlTag(emitBlock, 'xNome')
    const emitFant = extractXmlTag(emitBlock, 'xFant')

    const destBlock = extractXmlTag(infNFeBlock, 'dest')
    const destCnpj = cleanDigits(extractXmlTag(destBlock, 'CNPJ'))
    const destName = extractXmlTag(destBlock, 'xNome')

    const protBlock = extractXmlTag(xmlString, 'protNFe')
    const cStat = extractXmlTag(protBlock || xmlString, 'cStat')
    const nProt = extractXmlTag(protBlock || xmlString, 'nProt')
    const xMotivo = extractXmlTag(protBlock || xmlString, 'xMotivo')

    const totalBlock = extractXmlTag(infNFeBlock, 'total')
    const icmsTotBlock = extractXmlTag(totalBlock, 'ICMSTot')
    const vNF = Number(extractXmlTag(icmsTotBlock, 'vNF') || 0)
    const vProd = Number(extractXmlTag(icmsTotBlock, 'vProd') || 0)

    const cobrBlock = extractXmlTag(infNFeBlock, 'cobr')
    const dupBlocks = extractAllXmlTags(cobrBlock, 'dup')
    const installments = []

    for (let i = 0; i < dupBlocks.length; i++) {
      const dup = dupBlocks[i]
      const nDup = extractXmlTag(dup, 'nDup') || String(i + 1)
      const dVenc = extractXmlTag(dup, 'dVenc')
      const vDup = Number(extractXmlTag(dup, 'vDup') || 0)
      installments.push({
        number: nDup,
        installment_number: i + 1,
        total_installments: dupBlocks.length,
        due_date: dVenc,
        amount: vDup,
      })
    }

    if (installments.length === 0 && vNF > 0) {
      installments.push({
        number: '1',
        installment_number: 1,
        total_installments: 1,
        due_date: dhEmi ? dhEmi.slice(0, 10) : getBrasiliaIsoDate().slice(0, 10),
        amount: vNF,
      })
    }

    const detBlocks = extractAllXmlTags(infNFeBlock, 'det')
    const rawItems = []

    for (let d = 0; d < detBlocks.length; d++) {
      const det = detBlocks[d]
      const prodBlock = extractXmlTag(det, 'prod')
      const cProd = extractXmlTag(prodBlock, 'cProd')
      const xProd = extractXmlTag(prodBlock, 'xProd')
      const ncm = extractXmlTag(prodBlock, 'NCM')
      const cfop = extractXmlTag(prodBlock, 'CFOP')
      const qCom = Number(
        extractXmlTag(prodBlock, 'qCom') || extractXmlTag(prodBlock, 'qTrib') || 0,
      )
      const vUnCom = Number(
        extractXmlTag(prodBlock, 'vUnCom') || extractXmlTag(prodBlock, 'vUnTrib') || 0,
      )
      const vProdItem = Number(extractXmlTag(prodBlock, 'vProd') || 0)

      const vFrete = Number(extractXmlTag(prodBlock, 'vFrete') || 0)
      const vDesc = Number(extractXmlTag(prodBlock, 'vDesc') || 0)
      const vOutro = Number(extractXmlTag(prodBlock, 'vOutro') || 0)
      const vIPI = Number(extractXmlTag(det, 'vIPI') || 0)

      const totalItemReal = vProdItem + vFrete + vOutro + vIPI - vDesc
      const unitCostReal = qCom > 0 ? totalItemReal / qCom : vUnCom

      rawItems.push({
        item_number: d + 1,
        cProd: cProd,
        xProd: xProd,
        ncm: ncm,
        cfop: cfop,
        qCom: qCom,
        vUnCom: vUnCom,
        vProd: vProdItem,
        total_item: totalItemReal,
        unit_cost: unitCostReal,
      })
    }

    return {
      valid: true,
      accessKey: accessKey,
      nfeNumber: nfeNumber,
      series: series,
      dhEmi: dhEmi,
      emitCnpj: emitCnpj,
      emitName: emitName || emitFant,
      destCnpj: destCnpj,
      destName: destName,
      cStat: cStat,
      nProt: nProt,
      xMotivo: xMotivo,
      totalAmount: vNF,
      itemsTotal: vProd,
      installments: installments,
      items: rawItems,
    }
  }

  function aggregateRepetitiveItems(items) {
    const map = {}
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const key = (item.cProd || '').trim().toUpperCase() + '||' + (item.cfop || '').trim()
      if (!map[key]) {
        map[key] = {
          cProd: item.cProd,
          xProd: item.xProd,
          ncm: item.ncm,
          cfop: item.cfop,
          qCom: item.qCom,
          total_item: item.total_item,
          unit_cost: item.unit_cost,
          vProd: item.vProd,
          occurrences: 1,
        }
      } else {
        map[key].qCom += item.qCom
        map[key].total_item += item.total_item
        map[key].vProd += item.vProd
        map[key].occurrences += 1
        if (map[key].qCom > 0) {
          map[key].unit_cost = map[key].total_item / map[key].qCom
        }
      }
    }

    const aggregated = []
    const keys = Object.keys(map)
    for (let k = 0; k < keys.length; k++) {
      aggregated.push(map[keys[k]])
    }
    return aggregated
  }

  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  const xmlContent = reqData.xml || reqData.xml_content || ''
  if (!xmlContent || typeof xmlContent !== 'string') {
    return e.json(400, {
      success: false,
      error: 'Parâmetro xml obrigatório com a string do XML da NF-e.',
    })
  }

  const authUser = e.auth
  const userId = authUser ? authUser.id : ''

  // Executar Pipeline
  let companyCnpj = ''
  let familyMargins = {}
  try {
    const s = $app.findFirstRecordByFilter('settings', "id != ''")
    if (s) {
      companyCnpj = cleanDigits(s.getString('company_cnpj') || '')
      try {
        const rawM = s.get('family_margins')
        if (typeof rawM === 'object' && rawM !== null) familyMargins = rawM
        else if (typeof rawM === 'string' && rawM.trim()) familyMargins = JSON.parse(rawM)
      } catch (_) {}
    }
  } catch (settErr) {
    console.log('[NFE-PIPELINE-SETTINGS-ERR]', String(settErr))
  }

  const parsed = parseNfeXml(xmlContent)
  if (!parsed.valid) {
    if (parsed.isEvent) {
      return e.json(200, {
        success: false,
        status: 'evento_ignorado',
        error: parsed.error,
        message: 'XML de evento recebido e logado (não é NF-e de compra).',
      })
    }
    return e.json(200, {
      success: false,
      status: 'erro_schema',
      error: parsed.error,
      message: 'Só XML de NF-e válido é aceito. PDF/DANFE sozinho deve ser enviado como XML.',
    })
  }

  const accessKey = parsed.accessKey
  if (!accessKey || accessKey.length !== 44) {
    return e.json(200, {
      success: false,
      status: 'erro_chave',
      error: 'Chave de acesso inválida ou não encontrada no XML.',
    })
  }

  // Guard 1a: Dedupe por chave de acesso (44 dígitos)
  let existingNfe = null
  try {
    existingNfe = $app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', {
      k: accessKey,
    })
  } catch (_) {}

  if (existingNfe) {
    return e.json(200, {
      success: true,
      duplicate: true,
      access_key: accessKey,
      status: existingNfe.getString('status'),
      record_id: existingNfe.id,
      message: 'Nota fiscal já processada anteriormente. Deduplicação por chave de acesso mantida.',
    })
  }

  // Fila de revisão / Exceções
  let exceptionReason = ''
  let isException = false

  // GUARDA DE CEGUEIRA (S7)
  if (!companyCnpj || companyCnpj.length !== 14) {
    isException = true
    exceptionReason =
      'GUARDA DE CEGUEIRA: CNPJ da empresa não configurado no painel de Configurações. Configure o CNPJ para autorizar o processamento.'
  }

  // S7: Destinatário
  if (!isException) {
    if (!parsed.destCnpj || parsed.destCnpj.length !== 14) {
      isException = true
      exceptionReason =
        'Destinatário sem CNPJ legível (14 dígitos) no XML. Encaminhada para fila de revisão.'
    } else if (parsed.destCnpj !== companyCnpj) {
      isException = true
      exceptionReason =
        'CNPJ do destinatário (' +
        parsed.destCnpj +
        ') não coincide com o CNPJ da empresa (' +
        companyCnpj +
        '). Nota de terceiro encaminhada para revisão.'
    }
  }

  // S8: Status autorizada
  if (!isException) {
    if (!parsed.cStat || !parsed.nProt) {
      isException = true
      exceptionReason = 'NF-e sem protocolo de autorização (<protNFe> / <nProt> ausente).'
    } else if (parsed.cStat !== '100' && parsed.cStat !== '150') {
      isException = true
      exceptionReason =
        'NF-e não autorizada (cStat=' +
        parsed.cStat +
        ' - ' +
        (parsed.xMotivo || 'Cancelada/Inutilizada/Denegada') +
        ').'
    }
  }

  // F4 (0.0.266/0.0.294): Helpers de emitente e fornecedor inlinados no callback (regra do JSVM)
  function inlineCleanDigitsPipe(value) {
    if (!value) return ''
    return String(value).replace(/\D/g, '')
  }

  function inlineCanonicalPhoneCorePipe(rawPhone) {
    if (!rawPhone) return ''
    const digits = inlineCleanDigitsPipe(rawPhone)
    if (digits.length >= 14 || digits.length < 8) return ''
    let withoutDdi = digits
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      withoutDdi = digits.slice(2)
    }
    if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
      return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
    }
    return withoutDdi
  }

  function inlineEnsureSupplierDocumentPipe(supplierRec, emitCnpj, sourceLabel) {
    if (!supplierRec || !emitCnpj) return
    try {
      const existing = $app.findRecordsByFilter(
        'customer_documents',
        'document_number = {:num}',
        '-created',
        1,
        0,
        { num: emitCnpj },
      )
      if (existing && existing.length > 0) return
      const docsCol = $app.findCollectionByNameOrId('customer_documents')
      const docRec = new Record(docsCol)
      docRec.set('customer', supplierRec.id)
      docRec.set('document_type', 'CNPJ')
      docRec.set('document_number', emitCnpj)
      docRec.set('root_cnpj', emitCnpj.slice(0, 8))
      docRec.set('label', 'Unidade (auto via NF-e' + (sourceLabel ? ' — ' + sourceLabel : '') + ')')
      docRec.set('is_primary', false)
      $app.save(docRec)
      console.log(
        '[NFE-SUPPLIER-DOC-LINKED]',
        JSON.stringify({ supplierId: supplierRec.id, document: emitCnpj }),
      )
    } catch (docErr) {
      console.log('[NFE-SUPPLIER-DOC-ERR]', String(docErr))
    }
  }

  function inlineExtractEmitDataFromXmlPipe(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') return {}

    function extractTag(src, tagName) {
      if (!src) return ''
      const re = new RegExp('<' + tagName + '[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i')
      const m = src.match(re)
      return m && m[1] ? m[1].trim() : ''
    }

    const infNFeBlock = extractTag(xmlString, 'infNFe')
    const emitBlock = extractTag(infNFeBlock || xmlString, 'emit')
    if (!emitBlock) return {}

    const cnpj = inlineCleanDigitsPipe(extractTag(emitBlock, 'CNPJ'))
    const name = extractTag(emitBlock, 'xNome')
    const fant = extractTag(emitBlock, 'xFant')
    const ie = extractTag(emitBlock, 'IE')

    const enderEmitBlock = extractTag(emitBlock, 'enderEmit')
    const phone = inlineCleanDigitsPipe(extractTag(enderEmitBlock, 'fone'))
    const xLgr = extractTag(enderEmitBlock, 'xLgr')
    const nro = extractTag(enderEmitBlock, 'nro')
    const xBairro = extractTag(enderEmitBlock, 'xBairro')
    const xMun = extractTag(enderEmitBlock, 'xMun')
    const uf = extractTag(enderEmitBlock, 'UF')
    const cep = inlineCleanDigitsPipe(extractTag(enderEmitBlock, 'CEP'))

    const addressParts = []
    if (xLgr) addressParts.push(xLgr + (nro ? ', ' + nro : ''))
    if (xBairro) addressParts.push(xBairro)
    if (xMun) addressParts.push(xMun + (uf ? ' - ' + uf : ''))
    if (cep) addressParts.push('CEP ' + cep)
    const fullAddress = addressParts.join(' - ')

    return {
      cnpj: cnpj,
      name: name || fant,
      fantasia: fant,
      ie: ie,
      phone: phone,
      xLgr: xLgr,
      nro: nro,
      xBairro: xBairro,
      xMun: xMun,
      uf: uf,
      cep: cep,
      address: fullAddress,
    }
  }

  function inlineResolveOrCreateSupplierPipe(emit, sourceChannel) {
    const emitCnpj = inlineCleanDigitsPipe(emit && emit.cnpj)
    const emitName = String((emit && emit.name) || '').trim()
    const emitPhone = inlineCleanDigitsPipe(emit && emit.phone)
    const emitEmail = String((emit && emit.email) || '').trim()
    const emitIe = String((emit && emit.ie) || '').trim()
    const emitAddress = String((emit && emit.address) || '').trim()
    const rootCnpj = emitCnpj ? emitCnpj.slice(0, 8) : ''
    const sourceLabel = String(sourceChannel || 'xml')

    let supplier = null
    let matchedBy = ''

    if (emitCnpj) {
      try {
        const found = $app.findRecordsByFilter(
          'customers',
          'cnpj = {:cnpj} && deleted = false',
          '-created',
          1,
          0,
          { cnpj: emitCnpj },
        )
        if (found && found.length > 0) {
          supplier = found[0]
          matchedBy = 'cnpj'
        }
      } catch (_) {}
    }

    if (!supplier && emitCnpj) {
      try {
        const docs = $app.findRecordsByFilter(
          'customer_documents',
          'document_number = {:num}',
          '-created',
          1,
          0,
          { num: emitCnpj },
        )
        if (docs && docs.length > 0) {
          const custId = docs[0].getString('customer')
          if (custId) {
            try {
              supplier = $app.findRecordById('customers', custId)
              if (supplier) matchedBy = 'customer_documents'
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (!supplier && rootCnpj) {
      try {
        const docs = $app.findRecordsByFilter(
          'customer_documents',
          'root_cnpj = {:root}',
          '-created',
          1,
          0,
          { root: rootCnpj },
        )
        if (docs && docs.length > 0) {
          const custId = docs[0].getString('customer')
          if (custId) {
            try {
              const cust = $app.findRecordById('customers', custId)
              if (cust && !cust.getBool('deleted')) {
                supplier = cust
                matchedBy = 'raiz_cnpj'
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (!supplier && emitPhone) {
      const core = inlineCanonicalPhoneCorePipe(emitPhone)
      if (core) {
        try {
          const found = $app.findRecordsByFilter(
            'customers',
            'phone ~ {:core} && deleted = false',
            '-created',
            10,
            0,
            { core: core },
          )
          for (let i = 0; i < found.length; i++) {
            if (inlineCanonicalPhoneCorePipe(found[i].getString('phone')) === core) {
              supplier = found[i]
              matchedBy = 'telefone'
              break
            }
          }
        } catch (_) {}
      }
    }

    if (!supplier && emitEmail) {
      try {
        const found = $app.findRecordsByFilter(
          'customers',
          'email = {:email} && deleted = false',
          '-created',
          1,
          0,
          { email: emitEmail },
        )
        if (found && found.length > 0) {
          supplier = found[0]
          matchedBy = 'email'
        }
      } catch (_) {}
    }

    if (!supplier && emitName && emitName.length >= 5) {
      try {
        const byName = $app.findRecordsByFilter(
          'customers',
          "customer_type = 'Fornecedor' && deleted = false && name ~ {:nm}",
          '-created',
          1,
          0,
          { nm: emitName },
        )
        if (byName && byName.length > 0) {
          supplier = byName[0]
          matchedBy = 'nome'
        }
      } catch (_) {}
    }

    if (supplier) {
      try {
        let changed = false
        if (!supplier.getString('cnpj') && emitCnpj) {
          supplier.set('cnpj', emitCnpj)
          changed = true
        }
        if (!supplier.getString('company') && emitName) {
          supplier.set('company', emitName)
          changed = true
        }
        if (!supplier.getString('type')) {
          supplier.set('type', 'PJ')
          changed = true
        }
        if (emitCnpj && supplier.getString('customer_type') !== 'Fornecedor') {
          supplier.set('customer_type', 'Fornecedor')
          changed = true
        }
        if (changed) $app.save(supplier)
      } catch (_) {}
      inlineEnsureSupplierDocumentPipe(supplier, emitCnpj, sourceLabel)
      return {
        supplier: supplier,
        created: false,
        matchedBy: matchedBy,
        pendingRegistration: false,
      }
    }

    const phoneToSave = emitPhone || '0000000000'

    try {
      const custCol = $app.findCollectionByNameOrId('customers')
      const newSupp = new Record(custCol)
      newSupp.set('name', emitName || 'Fornecedor CNPJ ' + emitCnpj)
      newSupp.set('company', emitName || '')
      newSupp.set('cnpj', emitCnpj)
      newSupp.set('phone', phoneToSave)
      if (emitEmail) newSupp.set('email', emitEmail)
      newSupp.set('type', 'PJ')
      newSupp.set('customer_type', 'Fornecedor')
      newSupp.set('source', 'nfe_' + sourceLabel)

      const notesParts = [
        'Fornecedor cadastrado automaticamente via ingestão de NF-e (' + sourceLabel + ').',
      ]
      if (emitIe) notesParts.push('IE: ' + emitIe)
      if (emitAddress) notesParts.push('Endereço: ' + emitAddress)
      newSupp.set('notes', notesParts.join(' | '))

      $app.save(newSupp)
      inlineEnsureSupplierDocumentPipe(newSupp, emitCnpj, sourceLabel)
      console.log(
        '[NFE-SUPPLIER-AUTO-CREATED]',
        JSON.stringify({
          supplierId: newSupp.id,
          cnpj: emitCnpj,
          nome: emitName,
          origem: sourceLabel,
          hasPhone: Boolean(emitPhone),
          horarioBrasilia: new Date(Date.now() - 3 * 3600 * 1000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19),
        }),
      )
      return { supplier: newSupp, created: true, matchedBy: '', pendingRegistration: false }
    } catch (suppErr) {
      console.log('[NFE-SUPPLIER-CREATE-ERR]', String(suppErr))
      return { supplier: null, created: false, matchedBy: '', pendingRegistration: true }
    }
  }

  // F4 (0.0.266): Auto-cadastro / Dedupe do fornecedor via XML
  const emitData = inlineExtractEmitDataFromXmlPipe(xmlContent)
  if (!emitData.cnpj && parsed.emitCnpj) emitData.cnpj = parsed.emitCnpj
  if (!emitData.name && parsed.emitName) emitData.name = parsed.emitName

  const resolvedSupplier = inlineResolveOrCreateSupplierPipe(emitData, 'pipeline')
  const supplierRec = resolvedSupplier ? resolvedSupplier.supplier : null

  // Guard 2a — CFOP (Regra Contábil Validada)
  // (1) Nota de fornecedor FABRICANTE com CFOP de venda de produção própria:
  //     - 5102 (interna) ou 6102 (interestadual)
  //     - Variantes com ST: 5405, 6403, 6405
  //     - Aceita como compra direta (junto a 1102 e 2102 históricos).
  //     O CFOP do emitente é informação de origem e NUNCA é copiado para o CFOP de entrada.
  // (2) CFOP DE ENTRADA = destino declarado por item:
  //     - Revenda: 1102 / 2102 (1403 / 2403 se com ST)
  //     - Insumo de produção: 1101 / 2101
  //     - Insumo de consumo: 1556 / 2556
  // (3) F4: Natureza lida do atributo supplier_nature do fornecedor no cadastro
  //     (valores: 'revenda' | 'insumo_producao' | 'insumo_consumo').
  //     Fallback: fornecedor sem atributo gravado -> 'classificacao_pendente'
  //     (a nota NÃO é retida; classificação fica para o lançamento).
  const ACCEPTED_ORIGIN_CFOPS = ['5102', '6102', '5405', '6403', '6405', '1102', '2102']
  const ST_CFOPS = ['5405', '6403', '6405']

  function computeSuggestedEntryCfop(originCfop, declaredDestiny) {
    const oCfop = String(originCfop || '').trim()
    const isInterstate = oCfop.startsWith('6') || oCfop.startsWith('2')
    const hasSt = ST_CFOPS.includes(oCfop)

    if (declaredDestiny === 'insumo_consumo') {
      return isInterstate ? '2556' : '1556'
    }
    if (declaredDestiny === 'insumo_producao') {
      return isInterstate ? '2101' : '1101'
    }
    if (declaredDestiny === 'revenda') {
      if (hasSt) {
        return isInterstate ? '2403' : '1403'
      }
      return isInterstate ? '2102' : '1102'
    }
    // Sem default declarado: sugestão preliminar neutra mantendo regra de ST
    if (hasSt) {
      return isInterstate ? '2403' : '1403'
    }
    return isInterstate ? '2102' : '1102'
  }

  let hasStAlert = false
  const supplierNature =
    supplierRec && supplierRec.getString('supplier_nature')
      ? supplierRec.getString('supplier_nature')
      : ''

  if (!isException) {
    let hasNonPurchaseCfop = false
    let invalidCfop = ''
    for (let c = 0; c < parsed.items.length; c++) {
      const itCfop = String(parsed.items[c].cfop || '').trim()
      if (!ACCEPTED_ORIGIN_CFOPS.includes(itCfop)) {
        hasNonPurchaseCfop = true
        invalidCfop = itCfop
        break
      }
      if (ST_CFOPS.includes(itCfop)) {
        hasStAlert = true
      }
    }
    if (hasNonPurchaseCfop) {
      isException = true
      exceptionReason =
        'CFOP não padrão para compra direta (' +
        invalidCfop +
        '). Devolução, ajuste ou transferência requer revisão manual.'
    }
  }

  // Enriquecer itens com sugestão de CFOP de entrada e destino
  if (!isException) {
    for (let c = 0; c < parsed.items.length; c++) {
      const it = parsed.items[c]
      const originCfop = String(it.cfop || '').trim()
      const itemDestiny = supplierNature || 'classificacao_pendente'
      const suggestedEntryCfop = computeSuggestedEntryCfop(originCfop, itemDestiny)
      it.cfop_origem = originCfop
      it.cfop_entrada_sugerido = suggestedEntryCfop
      it.destino_declarado = itemDestiny
      it.has_st = ST_CFOPS.includes(originCfop)
    }
  }

  // Guard 2b — consistência
  if (!isException) {
    let sumItems = 0
    for (let s = 0; s < parsed.items.length; s++) {
      sumItems += parsed.items[s].vProd
    }
    const diff = Math.abs(sumItems - parsed.itemsTotal)
    if (diff > 0.05 && parsed.itemsTotal > 0) {
      isException = true
      exceptionReason =
        'Inconsistência nos totais: soma dos itens (' +
        sumItems.toFixed(2) +
        ') difere do total de produtos da nota (' +
        parsed.itemsTotal.toFixed(2) +
        ').'
    }
  }

  // MA-a: Agregação
  const aggregatedItems = aggregateRepetitiveItems(parsed.items)

  // 2. Persistir em nfe_processed
  const nfeCol = $app.findCollectionByNameOrId('nfe_processed')
  const nfeRec = new Record(nfeCol)
  nfeRec.set('access_key', accessKey)
  nfeRec.set('nfe_number', parsed.nfeNumber || '')
  nfeRec.set('series', parsed.series || '')
  if (parsed.dhEmi) {
    nfeRec.set('issue_date', parsed.dhEmi.slice(0, 10))
  }
  nfeRec.set('supplier_cnpj', parsed.emitCnpj || '')
  nfeRec.set('supplier_name', parsed.emitName || '')
  if (supplierRec) {
    nfeRec.set('supplier', supplierRec.id)
  }
  nfeRec.set('total_amount', parsed.totalAmount || 0)
  nfeRec.set('items_count', aggregatedItems.length)
  nfeRec.set('dest_cnpj', parsed.destCnpj || '')
  nfeRec.set('c_stat', parsed.cStat || '')
  nfeRec.set('prot_nfe', parsed.nProt || '')
  // Suporte a source_channel vindo no payload (ex: 'dfe', 'manual_upload', 'whatsapp') - CF-3b
  const reqSourceChannel = reqData.source_channel || 'manual_upload'
  nfeRec.set('source_channel', reqSourceChannel)
  nfeRec.set('raw_items', aggregatedItems)
  nfeRec.set('xml_payload', xmlContent)

  if (isException) {
    nfeRec.set('status', 'erro')
    nfeRec.set('exception_reason', exceptionReason)
    nfeRec.set('matched_items_count', 0)
    nfeRec.set('pending_items_count', aggregatedItems.length)
    nfeRec.set('souis_stock_status', 'nao_aplicavel')
    $app.save(nfeRec)

    const queueCol = $app.findCollectionByNameOrId('nfe_price_queue')
    const qRec = new Record(queueCol)
    qRec.set('nfe', nfeRec.id)
    qRec.set('access_key', accessKey)
    qRec.set('supplier_code', '')
    qRec.set('description', 'Nota retida em fila de exceção: ' + exceptionReason)
    qRec.set('status', 'pendente')
    qRec.set('item_type', 'excecao')
    qRec.set('resolution_notes', exceptionReason)
    $app.save(qRec)

    return e.json(200, {
      success: false,
      status: 'fila_revisao',
      exception: true,
      reason: exceptionReason,
      access_key: accessKey,
      nfe_id: nfeRec.id,
      message: 'Nota fiscal encaminhada para a Fila de Revisão: ' + exceptionReason,
    })
  }

  // 3. Contas a Pagar (G1, G2, G3, G4, G5, G7)
  let payablesCreated = 0
  let autoLaunchBlockedReason = ''

  // G5 — Chave de controle: se source_channel === 'dfe', verificar flag dfe_auto_launch em settings
  let dfeAutoLaunchActive = false
  try {
    const stRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (stRec) {
      dfeAutoLaunchActive = stRec.getBool('dfe_auto_launch')
    }
  } catch (_) {}

  // G3 — Backlog de ensaio blindado: se a access_key consta em dfe_history com is_backlog=true → bloqueado para sempre
  let isBacklogKey = false
  try {
    const backlogRec = $app.findFirstRecordByFilter(
      'dfe_history',
      'access_key = {:k} && is_backlog = true',
      { k: accessKey },
    )
    if (backlogRec) {
      isBacklogKey = true
    }
  } catch (_) {}

  let canCreatePayables = true
  if (isBacklogKey) {
    canCreatePayables = false
    autoLaunchBlockedReason =
      'G3: Backlog de ensaio blindado permanente (is_backlog=true no dfe_history).'
    console.log(
      '[DFE-LAUNCH-BLOCKED-G3]',
      JSON.stringify({
        accessKey: accessKey,
        horarioBrasilia: getBrasiliaIsoDate(),
        reason: autoLaunchBlockedReason,
      }),
    )
  } else if (reqSourceChannel === 'dfe' && !dfeAutoLaunchActive) {
    canCreatePayables = false
    autoLaunchBlockedReason = 'G5: Lançamento automático DF-e desativado (dfe_auto_launch = false).'
    console.log(
      '[DFE-LAUNCH-BLOCKED-G5]',
      JSON.stringify({
        accessKey: accessKey,
        horarioBrasilia: getBrasiliaIsoDate(),
        sourceChannel: reqSourceChannel,
        reason: autoLaunchBlockedReason,
      }),
    )
  }

  if (canCreatePayables) {
    try {
      const apCol = $app.findCollectionByNameOrId('accounts_payable')
      let catNfeId = ''
      try {
        const catNfe = $app.findFirstRecordByFilter(
          'financial_categories',
          "name ~ 'Fornecedores' && type = 'despesa'",
        )
        if (catNfe) catNfeId = catNfe.id
      } catch (_) {}

      // Obter NSU para auditoria (G7)
      let nsuForAudit = reqData.nsu || ''
      if (!nsuForAudit) {
        try {
          const histRec = $app.findFirstRecordByFilter('dfe_history', 'access_key = {:k}', {
            k: accessKey,
          })
          if (histRec) nsuForAudit = histRec.getString('nsu') || ''
        } catch (_) {}
      }

      const apOrigin = reqSourceChannel === 'dfe' ? 'dfe' : 'nfe'
      const originLabel = reqSourceChannel === 'dfe' ? 'DFe automático' : 'NF-e de entrada'

      for (let p = 0; p < parsed.installments.length; p++) {
        const inst = parsed.installments[p]
        const apRec = new Record(apCol)
        apRec.set(
          'description',
          'NF-e ' +
            (parsed.nfeNumber ? '#' + parsed.nfeNumber : '') +
            ' - ' +
            (parsed.emitName || 'Fornecedor') +
            ' (' +
            inst.installment_number +
            '/' +
            inst.total_installments +
            ')',
        )
        if (catNfeId) apRec.set('category', catNfeId)
        if (supplierRec) apRec.set('supplier', supplierRec.id)
        apRec.set('supplier_name', parsed.emitName || '')
        apRec.set('amount', inst.amount)
        apRec.set(
          'due_date',
          inst.due_date ? inst.due_date.slice(0, 10) : getBrasiliaIsoDate().slice(0, 10),
        )
        apRec.set('status', 'pendente')
        apRec.set('origin', apOrigin)
        apRec.set('nfe_access_key', accessKey)
        apRec.set('nfe_record', nfeRec.id)
        apRec.set('installment_number', inst.installment_number)
        apRec.set('total_installments', inst.total_installments)
        apRec.set('payment_method', 'boleto')
        let apNotes =
          'Gerado automaticamente via ' +
          originLabel +
          '. Chave: ' +
          accessKey +
          (nsuForAudit ? ' | NSU: ' + nsuForAudit : '') +
          ' | Emissão: ' +
          (parsed.dhEmi || 'N/A') +
          ' | Registro: ' +
          getBrasiliaIsoDate()
        if (hasStAlert) {
          apNotes +=
            ' | ALERTA ICMS-ST: Nota com itens em Substituição Tributária (ST). Conferir destaque do ICMS-ST.'
        }
        apRec.set('notes', apNotes)
        $app.save(apRec)
        payablesCreated++

        // G7 — Auditoria: cada lançamento registra chave de acesso, NSU, data/hora Brasília e origem
        console.log(
          '[DFE-PROCESSED-LAUNCH]',
          JSON.stringify({
            accessKey: accessKey,
            nsu: nsuForAudit || 'N/A',
            horarioBrasilia: getBrasiliaIsoDate(),
            origem: apOrigin,
            origemDescricao: originLabel,
            payableId: apRec.id,
            parcela: inst.installment_number + '/' + inst.total_installments,
            valor: inst.amount,
            fornecedor: parsed.emitName,
            fornecedorCnpj: parsed.emitCnpj,
            vencimento: inst.due_date
              ? inst.due_date.slice(0, 10)
              : getBrasiliaIsoDate().slice(0, 10),
          }),
        )
      }
    } catch (apErr) {
      console.log('[NFE-PAYABLES-ERR]', String(apErr))
    }
  }

  // 4. Matching em Camadas (MA-t / MA-t-2)
  let matchedCount = 0
  let pendingCount = 0
  const queueCol = $app.findCollectionByNameOrId('nfe_price_queue')

  for (let i = 0; i < aggregatedItems.length; i++) {
    const item = aggregatedItems[i]
    const supplierCode = String(item.cProd || '').trim()
    const desc = String(item.xProd || '').trim()
    let matchedProduct = null

    // Camada 1: Aprendizado (nfe_product_mappings)
    if (parsed.emitCnpj && supplierCode) {
      try {
        const learned = $app.findRecordsByFilter(
          'nfe_product_mappings',
          'supplier_cnpj = {:cnpj} && supplier_code = {:code}',
          '-created',
          1,
          0,
          { cnpj: parsed.emitCnpj, code: supplierCode },
        )
        if (learned && learned.length > 0) {
          const prodId = learned[0].getString('product')
          if (prodId) {
            matchedProduct = $app.findRecordById('products', prodId)
            console.log(
              '[NF-MATCH]',
              JSON.stringify({
                origem: 'aprendizado_confirmado',
                fornecedorCnpj: parsed.emitCnpj,
                codigoFornecedor: supplierCode,
                skuCasado: matchedProduct.getString('sku'),
                nome: matchedProduct.getString('name'),
              }),
            )
          }
        }
      } catch (_) {}
    }

    // Camada 2: reduced_code exato
    if (!matchedProduct && supplierCode) {
      try {
        const foundByReduced = $app.findRecordsByFilter(
          'products',
          'reduced_code = {:rcode} && is_active = true',
          'created',
          5,
          0,
          { rcode: supplierCode },
        )
        if (foundByReduced && foundByReduced.length === 1) {
          matchedProduct = foundByReduced[0]
          console.log(
            '[NF-MATCH]',
            JSON.stringify({
              origem: 'reduced_code_exato',
              codigoFornecedor: supplierCode,
              skuCasado: matchedProduct.getString('sku'),
              nome: matchedProduct.getString('name'),
            }),
          )
        }
      } catch (_) {}
    }

    if (matchedProduct) {
      matchedCount++
      const sku = matchedProduct.getString('sku')
      const curProductPrice = Number(matchedProduct.get('price')) || 0
      const curProductCost = Number(matchedProduct.get('cost')) || 0
      const unitCost = Number(item.unit_cost) || 0
      const familyName = matchedProduct.getString('sou_family') || ''

      // ⑤ Gravar CUSTO REAL no produto (log [STOCK-IN])
      if (unitCost > 0) {
        matchedProduct.set('cost', unitCost)
        $app.save(matchedProduct)
        console.log(
          '[STOCK-IN]',
          JSON.stringify({
            sku: sku,
            custoAnterior: curProductCost,
            custoRealGravado: unitCost,
            nfAccessKey: accessKey,
            horarioBrasilia: getBrasiliaIsoDate(),
          }),
        )
      }

      // ⑥ Preço de Venda — S4-FINAL / S4-h / S4-i
      const marginFactor = Number(familyMargins[familyName] || familyMargins['default'] || 0)
      let suggestedPrice = 0
      if (marginFactor > 0 && unitCost > 0) {
        suggestedPrice = Number((unitCost * marginFactor).toFixed(2))
        if (suggestedPrice < unitCost) suggestedPrice = unitCost
      }

      const isSouisPriceZero = curProductPrice <= 0

      const qRec = new Record(queueCol)
      qRec.set('nfe', nfeRec.id)
      qRec.set('access_key', accessKey)
      qRec.set('product', matchedProduct.id)
      qRec.set('sku', sku)
      qRec.set('supplier_code', supplierCode)
      qRec.set('description', desc)
      qRec.set('ncm', item.ncm || '')
      qRec.set('quantity', item.qCom || 0)
      qRec.set('unit_cost', unitCost)
      qRec.set('suggested_sell_price', suggestedPrice)
      qRec.set('family', familyName)
      qRec.set('margin_factor', marginFactor)
      qRec.set(
        'price_source_payload',
        isSouisPriceZero
          ? 'SOU.IS view preco=0/vazio (elegível para lançamento de preço CRM)'
          : 'SOU.IS tem preco existente: ' + curProductPrice,
      )
      qRec.set('status', 'pendente')
      qRec.set('item_type', isSouisPriceZero ? 'preco_sugerido' : 'ajuste_preco_existente')
      qRec.set('raw_item_data', item)
      $app.save(qRec)

      console.log(
        '[PRICE-CALC]',
        JSON.stringify({
          sku: sku,
          custoReal: unitCost,
          familia: familyName,
          margemFator: marginFactor,
          precoSugerido: suggestedPrice,
          souisPriceZero: isSouisPriceZero,
          pautaId: qRec.id,
        }),
      )
    } else {
      pendingCount++
      const qRec = new Record(queueCol)
      qRec.set('nfe', nfeRec.id)
      qRec.set('access_key', accessKey)
      qRec.set('supplier_code', supplierCode)
      qRec.set('description', desc)
      qRec.set('ncm', item.ncm || '')
      qRec.set('quantity', item.qCom || 0)
      qRec.set('unit_cost', item.unit_cost || 0)
      qRec.set('suggested_sell_price', 0)
      qRec.set('status', 'pendente')
      qRec.set('item_type', 'reconciliacao_item')
      qRec.set('raw_item_data', item)
      $app.save(qRec)

      console.log(
        '[NF-UNMATCHED-QUEUED]',
        JSON.stringify({
          cProd: supplierCode,
          xProd: desc,
          fornecedorCnpj: parsed.emitCnpj,
          queueId: qRec.id,
        }),
      )
    }
  }

  nfeRec.set('matched_items_count', matchedCount)
  nfeRec.set('pending_items_count', pendingCount)
  nfeRec.set('status', pendingCount > 0 ? 'pendente_reconciliacao' : 'processada')
  nfeRec.set('souis_stock_status', 'pendente')
  if (hasStAlert) {
    const prevNotes = nfeRec.getString('notes') || ''
    const stWarning =
      '[ALERTA ICMS-ST] Nota possui itens com CFOP de Substituição Tributária (ST). Conferir destaque do ICMS-ST.'
    nfeRec.set('notes', prevNotes ? prevNotes + ' | ' + stWarning : stWarning)
  }
  $app.save(nfeRec)

  return e.json(200, {
    success: true,
    access_key: accessKey,
    nfe_number: parsed.nfeNumber,
    nfe_id: nfeRec.id,
    status: nfeRec.getString('status'),
    matched_items: matchedCount,
    pending_items: pendingCount,
    payables_count: payablesCreated,
    auto_launch_blocked_reason: autoLaunchBlockedReason || undefined,
    souis_stock_status: 'pendente',
  })
})

// Rota POST para Confirmação Humana de Matching (MA-t / MA-t-2 / Aprendizado)
routerAdd('POST', '/backend/v1/nfe/reconcile-match', (e) => {
  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  const queueItemId = reqData.queue_item_id
  const productId = reqData.product_id

  if (!queueItemId || !productId) {
    return e.json(400, { success: false, error: 'queue_item_id e product_id são obrigatórios.' })
  }

  const authUser = e.auth
  const userId = authUser ? authUser.id : ''

  try {
    const queueRec = $app.findRecordById('nfe_price_queue', queueItemId)
    const productRec = $app.findRecordById('products', productId)
    let nfeRec = null
    const nfeId = queueRec.getString('nfe')
    if (nfeId) {
      try {
        nfeRec = $app.findRecordById('nfe_processed', nfeId)
      } catch (_) {}
    }

    const supplierCnpj = nfeRec ? nfeRec.getString('supplier_cnpj') : ''
    const supplierName = nfeRec ? nfeRec.getString('supplier_name') : ''
    const supplierCode = queueRec.getString('supplier_code') || ''
    const itemDesc = queueRec.getString('description') || ''
    const unitCost = Number(queueRec.get('unit_cost')) || 0
    const sku = productRec.getString('sku')
    const productName = productRec.getString('name')

    // MA-t / MA-t-2: Gravar no aprendizado
    if (supplierCnpj && supplierCode) {
      const mapCol = $app.findCollectionByNameOrId('nfe_product_mappings')
      let existingMap = null
      try {
        const found = $app.findRecordsByFilter(
          'nfe_product_mappings',
          'supplier_cnpj = {:cnpj} && supplier_code = {:code}',
          '-created',
          1,
          0,
          { cnpj: supplierCnpj, code: supplierCode },
        )
        if (found && found.length > 0) existingMap = found[0]
      } catch (_) {}

      if (existingMap) {
        existingMap.set('product', productRec.id)
        existingMap.set('product_sku', sku)
        existingMap.set('product_name', productName)
        existingMap.set('supplier_description', itemDesc)
        if (userId) existingMap.set('confirmed_by', userId)
        $app.save(existingMap)
        console.log(
          '[NF-MATCH-LEARNING-UPDATED]',
          'Mapeamento atualizado: ' + supplierCnpj + ' / ' + supplierCode + ' -> SKU ' + sku,
        )
      } else {
        const newMap = new Record(mapCol)
        newMap.set('supplier_cnpj', supplierCnpj)
        newMap.set('supplier_name', supplierName)
        newMap.set('supplier_code', supplierCode)
        newMap.set('supplier_description', itemDesc)
        newMap.set('product', productRec.id)
        newMap.set('product_sku', sku)
        newMap.set('product_name', productName)
        if (userId) newMap.set('confirmed_by', userId)
        $app.save(newMap)
        console.log(
          '[NF-MATCH-LEARNING-CREATED]',
          'Mapeamento gravado: ' + supplierCnpj + ' / ' + supplierCode + ' -> SKU ' + sku,
        )
      }
    }

    // ⑤ Gravar CUSTO REAL no produto [STOCK-IN]
    if (unitCost > 0) {
      productRec.set('cost', unitCost)
      $app.save(productRec)
      console.log(
        '[STOCK-IN]',
        JSON.stringify({
          sku: sku,
          custoRealGravado: unitCost,
          motivo: 'Reconciliação humana confirmada',
        }),
      )
    }

    // ⑥ Calcular preço sugerido pela margem da família
    let familyMargins = {}
    try {
      const s = $app.findFirstRecordByFilter('settings', "id != ''")
      if (s) {
        const m = s.get('family_margins')
        if (typeof m === 'object' && m !== null) familyMargins = m
        else if (typeof m === 'string' && m.trim()) familyMargins = JSON.parse(m)
      }
    } catch (_) {}

    const familyName = productRec.getString('sou_family') || ''
    const marginFactor = Number(familyMargins[familyName] || familyMargins['default'] || 0)
    let suggestedPrice = 0
    if (marginFactor > 0 && unitCost > 0) {
      suggestedPrice = Number((unitCost * marginFactor).toFixed(2))
      if (suggestedPrice < unitCost) suggestedPrice = unitCost
    }

    queueRec.set('product', productRec.id)
    queueRec.set('sku', sku)
    queueRec.set('family', familyName)
    queueRec.set('margin_factor', marginFactor)
    queueRec.set('suggested_sell_price', suggestedPrice)
    queueRec.set('status', 'aplicado')
    queueRec.set('item_type', 'preco_sugerido')
    queueRec.set('resolution_notes', 'Casado com SKU ' + sku + ' pelo usuário.')
    if (userId) queueRec.set('resolved_by', userId)
    $app.save(queueRec)

    if (nfeRec) {
      const currentMatched = Number(nfeRec.get('matched_items_count')) || 0
      const currentPending = Number(nfeRec.get('pending_items_count')) || 0
      const newMatched = currentMatched + 1
      const newPending = Math.max(0, currentPending - 1)
      nfeRec.set('matched_items_count', newMatched)
      nfeRec.set('pending_items_count', newPending)
      if (newPending === 0) {
        nfeRec.set('status', 'processada')
      }
      $app.save(nfeRec)
    }

    return e.json(200, {
      success: true,
      message: 'Item reconciliado com sucesso. Aprendizado registrado e custo real atualizado.',
      sku: sku,
      suggested_price: suggestedPrice,
    })
  } catch (recErr) {
    return e.json(500, { success: false, error: recErr.message || String(recErr) })
  }
})

// Rota POST para Aprovar/Aplicar Preço da Fila no Produto (Pauta de Trabalho)
routerAdd('POST', '/backend/v1/nfe/apply-price', (e) => {
  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  const queueItemId = reqData.queue_item_id
  const approvedPrice = Number(reqData.price || 0)

  if (!queueItemId) {
    return e.json(400, { success: false, error: 'queue_item_id obrigatório.' })
  }

  try {
    const queueRec = $app.findRecordById('nfe_price_queue', queueItemId)
    const prodId = queueRec.getString('product')
    if (!prodId) {
      return e.json(400, { success: false, error: 'Item da fila não está associado a um produto.' })
    }

    const productRec = $app.findRecordById('products', prodId)
    const finalPrice =
      approvedPrice > 0 ? approvedPrice : Number(queueRec.get('suggested_sell_price')) || 0

    if (finalPrice <= 0) {
      return e.json(400, { success: false, error: 'Preço deve ser maior que zero.' })
    }

    productRec.set('price', finalPrice)
    productRec.set('price_110', finalPrice)
    productRec.set('price_130', finalPrice)
    $app.save(productRec)

    const authUser = e.auth
    const userId = authUser ? authUser.id : ''

    queueRec.set('status', 'aplicado')
    queueRec.set(
      'resolution_notes',
      'Preço R$ ' + finalPrice + ' aprovado na pauta e aplicado no produto.',
    )
    if (userId) queueRec.set('resolved_by', userId)
    $app.save(queueRec)

    console.log(
      '[PRICE-APPLIED-FROM-QUEUE]',
      'SKU ' + productRec.getString('sku') + ' preço definido para ' + finalPrice,
    )

    return e.json(200, {
      success: true,
      message: 'Preço aprovado e aplicado no produto com sucesso.',
      sku: productRec.getString('sku'),
      price: finalPrice,
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// Rota POST para F1: Marcar entrada pendente no SOU.IS como lançada
routerAdd('POST', '/backend/v1/nfe/mark-souis-stock-launched', (e) => {
  function getBrasiliaIsoDate() {
    try {
      const bDate = new Date(Date.now() - 3 * 3600 * 1000)
      return bDate.toISOString().replace('Z', '-03:00')
    } catch (_) {
      return new Date().toISOString()
    }
  }

  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  const nfeId = reqData.nfe_id
  if (!nfeId) {
    return e.json(400, { success: false, error: 'nfe_id obrigatório.' })
  }

  try {
    const nfeRec = $app.findRecordById('nfe_processed', nfeId)
    const authUser = e.auth
    const userId = authUser ? authUser.id : ''

    nfeRec.set('souis_stock_status', 'lancado')
    nfeRec.set('souis_stock_launched_at', getBrasiliaIsoDate())
    if (userId) {
      nfeRec.set('souis_stock_launched_by', userId)
    }
    $app.save(nfeRec)

    console.log(
      '[SOU.IS-STOCK-ENTRY-MARKED]',
      'NF-e ' +
        nfeRec.getString('nfe_number') +
        ' marcada como lançada no SOU.IS por ' +
        (userId || 'admin'),
    )

    return e.json(200, {
      success: true,
      message: 'Entrada de estoque no SOU.IS marcada como lançada com sucesso.',
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// F4: Rota POST para atualizar o destino declarado dos itens da NF-e e sincronizar o CFOP de entrada no contas a pagar
routerAdd('POST', '/backend/v1/nfe/update-item-destiny', (e) => {
  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  const nfeId = reqData.nfe_id
  const itemIndex =
    typeof reqData.item_index === 'number' ? reqData.item_index : parseInt(reqData.item_index, 10)
  const newDestiny = String(reqData.destino_declarado || '').trim()

  if (!nfeId) {
    return e.json(400, { success: false, error: 'nfe_id obrigatório.' })
  }

  const validDestinies = ['revenda', 'insumo_producao', 'insumo_consumo']
  if (!validDestinies.includes(newDestiny)) {
    return e.json(400, {
      success: false,
      error:
        'destino_declarado inválido. Valores permitidos: revenda, insumo_producao, insumo_consumo.',
    })
  }

  function computeEntryCfop(originCfop, declaredDestiny) {
    const oCfop = String(originCfop || '').trim()
    const isInterstate = oCfop.startsWith('6') || oCfop.startsWith('2')
    const stCfops = ['5401', '5403', '5405', '6401', '6403', '6404']
    const hasSt = stCfops.includes(oCfop)

    if (declaredDestiny === 'insumo_consumo') {
      return isInterstate ? '2556' : '1556'
    }
    if (declaredDestiny === 'insumo_producao') {
      return isInterstate ? '2101' : '1101'
    }
    if (declaredDestiny === 'revenda') {
      if (hasSt) {
        return isInterstate ? '2403' : '1403'
      }
      return isInterstate ? '2102' : '1102'
    }
    if (hasSt) {
      return isInterstate ? '2403' : '1403'
    }
    return isInterstate ? '2102' : '1102'
  }

  try {
    const nfeRec = $app.findRecordById('nfe_processed', nfeId)

    // Decodificar raw_items
    let rawItems = []
    try {
      const rawField = nfeRec.get('raw_items')
      if (Array.isArray(rawField)) {
        if (rawField.length > 0 && typeof rawField[0] === 'number') {
          // Byte array
          const str = String.fromCharCode.apply(null, rawField)
          rawItems = JSON.parse(str)
        } else {
          rawItems = rawField
        }
      } else if (typeof rawField === 'string' && rawField.trim()) {
        rawItems = JSON.parse(rawField)
      }
    } catch (parseErr) {
      console.log('[UPDATE-ITEM-DESTINY] Erro ao parsear raw_items:', parseErr)
      rawItems = []
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return e.json(404, { success: false, error: 'raw_items não encontrado para esta NF-e.' })
    }

    if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= rawItems.length) {
      return e.json(400, {
        success: false,
        error: 'item_index fora do intervalo válido de itens da NF-e.',
      })
    }

    const targetItem = rawItems[itemIndex]
    // Preservar cfop_origem (SPED)
    const originCfop = targetItem.cfop_origem || targetItem.cfop || ''
    if (!targetItem.cfop_origem) {
      targetItem.cfop_origem = originCfop
    }

    const newCfopEntrada = computeEntryCfop(originCfop, newDestiny)
    targetItem.destino_declarado = newDestiny
    targetItem.cfop_entrada_sugerido = newCfopEntrada

    // Salvar raw_items atualizado no nfe_processed
    nfeRec.set('raw_items', JSON.stringify(rawItems))

    // Se for o primeiro item ou se a nota possui CFOP predominante, atualizar também cfop_entrada_sugerido na nota
    if (itemIndex === 0 || !nfeRec.getString('cfop_entrada_sugerido')) {
      nfeRec.set('cfop_entrada_sugerido', newCfopEntrada)
    }
    $app.save(nfeRec)

    // Atualizar contas a pagar vinculadas a esta NF-e
    let payablesUpdated = 0
    try {
      const payables = $app.findRecordsByFilter(
        'accounts_payable',
        'nfe_record = {:id} || nfe_access_key = {:key}',
        '-created',
        50,
        0,
        { id: nfeId, key: nfeRec.getString('access_key') },
      )

      for (let p = 0; p < payables.length; p++) {
        const ap = payables[p]
        let currentNotes = ap.getString('notes') || ''
        const cfopTag = ' | CFOP Entrada: ' + newCfopEntrada + ' (' + newDestiny + ')'

        // Substituir ou anexar CFOP Entrada nas notas
        if (currentNotes.indexOf(' | CFOP Entrada: ') !== -1) {
          currentNotes = currentNotes.replace(/\s*\|\s*CFOP Entrada:[^|]+/g, cfopTag)
        } else {
          currentNotes += cfopTag
        }
        ap.set('notes', currentNotes)
        $app.save(ap)
        payablesUpdated++
      }
    } catch (apErr) {
      console.log('[UPDATE-ITEM-DESTINY] Aviso ao sincronizar accounts_payable:', apErr)
    }

    console.log(
      '[UPDATE-ITEM-DESTINY]',
      'NF-e ' +
        nfeRec.getString('nfe_number') +
        ' item #' +
        itemIndex +
        ' destino: ' +
        newDestiny +
        ' -> CFOP: ' +
        newCfopEntrada +
        ' (' +
        payablesUpdated +
        ' contas a pagar sincronizadas)',
    )

    return e.json(200, {
      success: true,
      message: 'Destino do item atualizado com sucesso.',
      cfop_entrada: newCfopEntrada,
      destino_declarado: newDestiny,
      payables_updated: payablesUpdated,
      raw_items: rawItems,
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})
