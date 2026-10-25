// pocketbase/hooks/nfe_email_inbox.js
// Pipeline de Entrada de NF-e por Email (Gmail da empresa, modo OWNER)
// Cron periódico a cada 15 minutos e Rota POST manual (/backend/v1/nfe/email-inbox/sync)
// Regra permanente: Todos os registros e logs com horário de Brasília (UTC-3).
// Regra de Lançamento:
// - Flag nfe_email_auto_launch em settings controla o canal email (default = true).
// - Quando ligada e passar em TODAS as validações: lança direto em Contas a Pagar (origem: 'email', 1 lançamento por parcela com vencimento de cada uma ou 1 na emissão se sem duplicatas) e alimenta pauta de preços/reconciliação de produtos.
// - Quando desligada OU falhar em qualquer validação: encaminha para a Fila de Revisão com o motivo da exceção.
// Todos os helpers e lógica são estritamente INLINE dentro de cada callback para compatibilidade com o VM pool do PocketBase.

// 1. Cron Add: Executa a cada 15 minutos (temporariamente * * * * * para executar no próximo minuto)
cronAdd('nfe-email-inbox-poller', '* * * * *', () => {
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
    const enderEmitBlock = extractXmlTag(emitBlock, 'enderEmit')
    const emitPhone = cleanDigits(extractXmlTag(enderEmitBlock, 'fone'))

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
      emitPhone: emitPhone,
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

  function ingestNfeXml(xmlContent, meta) {
    const metaObj = meta || {}
    const senderEmail = (metaObj.sender_email || '').trim().toLowerCase()
    const senderName = (metaObj.sender_name || '').trim()
    const subject = (metaObj.subject || '').trim()
    const emailDate = (metaObj.email_date || '').trim()
    const gmailMsgId = (metaObj.gmail_message_id || '').trim()
    const brasiliaNow = getBrasiliaIsoDate()

    const parsed = parseNfeXml(xmlContent)
    if (!parsed.valid) {
      console.log(
        '[NFE-EMAIL-INVALID-XML]',
        JSON.stringify({
          horarioBrasilia: brasiliaNow,
          messageId: gmailMsgId,
          sender: senderEmail,
          error: parsed.error,
          isEvent: Boolean(parsed.isEvent),
        }),
      )
      return {
        success: false,
        status: parsed.isEvent ? 'evento_ignorado' : 'erro_schema',
        error: parsed.error,
      }
    }

    const accessKey = parsed.accessKey
    if (!accessKey || accessKey.length !== 44) {
      return {
        success: false,
        status: 'erro_chave',
        error: 'Chave de acesso com tamanho diferente de 44 dígitos.',
      }
    }

    // Camada Anti-duplicação 1: Dedupe prévia por chave de acesso 44 dígitos
    let existingNfe = null
    try {
      existingNfe = $app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', {
        k: accessKey,
      })
    } catch (_) {}

    if (existingNfe) {
      console.log(
        '[NFE-EMAIL-DEDUPLICATED]',
        JSON.stringify({
          horarioBrasilia: brasiliaNow,
          accessKey: accessKey,
          messageId: gmailMsgId,
          existingId: existingNfe.id,
        }),
      )
      return {
        success: true,
        duplicate: true,
        access_key: accessKey,
        status: existingNfe.getString('status'),
        record_id: existingNfe.id,
        message: 'Nota fiscal já processada anteriormente no CRM.',
      }
    }

    // Identificação do fornecedor / remetente
    let senderKnown = false
    let supplierRec = null

    if (parsed.emitCnpj) {
      try {
        const foundByCnpj = $app.findRecordsByFilter(
          'customers',
          'cnpj = {:cnpj} && deleted = false',
          '-created',
          1,
          0,
          { cnpj: parsed.emitCnpj },
        )
        if (foundByCnpj && foundByCnpj.length > 0) {
          supplierRec = foundByCnpj[0]
          senderKnown = true
        }
      } catch (_) {}
    }

    if (!senderKnown && senderEmail) {
      try {
        const foundByEmail = $app.findRecordsByFilter(
          'customers',
          'email = {:email} && deleted = false',
          '-created',
          1,
          0,
          { email: senderEmail },
        )
        if (foundByEmail && foundByEmail.length > 0) {
          if (!supplierRec) supplierRec = foundByEmail[0]
          senderKnown = true
        }
      } catch (_) {}
    }

    let supplierPendingRegistration = false
    if (!supplierRec && parsed.emitCnpj) {
      if (parsed.emitPhone) {
        try {
          const custCol = $app.findCollectionByNameOrId('customers')
          const newSupp = new Record(custCol)
          newSupp.set('name', parsed.emitName || 'Fornecedor CNPJ ' + parsed.emitCnpj)
          newSupp.set('company', parsed.emitName || '')
          newSupp.set('cnpj', parsed.emitCnpj)
          newSupp.set('phone', parsed.emitPhone)
          newSupp.set('email', senderEmail || '')
          newSupp.set('type', 'PJ')
          newSupp.set('customer_type', 'Fornecedor')
          newSupp.set('source', 'nfe_email_inbox')
          newSupp.set('notes', 'Cadastrado automaticamente via entrada de NF-e por Email.')
          $app.save(newSupp)
          supplierRec = newSupp
        } catch (suppErr) {
          console.log('[NFE-EMAIL-SUPPLIER-CREATE-ERR]', String(suppErr))
          supplierPendingRegistration = true
        }
      } else {
        supplierPendingRegistration = true
      }
    }

    // Leitura das configurações (CNPJ da empresa, flag de auto launch do email, margens de famílias)
    let companyCnpj = ''
    let nfeEmailAutoLaunchActive = true // Default LIGADO para o canal email
    let familyMargins = {}
    try {
      const s = $app.findFirstRecordByFilter('settings', "id != ''")
      if (s) {
        companyCnpj = cleanDigits(s.getString('company_cnpj') || '')
        // Se a coluna existir, respeita o valor dela; se não definida, default é true
        const valFlag = s.get('nfe_email_auto_launch')
        if (typeof valFlag === 'boolean') {
          nfeEmailAutoLaunchActive = valFlag
        }
        try {
          const rawM = s.get('family_margins')
          if (typeof rawM === 'object' && rawM !== null) familyMargins = rawM
          else if (typeof rawM === 'string' && rawM.trim()) familyMargins = JSON.parse(rawM)
        } catch (_) {}
      }
    } catch (_) {}

    // Validações fiscais rígidas
    const guardReasons = []

    // 1. Guarda de cegueira e destinatário = CNPJ da empresa
    if (!companyCnpj || companyCnpj.length !== 14) {
      guardReasons.push(
        'GUARDA DE CEGUEIRA: CNPJ da empresa não configurado no painel de Configurações.',
      )
    } else if (!parsed.destCnpj || parsed.destCnpj !== companyCnpj) {
      guardReasons.push(
        'Destinatário (' +
          (parsed.destCnpj || 'vazio') +
          ') não coincide com o CNPJ da empresa (' +
          companyCnpj +
          '). Nota de terceiro encaminhada para revisão.',
      )
    }

    // 2. Remetente conhecido do CRM (se desconhecido, segue para revisão com alerta)
    if (!senderKnown) {
      guardReasons.push(
        'Remetente desconhecido: CNPJ (' +
          (parsed.emitCnpj || 'vazio') +
          ') ou email (' +
          (senderEmail || 'vazio') +
          ') não consta previamente como fornecedor/contato conhecido do CRM.',
      )
    }

    // 2.1 Fornecedor pendente de cadastro (sem telefone no XML para cadastro automático)
    if (supplierPendingRegistration) {
      guardReasons.push(
        'Fornecedor pendente de cadastro: XML sem telefone do emitente (<enderEmit><fone>) para cadastro automático no CRM.',
      )
    }

    // 3. Autorizada cStat 100 ou 150 com protocolo
    if (!parsed.cStat || !parsed.nProt) {
      guardReasons.push('NF-e sem protocolo de autorização (<protNFe> / <nProt> ausente).')
    } else if (parsed.cStat !== '100' && parsed.cStat !== '150') {
      guardReasons.push(
        'NF-e não autorizada (cStat=' +
          parsed.cStat +
          ' - ' +
          (parsed.xMotivo || 'Cancelada/Inutilizada/Denegada') +
          ').',
      )
    }

    // 4. CFOP de compra direta (1102 ou 2102)
    for (let c = 0; c < parsed.items.length; c++) {
      const itCfop = String(parsed.items[c].cfop || '').trim()
      if (itCfop !== '1102' && itCfop !== '2102') {
        guardReasons.push(
          'CFOP não padrão para compra direta (' +
            itCfop +
            '). Devolução, ajuste ou transferência requer revisão manual.',
        )
        break
      }
    }

    // 5. Totais batendo
    let sumItems = 0
    for (let s = 0; s < parsed.items.length; s++) {
      sumItems += parsed.items[s].vProd
    }
    const diff = Math.abs(sumItems - parsed.itemsTotal)
    if (diff > 0.05 && parsed.itemsTotal > 0) {
      guardReasons.push(
        'Inconsistência de totais: soma dos itens (' +
          sumItems.toFixed(2) +
          ') difere do total de produtos da nota (' +
          parsed.itemsTotal.toFixed(2) +
          ').',
      )
    }

    // Decisão do destino:
    // Se a flag nfe_email_auto_launch estiver DESLIGADA -> Fila de Revisão
    // Se houver qualquer falha de validação -> Fila de Revisão com os motivos
    // Se flag LIGADA e passou em TUDO -> Lança direto em Contas a Pagar
    let isException = false
    let exceptionReason = ''

    if (guardReasons.length > 0) {
      isException = true
      exceptionReason = guardReasons.join(' | ')
    } else if (!nfeEmailAutoLaunchActive) {
      isException = true
      exceptionReason =
        'Lançamento automático de NF-e por email desativado (nfe_email_auto_launch = false).'
    }

    let emailTrail =
      'Origem: email | De: ' +
      (senderEmail || senderName || 'Desconhecido') +
      ' | Assunto: ' +
      (subject || 'Sem assunto') +
      ' | Data do email: ' +
      (emailDate || brasiliaNow)
    if (!senderKnown) {
      emailTrail +=
        ' | ALERTA: Remetente não consta como fornecedor/contato conhecido do CRM — verifique a origem do XML.'
    }

    const aggregatedItems = aggregateRepetitiveItems(parsed.items)

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
    nfeRec.set('source_channel', 'email')
    nfeRec.set('raw_items', aggregatedItems)
    nfeRec.set('xml_payload', xmlContent || '')
    nfeRec.set('notes', emailTrail)

    if (isException) {
      // Caminho de Exceção: Retida na Fila de Revisão
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
      qRec.set('description', 'Nota recebida por email retida em revisão: ' + exceptionReason)
      qRec.set('status', 'pendente')
      qRec.set('item_type', 'excecao')
      qRec.set('resolution_notes', emailTrail)
      $app.save(qRec)

      console.log(
        '[NFE-EMAIL-REVIEW-QUEUED]',
        JSON.stringify({
          horarioBrasilia: brasiliaNow,
          accessKey: accessKey,
          nfeNumber: parsed.nfeNumber,
          totalAmount: parsed.totalAmount,
          senderKnown: senderKnown,
          senderEmail: senderEmail,
          messageId: gmailMsgId,
          nfeId: nfeRec.id,
          reason: exceptionReason,
        }),
      )

      return {
        success: true,
        access_key: accessKey,
        nfe_number: parsed.nfeNumber,
        nfe_id: nfeRec.id,
        sender_known: senderKnown,
        status: 'fila_revisao',
        reason: exceptionReason,
      }
    }

    // Caminho de Lançamento Automático Direto em Contas a Pagar (G1–G7, canal email)
    let payablesCreated = 0
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
        apRec.set('due_date', inst.due_date ? inst.due_date.slice(0, 10) : brasiliaNow.slice(0, 10))
        apRec.set('status', 'pendente')
        apRec.set('origin', 'email')
        apRec.set('nfe_access_key', accessKey)
        apRec.set('nfe_record', nfeRec.id)
        apRec.set('installment_number', inst.installment_number)
        apRec.set('total_installments', inst.total_installments)
        apRec.set('payment_method', 'boleto')
        apRec.set(
          'notes',
          'Gerado automaticamente via NF-e recebida por email. Chave: ' +
            accessKey +
            ' | Remetente: ' +
            (senderEmail || senderName || 'Desconhecido') +
            ' | Assunto: ' +
            (subject || 'Sem assunto') +
            ' | Data do email: ' +
            (emailDate || brasiliaNow) +
            ' | Emissão NF: ' +
            (parsed.dhEmi || 'N/A') +
            ' | Registro: ' +
            brasiliaNow,
        )
        $app.save(apRec)
        payablesCreated++

        console.log(
          '[NFE-EMAIL-AUTO-LAUNCH]',
          JSON.stringify({
            accessKey: accessKey,
            horarioBrasilia: brasiliaNow,
            origem: 'email',
            payableId: apRec.id,
            parcela: inst.installment_number + '/' + inst.total_installments,
            valor: inst.amount,
            fornecedor: parsed.emitName,
            fornecedorCnpj: parsed.emitCnpj,
            vencimento: inst.due_date ? inst.due_date.slice(0, 10) : brasiliaNow.slice(0, 10),
          }),
        )
      }
    } catch (apErr) {
      console.log('[NFE-EMAIL-PAYABLES-ERR]', String(apErr))
    }

    // Matching de itens em camadas e Pauta de Preços (igual WhatsApp / DF-e)
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

        // Gravar CUSTO REAL no produto (log [STOCK-IN])
        if (unitCost > 0) {
          matchedProduct.set('cost', unitCost)
          $app.save(matchedProduct)
          console.log(
            '[STOCK-IN]',
            JSON.stringify({
              sku: sku,
              origem: 'email',
              custoAnterior: curProductCost,
              custoRealGravado: unitCost,
              nfAccessKey: accessKey,
              horarioBrasilia: brasiliaNow,
            }),
          )
        }

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
      }
    }

    nfeRec.set('matched_items_count', matchedCount)
    nfeRec.set('pending_items_count', pendingCount)
    nfeRec.set('status', pendingCount > 0 ? 'pendente_reconciliacao' : 'processada')
    nfeRec.set('souis_stock_status', 'pendente')
    $app.save(nfeRec)

    console.log(
      '[NFE-EMAIL-AUTO-LAUNCHED-SUCCESS]',
      JSON.stringify({
        horarioBrasilia: brasiliaNow,
        accessKey: accessKey,
        nfeNumber: parsed.nfeNumber,
        totalAmount: parsed.totalAmount,
        payablesCreated: payablesCreated,
        matchedItems: matchedCount,
        pendingItems: pendingCount,
        status: nfeRec.getString('status'),
      }),
    )

    return {
      success: true,
      access_key: accessKey,
      nfe_number: parsed.nfeNumber,
      nfe_id: nfeRec.id,
      sender_known: senderKnown,
      status: nfeRec.getString('status'),
      payables_count: payablesCreated,
    }
  }

  function extractXmlsFromBody(text) {
    if (!text || typeof text !== 'string') return []
    const xmls = []
    const markers = ['<nfeProc', '<NFe', '<infNFe']
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]
      const idx = text.indexOf(marker)
      if (idx !== -1) {
        const closeTag = marker === '<infNFe' ? '</infNFe>' : marker.replace('<', '</') + '>'
        const closeIdx = text.lastIndexOf(closeTag)
        if (closeIdx !== -1 && closeIdx > idx) {
          const potential = text.substring(idx, closeIdx + closeTag.length)
          if (potential.length > 100) {
            xmls.push(potential)
            break
          }
        } else {
          const potential = text.substring(idx)
          if (potential.includes('</') && potential.length > 100) {
            xmls.push(potential)
            break
          }
        }
      }
    }
    return xmls
  }

  function decodeBase64ToUtf8(input) {
    if (!input || typeof input !== 'string') return ''
    let str = input.trim()
    if (str.startsWith('data:')) {
      const commaIdx = str.indexOf(',')
      if (commaIdx !== -1) str = str.substring(commaIdx + 1).trim()
    }
    let cleanB64 = str
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/[\r\n\s]/g, '')
    while (cleanB64.length % 4 !== 0) cleanB64 += '='

    // Tentativa 1: Buffer se disponível no runtime
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      try {
        const buf = Buffer.from(cleanB64, 'base64')
        const txt = buf.toString('utf-8')
        if (txt) return txt
      } catch (_) {}
    }

    // Tentativa 2: atob nativo se disponível
    if (typeof atob === 'function') {
      try {
        const binary = atob(cleanB64)
        if (typeof decodeURIComponent === 'function') {
          try {
            const bytesArr = []
            for (let i = 0; i < binary.length; i++) {
              const hex = binary.charCodeAt(i).toString(16)
              bytesArr.push('%' + (hex.length === 1 ? '0' + hex : hex))
            }
            return decodeURIComponent(bytesArr.join(''))
          } catch (_) {
            return binary
          }
        }
        return binary
      } catch (_) {}
    }

    // Tentativa 3: Decodificador Base64 puro em JS compatível com Goja / ES5
    try {
      const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const stripped = cleanB64.replace(/=/g, '')
      const len = stripped.length
      const bytes = []
      let i = 0
      while (i < len) {
        const c0 = b64Chars.indexOf(stripped.charAt(i++))
        const c1 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : 0
        const c2 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : -1
        const c3 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : -1
        if (c0 === -1 || c1 === -1) break
        const b0 = (c0 << 2) | (c1 >> 4)
        bytes.push(b0)
        if (c2 !== -1) {
          const b1 = ((c1 & 15) << 4) | (c2 >> 2)
          bytes.push(b1)
          if (c3 !== -1) {
            const b2 = ((c2 & 3) << 6) | c3
            bytes.push(b2)
          }
        }
      }

      // Decodificar bytes UTF-8 para string JS
      let outStr = ''
      let bIdx = 0
      const totalBytes = bytes.length
      while (bIdx < totalBytes) {
        const b = bytes[bIdx++]
        if (b < 128) {
          outStr += String.fromCharCode(b)
        } else if (b > 191 && b < 224 && bIdx < totalBytes) {
          const b2 = bytes[bIdx++]
          outStr += String.fromCharCode(((b & 31) << 6) | (b2 & 63))
        } else if (b > 223 && b < 240 && bIdx + 1 < totalBytes) {
          const b2 = bytes[bIdx++]
          const b3 = bytes[bIdx++]
          outStr += String.fromCharCode(((b & 15) << 12) | ((b2 & 63) << 6) | (b3 & 63))
        } else if (b > 239 && b < 248 && bIdx + 2 < totalBytes) {
          const b2 = bytes[bIdx++]
          const b3 = bytes[bIdx++]
          const b4 = bytes[bIdx++]
          let codePoint = ((b & 7) << 18) | ((b2 & 63) << 12) | ((b3 & 63) << 6) | (b4 & 63)
          codePoint -= 0x10000
          outStr += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff))
        } else {
          outStr += String.fromCharCode(b)
        }
      }
      return outStr
    } catch (_) {
      return ''
    }
  }

  const horarioBrasilia = getBrasiliaIsoDate()

  try {
    if (typeof $connectors === 'undefined' || typeof $connectors.executeAsOwner !== 'function') {
      console.log(
        '[NFE-EMAIL-INBOX-SKIPPED]',
        JSON.stringify({
          horarioBrasilia: horarioBrasilia,
          reason: '$connectors.executeAsOwner não disponível ou Conectores desabilitados.',
        }),
      )
      return
    }

    let fetchRes = null
    try {
      fetchRes = $connectors.executeAsOwner('GMAIL_FETCH_EMAILS', {
        query: 'filename:xml OR "xml" OR "nfe" OR "danfe" OR "faturamento"',
        max_results: 20,
        include_payload: true,
        verbose: true,
      })
    } catch (connErr) {
      console.log(
        '[NFE-EMAIL-FETCH-ERR]',
        JSON.stringify({
          horarioBrasilia: horarioBrasilia,
          error: String(connErr),
        }),
      )
      return
    }

    if (!fetchRes || !fetchRes.successful) {
      console.log(
        '[NFE-EMAIL-FETCH-UNSUCCESSFUL]',
        JSON.stringify({
          horarioBrasilia: horarioBrasilia,
          error: 'Falha ou resposta sem sucesso do conector Gmail em modo owner.',
        }),
      )
      return
    }

    const rawData = fetchRes.data || {}
    let messages = []
    if (Array.isArray(rawData)) {
      messages = rawData
    } else if (Array.isArray(rawData.messages)) {
      messages = rawData.messages
    } else if (Array.isArray(rawData.emails)) {
      messages = rawData.emails
    } else if (rawData.data && Array.isArray(rawData.data.messages)) {
      messages = rawData.data.messages
    }

    console.log(
      '[NFE-EMAIL-INBOX-POLL]',
      JSON.stringify({
        horarioBrasilia: horarioBrasilia,
        messagesFound: messages.length,
      }),
    )

    if (messages.length === 0) return

    const inboxCol = $app.findCollectionByNameOrId('nfe_email_inbox')

    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m] || {}
      const msgId = String(msg.id || msg.message_id || msg.messageId || '').trim()
      const threadId = String(msg.thread_id || msg.threadId || '').trim()

      if (!msgId) continue

      let existingRecord = null
      try {
        existingRecord = $app.findFirstRecordByFilter(
          'nfe_email_inbox',
          'gmail_message_id = {:mid}',
          { mid: msgId },
        )
      } catch (_) {}

      // Se já processado com sucesso, pula; se estava 'sem_xml' ou 'erro', permite reprocessar
      if (existingRecord && existingRecord.getString('status') === 'processado') {
        continue
      }

      let senderRaw = ''
      let senderEmail = ''
      let senderName = ''
      let subject = ''
      let emailDate = ''

      if (msg.payload && Array.isArray(msg.payload.headers)) {
        const headers = msg.payload.headers
        for (let h = 0; h < headers.length; h++) {
          const name = (headers[h].name || '').toLowerCase()
          const val = headers[h].value || ''
          if (name === 'from') senderRaw = val
          else if (name === 'subject') subject = val
          else if (name === 'date') emailDate = val
        }
      } else {
        senderRaw = msg.sender || msg.from || ''
        subject = msg.subject || ''
        emailDate = msg.date || msg.internalDate || ''
      }

      if (senderRaw) {
        const match = senderRaw.match(/<([^>]+)>/)
        if (match) {
          senderEmail = match[1].toLowerCase().trim()
          senderName = senderRaw
            .replace(/<[^>]+>/, '')
            .replace(/["']/g, '')
            .trim()
        } else {
          senderEmail = senderRaw.toLowerCase().trim()
          senderName = senderRaw.trim()
        }
      }

      let senderKnown = false
      if (senderEmail) {
        try {
          const knownCusts = $app.findRecordsByFilter(
            'customers',
            'email = {:email} && deleted = false',
            '-created',
            1,
            0,
            { email: senderEmail },
          )
          if (knownCusts && knownCusts.length > 0) {
            senderKnown = true
          }
        } catch (_) {}
      }

      const xmlList = []
      const attachmentsToFetch = []

      function searchParts(parts) {
        if (!Array.isArray(parts)) return
        for (let p = 0; p < parts.length; p++) {
          const part = parts[p]
          if (!part || typeof part !== 'object') continue
          const fn = (part.filename || part.file_name || '').toLowerCase()
          const mime = (part.mimeType || part.mime_type || '').toLowerCase()
          const bodyObj = part.body || {}

          if (fn.endsWith('.xml') || mime.includes('xml')) {
            if (bodyObj.data && typeof bodyObj.data === 'string') {
              try {
                const textContent = decodeBase64ToUtf8(bodyObj.data)
                if (
                  textContent &&
                  (textContent.includes('<nfeProc') ||
                    textContent.includes('<NFe') ||
                    textContent.includes('<infNFe'))
                ) {
                  xmlList.push(textContent)
                }
              } catch (decErr) {
                console.log('[NFE-EMAIL-B64-DEC-ERR]', String(decErr))
              }
            } else if (bodyObj.attachmentId || part.attachment_id || part.attachmentId) {
              const attIdFound = bodyObj.attachmentId || part.attachment_id || part.attachmentId
              let alreadyInList = false
              for (let k = 0; k < attachmentsToFetch.length; k++) {
                if (attachmentsToFetch[k].attachment_id === attIdFound) {
                  alreadyInList = true
                  break
                }
              }
              if (!alreadyInList) {
                attachmentsToFetch.push({
                  attachment_id: attIdFound,
                  file_name: part.filename || part.file_name || 'nfe.xml',
                })
              }
            }
          }
          if (part.parts && Array.isArray(part.parts)) {
            searchParts(part.parts)
          }
        }
      }

      if (msg.payload) {
        if (msg.payload.parts && Array.isArray(msg.payload.parts)) {
          searchParts(msg.payload.parts)
        }
        const topFn = (msg.payload.filename || msg.payload.file_name || '').toLowerCase()
        const topMime = (msg.payload.mimeType || msg.payload.mime_type || '').toLowerCase()
        if (topFn.endsWith('.xml') || topMime.includes('xml')) {
          const topBody = msg.payload.body || {}
          if (topBody.attachmentId) {
            attachmentsToFetch.push({
              attachment_id: topBody.attachmentId,
              file_name: msg.payload.filename || 'nfe.xml',
            })
          }
        }
      }

      if (Array.isArray(msg.attachmentList)) {
        for (let al = 0; al < msg.attachmentList.length; al++) {
          const att = msg.attachmentList[al] || {}
          const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
          const attId = att.attachmentId || att.attachment_id || att.id
          if (fn.endsWith('.xml') || fn.includes('xml')) {
            if (att.content || att.data) {
              try {
                const textContent = decodeBase64ToUtf8(att.content || att.data)
                if (
                  textContent &&
                  (textContent.includes('<nfeProc') ||
                    textContent.includes('<NFe') ||
                    textContent.includes('<infNFe'))
                ) {
                  xmlList.push(textContent)
                }
              } catch (_) {}
            } else if (attId) {
              let alreadyInList = false
              for (let k = 0; k < attachmentsToFetch.length; k++) {
                if (attachmentsToFetch[k].attachment_id === attId) {
                  alreadyInList = true
                  break
                }
              }
              if (!alreadyInList) {
                attachmentsToFetch.push({
                  attachment_id: attId,
                  file_name: att.filename || att.file_name || att.name || 'nfe.xml',
                })
              }
            }
          }
        }
      }

      if (Array.isArray(msg.attachments)) {
        for (let a = 0; a < msg.attachments.length; a++) {
          const att = msg.attachments[a] || {}
          const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
          const attId = att.attachmentId || att.attachment_id || att.id
          if (fn.endsWith('.xml') || fn.includes('xml')) {
            if (att.content || att.data) {
              try {
                const textContent = decodeBase64ToUtf8(att.content || att.data)
                if (
                  textContent &&
                  (textContent.includes('<nfeProc') ||
                    textContent.includes('<NFe') ||
                    textContent.includes('<infNFe'))
                ) {
                  xmlList.push(textContent)
                }
              } catch (_) {}
            } else if (attId) {
              let alreadyInList = false
              for (let k = 0; k < attachmentsToFetch.length; k++) {
                if (attachmentsToFetch[k].attachment_id === attId) {
                  alreadyInList = true
                  break
                }
              }
              if (!alreadyInList) {
                attachmentsToFetch.push({
                  attachment_id: attId,
                  file_name: att.filename || att.file_name || att.name || 'nfe.xml',
                })
              }
            }
          }
        }
      }

      for (let f = 0; f < attachmentsToFetch.length; f++) {
        const attInfo = attachmentsToFetch[f]
        try {
          const attRes = $connectors.executeAsOwner('GMAIL_GET_ATTACHMENT', {
            message_id: msgId,
            attachment_id: attInfo.attachment_id,
            file_name: attInfo.file_name,
          })
          if (attRes && attRes.successful && attRes.data) {
            let rawAttData = ''
            let downloadUrl = ''

            if (typeof attRes.data === 'string') {
              rawAttData = attRes.data
            } else if (attRes.data && typeof attRes.data === 'object') {
              const fileObj = attRes.data.file || {}
              downloadUrl =
                fileObj.s3url ||
                fileObj.url ||
                fileObj.download_url ||
                attRes.data.s3url ||
                attRes.data.url ||
                attRes.data.download_url ||
                ''

              rawAttData =
                attRes.data.data ||
                attRes.data.content ||
                attRes.data.body ||
                (attRes.data.response &&
                  (attRes.data.response.data || attRes.data.response.content)) ||
                ''
            }

            if (!rawAttData && downloadUrl) {
              try {
                const dlHttp = $http.send({
                  url: downloadUrl,
                  method: 'GET',
                  timeout: 30,
                })
                if (dlHttp && dlHttp.statusCode >= 200 && dlHttp.statusCode < 300) {
                  rawAttData = dlHttp.raw || ''
                }
              } catch (dlErr) {
                console.log('[NFE-EMAIL-ATTACH-DOWNLOAD-ERR]', String(dlErr))
              }
            }

            if (rawAttData) {
              let textContent = ''
              const rawStr = String(rawAttData).trim()
              if (
                rawStr.includes('<nfeProc') ||
                rawStr.includes('<NFe') ||
                rawStr.includes('<infNFe')
              ) {
                textContent = rawStr
              } else {
                textContent = decodeBase64ToUtf8(rawStr)
              }
              if (
                textContent &&
                (textContent.includes('<nfeProc') ||
                  textContent.includes('<NFe') ||
                  textContent.includes('<infNFe'))
              ) {
                xmlList.push(textContent)
              }
            }
          }
        } catch (attErr) {
          console.log('[NFE-EMAIL-ATTACH-FETCH-ERR]', String(attErr))
        }
      }
      const bodySnippet = msg.snippet || msg.body || msg.text || ''
      if (xmlList.length === 0 && bodySnippet) {
        const foundInBody = extractXmlsFromBody(bodySnippet)
        for (let b = 0; b < foundInBody.length; b++) {
          xmlList.push(foundInBody[b])
        }
      }

      const extractedKeys = []
      const ingestErrors = []
      const metaPayload = {
        sender_email: senderEmail,
        sender_name: senderName,
        subject: subject,
        email_date: emailDate,
        gmail_message_id: msgId,
      }

      for (let x = 0; x < xmlList.length; x++) {
        try {
          const res = ingestNfeXml(xmlList[x], metaPayload)
          if (res.access_key) extractedKeys.push(res.access_key)
          if (res.sender_known) senderKnown = true
          if (!res.success && res.error) ingestErrors.push(res.error)
        } catch (inEx) {
          ingestErrors.push(String(inEx))
        }
      }

      try {
        const inboxRec = existingRecord || new Record(inboxCol)
        inboxRec.set('gmail_message_id', msgId)
        inboxRec.set('gmail_thread_id', threadId)
        inboxRec.set('sender_email', senderEmail)
        inboxRec.set('sender_name', senderName)
        inboxRec.set('sender_known', senderKnown)
        inboxRec.set('subject', subject)
        inboxRec.set('email_date', emailDate)
        inboxRec.set('xml_count', xmlList.length)
        inboxRec.set('xml_keys', extractedKeys)
        inboxRec.set('processed_at', horarioBrasilia)

        if (xmlList.length > 0) {
          inboxRec.set('status', ingestErrors.length > 0 ? 'erro' : 'processado')
          if (ingestErrors.length > 0) {
            inboxRec.set('error_detail', ingestErrors.join(' | '))
          } else {
            inboxRec.set('error_detail', '')
          }
        } else {
          inboxRec.set('status', 'sem_xml')
        }

        $app.save(inboxRec)

        console.log(
          '[NFE-EMAIL-PROCESSED]',
          JSON.stringify({
            horarioBrasilia: horarioBrasilia,
            messageId: msgId,
            remetente: senderEmail,
            senderKnown: senderKnown,
            xmlCount: xmlList.length,
            chaves: extractedKeys,
            status: inboxRec.getString('status'),
          }),
        )
      } catch (saveInboxErr) {
        console.log('[NFE-EMAIL-INBOX-SAVE-ERR]', String(saveInboxErr))
      }
    }
  } catch (cronEx) {
    console.log(
      '[NFE-EMAIL-CRON-FAIL-ALOUD]',
      JSON.stringify({
        horarioBrasilia: horarioBrasilia,
        error: cronEx.message || String(cronEx),
      }),
    )
  }
})

// 2. Rota manual POST para disparo/teste do inbox por admins
routerAdd('POST', '/backend/v1/nfe/email-inbox/sync', (e) => {
  let headersObj = {}
  let queryObj = {}
  try {
    const reqInfo = e.requestInfo()
    headersObj = (reqInfo && reqInfo.headers) || {}
    queryObj = (reqInfo && reqInfo.query) || {}
  } catch (_) {
    headersObj = {}
    queryObj = {}
  }

  const authHeader =
    headersObj['x-dfe-token'] ||
    headersObj['X-DFe-Token'] ||
    headersObj['X-DFE-TOKEN'] ||
    headersObj['authorization'] ||
    headersObj['Authorization'] ||
    headersObj['x-api-key'] ||
    headersObj['X-Api-Key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }
  if (!token) {
    const queryToken = queryObj['dfe_token'] || queryObj['dfeToken'] || queryObj['token'] || ''
    token = String(queryToken).trim()
  }

  let isAuthorized = false
  if (e.auth) {
    isAuthorized = true
  } else if (token) {
    try {
      const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
      if (settingsRec) {
        const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
        const tokenActive = settingsRec.getBool('dfe_token_active')
        if (dfeToken && tokenActive && token === dfeToken) {
          isAuthorized = true
        }
      }
    } catch (_) {}
  }

  if (!isAuthorized) {
    return e.json(401, {
      success: false,
      error: 'Autenticação necessária (login de usuário ou token de integração).',
    })
  }
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
    const enderEmitBlock = extractXmlTag(emitBlock, 'enderEmit')
    const emitPhone = cleanDigits(extractXmlTag(enderEmitBlock, 'fone'))

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
      emitPhone: emitPhone,
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

  function ingestNfeXml(xmlContent, meta) {
    const metaObj = meta || {}
    const senderEmail = (metaObj.sender_email || '').trim().toLowerCase()
    const senderName = (metaObj.sender_name || '').trim()
    const subject = (metaObj.subject || '').trim()
    const emailDate = (metaObj.email_date || '').trim()
    const gmailMsgId = (metaObj.gmail_message_id || '').trim()
    const brasiliaNow = getBrasiliaIsoDate()

    const parsed = parseNfeXml(xmlContent)
    if (!parsed.valid) {
      return {
        success: false,
        status: parsed.isEvent ? 'evento_ignorado' : 'erro_schema',
        error: parsed.error,
      }
    }

    const accessKey = parsed.accessKey
    if (!accessKey || accessKey.length !== 44) {
      return {
        success: false,
        status: 'erro_chave',
        error: 'Chave de acesso inválida.',
      }
    }

    // Camada Anti-duplicação 1: Dedupe prévia por chave de acesso 44 dígitos
    let existingNfe = null
    try {
      existingNfe = $app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', {
        k: accessKey,
      })
    } catch (_) {}

    if (existingNfe) {
      return {
        success: true,
        duplicate: true,
        access_key: accessKey,
        status: existingNfe.getString('status'),
        record_id: existingNfe.id,
      }
    }

    // Identificação do fornecedor / remetente
    let senderKnown = false
    let supplierRec = null

    if (parsed.emitCnpj) {
      try {
        const foundByCnpj = $app.findRecordsByFilter(
          'customers',
          'cnpj = {:cnpj} && deleted = false',
          '-created',
          1,
          0,
          { cnpj: parsed.emitCnpj },
        )
        if (foundByCnpj && foundByCnpj.length > 0) {
          supplierRec = foundByCnpj[0]
          senderKnown = true
        }
      } catch (_) {}
    }

    if (!senderKnown && senderEmail) {
      try {
        const foundByEmail = $app.findRecordsByFilter(
          'customers',
          'email = {:email} && deleted = false',
          '-created',
          1,
          0,
          { email: senderEmail },
        )
        if (foundByEmail && foundByEmail.length > 0) {
          if (!supplierRec) supplierRec = foundByEmail[0]
          senderKnown = true
        }
      } catch (_) {}
    }

    let supplierPendingRegistration = false
    if (!supplierRec && parsed.emitCnpj) {
      if (parsed.emitPhone) {
        try {
          const custCol = $app.findCollectionByNameOrId('customers')
          const newSupp = new Record(custCol)
          newSupp.set('name', parsed.emitName || 'Fornecedor CNPJ ' + parsed.emitCnpj)
          newSupp.set('company', parsed.emitName || '')
          newSupp.set('cnpj', parsed.emitCnpj)
          newSupp.set('phone', parsed.emitPhone)
          newSupp.set('email', senderEmail || '')
          newSupp.set('type', 'PJ')
          newSupp.set('customer_type', 'Fornecedor')
          newSupp.set('source', 'nfe_email_inbox')
          newSupp.set('notes', 'Cadastrado automaticamente via entrada de NF-e por Email.')
          $app.save(newSupp)
          supplierRec = newSupp
        } catch (suppErr) {
          console.log('[NFE-EMAIL-SUPPLIER-CREATE-ERR]', String(suppErr))
          supplierPendingRegistration = true
        }
      } else {
        supplierPendingRegistration = true
      }
    }

    // Leitura de configurações
    let companyCnpj = ''
    let nfeEmailAutoLaunchActive = true
    let familyMargins = {}
    try {
      const s = $app.findFirstRecordByFilter('settings', "id != ''")
      if (s) {
        companyCnpj = cleanDigits(s.getString('company_cnpj') || '')
        const valFlag = s.get('nfe_email_auto_launch')
        if (typeof valFlag === 'boolean') {
          nfeEmailAutoLaunchActive = valFlag
        }
        try {
          const rawM = s.get('family_margins')
          if (typeof rawM === 'object' && rawM !== null) familyMargins = rawM
          else if (typeof rawM === 'string' && rawM.trim()) familyMargins = JSON.parse(rawM)
        } catch (_) {}
      }
    } catch (_) {}

    const guardReasons = []

    // 1. Destinatário = CNPJ da empresa
    if (!companyCnpj || companyCnpj.length !== 14) {
      guardReasons.push(
        'GUARDA DE CEGUEIRA: CNPJ da empresa não configurado no painel de Configurações.',
      )
    } else if (!parsed.destCnpj || parsed.destCnpj !== companyCnpj) {
      guardReasons.push(
        'Destinatário (' +
          (parsed.destCnpj || 'vazio') +
          ') não coincide com o CNPJ da empresa (' +
          companyCnpj +
          '). Nota de terceiro encaminhada para revisão.',
      )
    }

    // 2. Remetente conhecido do CRM
    if (!senderKnown) {
      guardReasons.push(
        'Remetente desconhecido: CNPJ (' +
          (parsed.emitCnpj || 'vazio') +
          ') ou email (' +
          (senderEmail || 'vazio') +
          ') não consta previamente como fornecedor/contato conhecido do CRM.',
      )
    }

    // 2.1 Fornecedor pendente de cadastro (sem telefone no XML para cadastro automático)
    if (supplierPendingRegistration) {
      guardReasons.push(
        'Fornecedor pendente de cadastro: XML sem telefone do emitente (<enderEmit><fone>) para cadastro automático no CRM.',
      )
    }

    // 3. Status autorizada
    if (!parsed.cStat || !parsed.nProt) {
      guardReasons.push('NF-e sem protocolo de autorização (<protNFe> / <nProt> ausente).')
    } else if (parsed.cStat !== '100' && parsed.cStat !== '150') {
      guardReasons.push(
        'NF-e não autorizada (cStat=' +
          parsed.cStat +
          ' - ' +
          (parsed.xMotivo || 'Cancelada/Inutilizada/Denegada') +
          ').',
      )
    }

    // 4. CFOP compra direta
    for (let c = 0; c < parsed.items.length; c++) {
      const itCfop = String(parsed.items[c].cfop || '').trim()
      if (itCfop !== '1102' && itCfop !== '2102') {
        guardReasons.push(
          'CFOP não padrão para compra direta (' +
            itCfop +
            '). Devolução, ajuste ou transferência requer revisão manual.',
        )
        break
      }
    }

    // 5. Totais batendo
    let sumItems = 0
    for (let s = 0; s < parsed.items.length; s++) {
      sumItems += parsed.items[s].vProd
    }
    const diff = Math.abs(sumItems - parsed.itemsTotal)
    if (diff > 0.05 && parsed.itemsTotal > 0) {
      guardReasons.push(
        'Inconsistência de totais: soma dos itens (' +
          sumItems.toFixed(2) +
          ') difere do total de produtos da nota (' +
          parsed.itemsTotal.toFixed(2) +
          ').',
      )
    }

    let isException = false
    let exceptionReason = ''

    if (guardReasons.length > 0) {
      isException = true
      exceptionReason = guardReasons.join(' | ')
    } else if (!nfeEmailAutoLaunchActive) {
      isException = true
      exceptionReason =
        'Lançamento automático de NF-e por email desativado (nfe_email_auto_launch = false).'
    }

    let emailTrail =
      'Origem: email | De: ' +
      (senderEmail || senderName || 'Desconhecido') +
      ' | Assunto: ' +
      (subject || 'Sem assunto') +
      ' | Data do email: ' +
      (emailDate || brasiliaNow)
    if (!senderKnown) {
      emailTrail +=
        ' | ALERTA: Remetente não consta como fornecedor/contato conhecido do CRM — verifique a origem do XML.'
    }

    const aggregatedItems = aggregateRepetitiveItems(parsed.items)

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
    nfeRec.set('source_channel', 'email')
    nfeRec.set('raw_items', aggregatedItems)
    nfeRec.set('xml_payload', xmlContent || '')
    nfeRec.set('notes', emailTrail)

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
      qRec.set('description', 'Nota recebida por email retida em revisão: ' + exceptionReason)
      qRec.set('status', 'pendente')
      qRec.set('item_type', 'excecao')
      qRec.set('resolution_notes', emailTrail)
      $app.save(qRec)

      console.log(
        '[NFE-EMAIL-REVIEW-QUEUED]',
        JSON.stringify({
          horarioBrasilia: brasiliaNow,
          accessKey: accessKey,
          nfeNumber: parsed.nfeNumber,
          totalAmount: parsed.totalAmount,
          senderKnown: senderKnown,
          senderEmail: senderEmail,
          messageId: gmailMsgId,
          nfeId: nfeRec.id,
          reason: exceptionReason,
        }),
      )

      return {
        success: true,
        access_key: accessKey,
        nfe_number: parsed.nfeNumber,
        nfe_id: nfeRec.id,
        sender_known: senderKnown,
        status: 'fila_revisao',
        reason: exceptionReason,
      }
    }

    // Lançamento Automático em Contas a Pagar
    let payablesCreated = 0
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
        apRec.set('due_date', inst.due_date ? inst.due_date.slice(0, 10) : brasiliaNow.slice(0, 10))
        apRec.set('status', 'pendente')
        apRec.set('origin', 'email')
        apRec.set('nfe_access_key', accessKey)
        apRec.set('nfe_record', nfeRec.id)
        apRec.set('installment_number', inst.installment_number)
        apRec.set('total_installments', inst.total_installments)
        apRec.set('payment_method', 'boleto')
        apRec.set(
          'notes',
          'Gerado automaticamente via NF-e recebida por email. Chave: ' +
            accessKey +
            ' | Remetente: ' +
            (senderEmail || senderName || 'Desconhecido') +
            ' | Assunto: ' +
            (subject || 'Sem assunto') +
            ' | Data do email: ' +
            (emailDate || brasiliaNow) +
            ' | Emissão NF: ' +
            (parsed.dhEmi || 'N/A') +
            ' | Registro: ' +
            brasiliaNow,
        )
        $app.save(apRec)
        payablesCreated++

        console.log(
          '[NFE-EMAIL-AUTO-LAUNCH]',
          JSON.stringify({
            accessKey: accessKey,
            horarioBrasilia: brasiliaNow,
            origem: 'email',
            payableId: apRec.id,
            parcela: inst.installment_number + '/' + inst.total_installments,
            valor: inst.amount,
            fornecedor: parsed.emitName,
            fornecedorCnpj: parsed.emitCnpj,
            vencimento: inst.due_date ? inst.due_date.slice(0, 10) : brasiliaNow.slice(0, 10),
          }),
        )
      }
    } catch (apErr) {
      console.log('[NFE-EMAIL-PAYABLES-ERR]', String(apErr))
    }

    // Matching em Camadas e Pauta de Preços
    let matchedCount = 0
    let pendingCount = 0
    const queueCol = $app.findCollectionByNameOrId('nfe_price_queue')

    for (let i = 0; i < aggregatedItems.length; i++) {
      const item = aggregatedItems[i]
      const supplierCode = String(item.cProd || '').trim()
      const desc = String(item.xProd || '').trim()
      let matchedProduct = null

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
            }
          }
        } catch (_) {}
      }

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

        if (unitCost > 0) {
          matchedProduct.set('cost', unitCost)
          $app.save(matchedProduct)
          console.log(
            '[STOCK-IN]',
            JSON.stringify({
              sku: sku,
              origem: 'email',
              custoAnterior: curProductCost,
              custoRealGravado: unitCost,
              nfAccessKey: accessKey,
              horarioBrasilia: brasiliaNow,
            }),
          )
        }

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
      }
    }

    nfeRec.set('matched_items_count', matchedCount)
    nfeRec.set('pending_items_count', pendingCount)
    nfeRec.set('status', pendingCount > 0 ? 'pendente_reconciliacao' : 'processada')
    nfeRec.set('souis_stock_status', 'pendente')
    $app.save(nfeRec)

    console.log(
      '[NFE-EMAIL-AUTO-LAUNCHED-SUCCESS]',
      JSON.stringify({
        horarioBrasilia: brasiliaNow,
        accessKey: accessKey,
        nfeNumber: parsed.nfeNumber,
        totalAmount: parsed.totalAmount,
        payablesCreated: payablesCreated,
        matchedItems: matchedCount,
        pendingItems: pendingCount,
        status: nfeRec.getString('status'),
      }),
    )

    return {
      success: true,
      access_key: accessKey,
      nfe_number: parsed.nfeNumber,
      nfe_id: nfeRec.id,
      sender_known: senderKnown,
      status: nfeRec.getString('status'),
      payables_count: payablesCreated,
    }
  }

  function extractXmlsFromBody(text) {
    if (!text || typeof text !== 'string') return []
    const xmls = []
    const markers = ['<nfeProc', '<NFe', '<infNFe']
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]
      const idx = text.indexOf(marker)
      if (idx !== -1) {
        const closeTag = marker === '<infNFe' ? '</infNFe>' : marker.replace('<', '</') + '>'
        const closeIdx = text.lastIndexOf(closeTag)
        if (closeIdx !== -1 && closeIdx > idx) {
          const potential = text.substring(idx, closeIdx + closeTag.length)
          if (potential.length > 100) {
            xmls.push(potential)
            break
          }
        } else {
          const potential = text.substring(idx)
          if (potential.includes('</') && potential.length > 100) {
            xmls.push(potential)
            break
          }
        }
      }
    }
    return xmls
  }

  function decodeBase64ToUtf8(input) {
    if (!input || typeof input !== 'string') return ''
    let str = input.trim()
    if (str.startsWith('data:')) {
      const commaIdx = str.indexOf(',')
      if (commaIdx !== -1) str = str.substring(commaIdx + 1).trim()
    }
    let cleanB64 = str
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/[\r\n\s]/g, '')
    while (cleanB64.length % 4 !== 0) cleanB64 += '='

    // Tentativa 1: Buffer se disponível no runtime
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      try {
        const buf = Buffer.from(cleanB64, 'base64')
        const txt = buf.toString('utf-8')
        if (txt) return txt
      } catch (_) {}
    }

    // Tentativa 2: atob nativo se disponível
    if (typeof atob === 'function') {
      try {
        const binary = atob(cleanB64)
        if (typeof decodeURIComponent === 'function') {
          try {
            const bytesArr = []
            for (let i = 0; i < binary.length; i++) {
              const hex = binary.charCodeAt(i).toString(16)
              bytesArr.push('%' + (hex.length === 1 ? '0' + hex : hex))
            }
            return decodeURIComponent(bytesArr.join(''))
          } catch (_) {
            return binary
          }
        }
        return binary
      } catch (_) {}
    }

    // Tentativa 3: Decodificador Base64 puro em JS compatível com Goja / ES5
    try {
      const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const stripped = cleanB64.replace(/=/g, '')
      const len = stripped.length
      const bytes = []
      let i = 0
      while (i < len) {
        const c0 = b64Chars.indexOf(stripped.charAt(i++))
        const c1 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : 0
        const c2 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : -1
        const c3 = i < len ? b64Chars.indexOf(stripped.charAt(i++)) : -1
        if (c0 === -1 || c1 === -1) break
        const b0 = (c0 << 2) | (c1 >> 4)
        bytes.push(b0)
        if (c2 !== -1) {
          const b1 = ((c1 & 15) << 4) | (c2 >> 2)
          bytes.push(b1)
          if (c3 !== -1) {
            const b2 = ((c2 & 3) << 6) | c3
            bytes.push(b2)
          }
        }
      }

      // Decodificar bytes UTF-8 para string JS
      let outStr = ''
      let bIdx = 0
      const totalBytes = bytes.length
      while (bIdx < totalBytes) {
        const b = bytes[bIdx++]
        if (b < 128) {
          outStr += String.fromCharCode(b)
        } else if (b > 191 && b < 224 && bIdx < totalBytes) {
          const b2 = bytes[bIdx++]
          outStr += String.fromCharCode(((b & 31) << 6) | (b2 & 63))
        } else if (b > 223 && b < 240 && bIdx + 1 < totalBytes) {
          const b2 = bytes[bIdx++]
          const b3 = bytes[bIdx++]
          outStr += String.fromCharCode(((b & 15) << 12) | ((b2 & 63) << 6) | (b3 & 63))
        } else if (b > 239 && b < 248 && bIdx + 2 < totalBytes) {
          const b2 = bytes[bIdx++]
          const b3 = bytes[bIdx++]
          const b4 = bytes[bIdx++]
          let codePoint = ((b & 7) << 18) | ((b2 & 63) << 12) | ((b3 & 63) << 6) | (b4 & 63)
          codePoint -= 0x10000
          outStr += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff))
        } else {
          outStr += String.fromCharCode(b)
        }
      }
      return outStr
    } catch (_) {
      return ''
    }
  }

  const horarioBrasilia = getBrasiliaIsoDate()

  if (typeof $connectors === 'undefined' || typeof $connectors.executeAsOwner !== 'function') {
    return e.json(503, {
      success: false,
      error: 'Conectores não disponíveis ou desabilitados.',
      horarioBrasilia: horarioBrasilia,
    })
  }

  let fetchRes = null
  try {
    fetchRes = $connectors.executeAsOwner('GMAIL_FETCH_EMAILS', {
      query: 'filename:xml OR "xml" OR "nfe" OR "danfe" OR "faturamento"',
      max_results: 20,
      include_payload: true,
      verbose: true,
    })
  } catch (connErr) {
    return e.json(502, {
      success: false,
      error: String(connErr),
      horarioBrasilia: horarioBrasilia,
    })
  }

  if (!fetchRes || !fetchRes.successful) {
    return e.json(502, {
      success: false,
      error: 'Falha ou resposta sem sucesso do conector Gmail em modo owner.',
      horarioBrasilia: horarioBrasilia,
    })
  }

  const rawData = fetchRes.data || {}
  let messages = []
  if (Array.isArray(rawData)) {
    messages = rawData
  } else if (Array.isArray(rawData.messages)) {
    messages = rawData.messages
  } else if (Array.isArray(rawData.emails)) {
    messages = rawData.emails
  } else if (rawData.data && Array.isArray(rawData.data.messages)) {
    messages = rawData.data.messages
  }

  let processedCount = 0
  const inboxCol = $app.findCollectionByNameOrId('nfe_email_inbox')

  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m] || {}
    const msgId = String(msg.id || msg.message_id || msg.messageId || '').trim()
    const threadId = String(msg.thread_id || msg.threadId || '').trim()

    if (!msgId) continue

    let existingRecord = null
    try {
      existingRecord = $app.findFirstRecordByFilter(
        'nfe_email_inbox',
        'gmail_message_id = {:mid}',
        { mid: msgId },
      )
    } catch (_) {}

    // Se já processado com sucesso, pula; se estava 'sem_xml' ou 'erro', permite reprocessar
    if (existingRecord && existingRecord.getString('status') === 'processado') {
      continue
    }

    let senderRaw = ''
    let senderEmail = ''
    let senderName = ''
    let subject = ''
    let emailDate = ''

    if (msg.payload && Array.isArray(msg.payload.headers)) {
      const headers = msg.payload.headers
      for (let h = 0; h < headers.length; h++) {
        const name = (headers[h].name || '').toLowerCase()
        const val = headers[h].value || ''
        if (name === 'from') senderRaw = val
        else if (name === 'subject') subject = val
        else if (name === 'date') emailDate = val
      }
    } else {
      senderRaw = msg.sender || msg.from || ''
      subject = msg.subject || ''
      emailDate = msg.date || msg.internalDate || ''
    }

    if (senderRaw) {
      const match = senderRaw.match(/<([^>]+)>/)
      if (match) {
        senderEmail = match[1].toLowerCase().trim()
        senderName = senderRaw
          .replace(/<[^>]+>/, '')
          .replace(/["']/g, '')
          .trim()
      } else {
        senderEmail = senderRaw.toLowerCase().trim()
        senderName = senderRaw.trim()
      }
    }

    let senderKnown = false
    if (senderEmail) {
      try {
        const knownCusts = $app.findRecordsByFilter(
          'customers',
          'email = {:email} && deleted = false',
          '-created',
          1,
          0,
          { email: senderEmail },
        )
        if (knownCusts && knownCusts.length > 0) {
          senderKnown = true
        }
      } catch (_) {}
    }

    const xmlList = []
    const attachmentsToFetch = []

    function searchParts(parts) {
      if (!Array.isArray(parts)) return
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]
        if (!part || typeof part !== 'object') continue
        const fn = (part.filename || part.file_name || '').toLowerCase()
        const mime = (part.mimeType || part.mime_type || '').toLowerCase()
        const bodyObj = part.body || {}

        if (fn.endsWith('.xml') || mime.includes('xml')) {
          if (bodyObj.data && typeof bodyObj.data === 'string') {
            try {
              const textContent = decodeBase64ToUtf8(bodyObj.data)
              if (
                textContent &&
                (textContent.includes('<nfeProc') ||
                  textContent.includes('<NFe') ||
                  textContent.includes('<infNFe'))
              ) {
                xmlList.push(textContent)
              }
            } catch (decErr) {
              console.log('[NFE-EMAIL-B64-DEC-ERR]', String(decErr))
            }
          } else if (bodyObj.attachmentId || part.attachment_id || part.attachmentId) {
            const attIdFound = bodyObj.attachmentId || part.attachment_id || part.attachmentId
            let alreadyInList = false
            for (let k = 0; k < attachmentsToFetch.length; k++) {
              if (attachmentsToFetch[k].attachment_id === attIdFound) {
                alreadyInList = true
                break
              }
            }
            if (!alreadyInList) {
              attachmentsToFetch.push({
                attachment_id: attIdFound,
                file_name: part.filename || part.file_name || 'nfe.xml',
              })
            }
          }
        }

        if (part.parts && Array.isArray(part.parts)) {
          searchParts(part.parts)
        }
      }
    }

    if (msg.payload) {
      if (msg.payload.parts && Array.isArray(msg.payload.parts)) {
        searchParts(msg.payload.parts)
      }
      const topFn = (msg.payload.filename || msg.payload.file_name || '').toLowerCase()
      const topMime = (msg.payload.mimeType || msg.payload.mime_type || '').toLowerCase()
      if (topFn.endsWith('.xml') || topMime.includes('xml')) {
        const topBody = msg.payload.body || {}
        if (topBody.attachmentId) {
          attachmentsToFetch.push({
            attachment_id: topBody.attachmentId,
            file_name: msg.payload.filename || 'nfe.xml',
          })
        }
      }
    }

    if (Array.isArray(msg.attachmentList)) {
      for (let al = 0; al < msg.attachmentList.length; al++) {
        const att = msg.attachmentList[al] || {}
        const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
        const attId = att.attachmentId || att.attachment_id || att.id
        if (fn.endsWith('.xml') || fn.includes('xml')) {
          if (att.content || att.data) {
            try {
              const textContent = decodeBase64ToUtf8(att.content || att.data)
              if (
                textContent &&
                (textContent.includes('<nfeProc') ||
                  textContent.includes('<NFe') ||
                  textContent.includes('<infNFe'))
              ) {
                xmlList.push(textContent)
              }
            } catch (_) {}
          } else if (attId) {
            let alreadyInList = false
            for (let k = 0; k < attachmentsToFetch.length; k++) {
              if (attachmentsToFetch[k].attachment_id === attId) {
                alreadyInList = true
                break
              }
            }
            if (!alreadyInList) {
              attachmentsToFetch.push({
                attachment_id: attId,
                file_name: att.filename || att.file_name || att.name || 'nfe.xml',
              })
            }
          }
        }
      }
    }

    if (Array.isArray(msg.attachments)) {
      for (let a = 0; a < msg.attachments.length; a++) {
        const att = msg.attachments[a] || {}
        const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
        const attId = att.attachmentId || att.attachment_id || att.id
        if (fn.endsWith('.xml') || fn.includes('xml')) {
          if (att.content || att.data) {
            try {
              const textContent = decodeBase64ToUtf8(att.content || att.data)
              if (
                textContent &&
                (textContent.includes('<nfeProc') ||
                  textContent.includes('<NFe') ||
                  textContent.includes('<infNFe'))
              ) {
                xmlList.push(textContent)
              }
            } catch (_) {}
          } else if (attId) {
            let alreadyInList = false
            for (let k = 0; k < attachmentsToFetch.length; k++) {
              if (attachmentsToFetch[k].attachment_id === attId) {
                alreadyInList = true
                break
              }
            }
            if (!alreadyInList) {
              attachmentsToFetch.push({
                attachment_id: attId,
                file_name: att.filename || att.file_name || att.name || 'nfe.xml',
              })
            }
          }
        }
      }
    }

    for (let f = 0; f < attachmentsToFetch.length; f++) {
      const attInfo = attachmentsToFetch[f]
      try {
        const attRes = $connectors.executeAsOwner('GMAIL_GET_ATTACHMENT', {
          message_id: msgId,
          attachment_id: attInfo.attachment_id,
          file_name: attInfo.file_name,
        })
        if (attRes && attRes.successful && attRes.data) {
          let rawAttData = ''
          let downloadUrl = ''

          if (typeof attRes.data === 'string') {
            rawAttData = attRes.data
          } else if (attRes.data && typeof attRes.data === 'object') {
            const fileObj = attRes.data.file || {}
            downloadUrl =
              fileObj.s3url ||
              fileObj.url ||
              fileObj.download_url ||
              attRes.data.s3url ||
              attRes.data.url ||
              attRes.data.download_url ||
              ''

            rawAttData =
              attRes.data.data ||
              attRes.data.content ||
              attRes.data.body ||
              (attRes.data.response &&
                (attRes.data.response.data || attRes.data.response.content)) ||
              ''
          }

          if (!rawAttData && downloadUrl) {
            try {
              const dlHttp = $http.send({
                url: downloadUrl,
                method: 'GET',
                timeout: 30,
              })
              if (dlHttp && dlHttp.statusCode >= 200 && dlHttp.statusCode < 300) {
                rawAttData = dlHttp.raw || ''
              }
            } catch (dlErr) {
              console.log('[NFE-EMAIL-ATTACH-DOWNLOAD-ERR]', String(dlErr))
            }
          }

          if (rawAttData) {
            let textContent = ''
            const rawStr = String(rawAttData).trim()
            if (
              rawStr.includes('<nfeProc') ||
              rawStr.includes('<NFe') ||
              rawStr.includes('<infNFe')
            ) {
              textContent = rawStr
            } else {
              textContent = decodeBase64ToUtf8(rawStr)
            }
            if (
              textContent &&
              (textContent.includes('<nfeProc') ||
                textContent.includes('<NFe') ||
                textContent.includes('<infNFe'))
            ) {
              xmlList.push(textContent)
            }
          }
        }
      } catch (attErr) {
        console.log('[NFE-EMAIL-ATTACH-FETCH-ERR]', String(attErr))
      }
    }

    const bodySnippet = msg.snippet || msg.body || msg.text || ''
    if (xmlList.length === 0 && bodySnippet) {
      const foundInBody = extractXmlsFromBody(bodySnippet)
      for (let b = 0; b < foundInBody.length; b++) {
        xmlList.push(foundInBody[b])
      }
    }

    const extractedKeys = []
    const ingestErrors = []
    const metaPayload = {
      sender_email: senderEmail,
      sender_name: senderName,
      subject: subject,
      email_date: emailDate,
      gmail_message_id: msgId,
    }

    for (let x = 0; x < xmlList.length; x++) {
      try {
        const res = ingestNfeXml(xmlList[x], metaPayload)
        if (res.access_key) extractedKeys.push(res.access_key)
        if (res.sender_known) senderKnown = true
        if (!res.success && res.error) ingestErrors.push(res.error)
      } catch (inEx) {
        ingestErrors.push(String(inEx))
      }
    }

    try {
      const inboxRec = existingRecord || new Record(inboxCol)
      inboxRec.set('gmail_message_id', msgId)
      inboxRec.set('gmail_thread_id', threadId)
      inboxRec.set('sender_email', senderEmail)
      inboxRec.set('sender_name', senderName)
      inboxRec.set('sender_known', senderKnown)
      inboxRec.set('subject', subject)
      inboxRec.set('email_date', emailDate)
      inboxRec.set('xml_count', xmlList.length)
      inboxRec.set('xml_keys', extractedKeys)
      inboxRec.set('processed_at', horarioBrasilia)

      if (xmlList.length > 0) {
        inboxRec.set('status', ingestErrors.length > 0 ? 'erro' : 'processado')
        if (ingestErrors.length > 0) {
          inboxRec.set('error_detail', ingestErrors.join(' | '))
        } else {
          inboxRec.set('error_detail', '')
        }
      } else {
        inboxRec.set('status', 'sem_xml')
      }

      $app.save(inboxRec)
      processedCount++
    } catch (saveInboxErr) {
      console.log('[NFE-EMAIL-INBOX-SAVE-ERR]', String(saveInboxErr))
    }
  }

  return e.json(200, {
    success: true,
    horarioBrasilia: horarioBrasilia,
    messagesFound: messages.length,
    messagesProcessed: processedCount,
  })
})
