// pocketbase/hooks/nfe_email_inbox.js
// Pipeline de Entrada de NF-e por Email (Gmail da empresa, modo OWNER)
// Cron periódico a cada 15 minutos
// Regra permanente: Todos os registros e logs com horário de Brasília (UTC-3).
// Regra da fase: TUDO para a Fila de Revisão (isException = true, nunca cria accounts_payable).
// Todos os helpers e lógica são estritamente INLINE dentro de cada callback para compatibilidade com o VM pool do PocketBase.

// 1. Cron Add: Executa a cada 15 minutos
cronAdd('nfe-email-inbox-poller', '*/15 * * * *', () => {
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

    if (!supplierRec && parsed.emitCnpj) {
      try {
        const custCol = $app.findCollectionByNameOrId('customers')
        const newSupp = new Record(custCol)
        newSupp.set('name', parsed.emitName || 'Fornecedor CNPJ ' + parsed.emitCnpj)
        newSupp.set('company', parsed.emitName || '')
        newSupp.set('cnpj', parsed.emitCnpj)
        newSupp.set('email', senderEmail || '')
        newSupp.set('type', 'PJ')
        newSupp.set('customer_type', 'Fornecedor')
        newSupp.set('source', 'nfe_email_inbox')
        newSupp.set('notes', 'Cadastrado automaticamente via entrada de NF-e por Email.')
        $app.save(newSupp)
        supplierRec = newSupp
      } catch (suppErr) {
        console.log('[NFE-EMAIL-SUPPLIER-CREATE-ERR]', String(suppErr))
      }
    }

    let companyCnpj = ''
    try {
      const s = $app.findFirstRecordByFilter('settings', "id != ''")
      if (s) {
        companyCnpj = cleanDigits(s.getString('company_cnpj') || '')
      }
    } catch (_) {}

    const guardReasons = []
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
          ').',
      )
    }

    if (!parsed.cStat || (parsed.cStat !== '100' && parsed.cStat !== '150')) {
      guardReasons.push(
        'NF-e não autorizada ou sem protocolo válido (cStat=' +
          (parsed.cStat || 'ausente') +
          ' - ' +
          (parsed.xMotivo || 'N/A') +
          ').',
      )
    }

    for (let c = 0; c < parsed.items.length; c++) {
      const itCfop = String(parsed.items[c].cfop || '').trim()
      if (itCfop !== '1102' && itCfop !== '2102') {
        guardReasons.push('CFOP não padrão para compra direta (' + itCfop + ').')
        break
      }
    }

    let sumItems = 0
    for (let s = 0; s < parsed.items.length; s++) {
      sumItems += parsed.items[s].vProd
    }
    const diff = Math.abs(sumItems - parsed.itemsTotal)
    if (diff > 0.05 && parsed.itemsTotal > 0) {
      guardReasons.push(
        'Inconsistência de totais: soma ' +
          sumItems.toFixed(2) +
          ' != total ' +
          parsed.itemsTotal.toFixed(2) +
          '.',
      )
    }

    // REGRA DA FASE: TUDO para Fila de Revisão, NUNCA cria accounts_payable
    let exceptionReason =
      'Entrada por email (Gmail): fase de validação — lançamento manual após revisão.'
    if (guardReasons.length > 0) {
      exceptionReason = guardReasons.join(' | ') + ' | ' + exceptionReason
    }

    let emailTrail =
      'Origem: email | De: ' +
      (senderEmail || senderName || 'Desconhecido') +
      ' | Assunto: ' +
      (subject || 'Sem assunto') +
      ' | Data do email: ' +
      (emailDate || brasiliaNow)
    if (!senderKnown) {
      const alertMsg =
        'ALERTA: Remetente não consta como fornecedor/contato conhecido do CRM — verifique a origem do XML.'
      emailTrail += ' | ' + alertMsg
      exceptionReason = alertMsg + ' | ' + exceptionReason
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
    nfeRec.set('xml_payload', xmlContent)
    nfeRec.set('notes', emailTrail)
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
    qRec.set('description', 'Nota recebida por email: ' + exceptionReason)
    qRec.set('status', 'pendente')
    qRec.set('item_type', 'excecao')
    qRec.set('resolution_notes', emailTrail)
    $app.save(qRec)

    console.log(
      '[NFE-EMAIL-INGESTED]',
      JSON.stringify({
        horarioBrasilia: brasiliaNow,
        accessKey: accessKey,
        nfeNumber: parsed.nfeNumber,
        totalAmount: parsed.totalAmount,
        senderKnown: senderKnown,
        senderEmail: senderEmail,
        messageId: gmailMsgId,
        nfeId: nfeRec.id,
        status: 'erro_fila_revisao',
      }),
    )

    return {
      success: true,
      access_key: accessKey,
      nfe_number: parsed.nfeNumber,
      nfe_id: nfeRec.id,
      sender_known: senderKnown,
      status: 'fila_revisao',
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
        query: 'filename:xml OR "xml" OR "nfe" OR "danfe"',
        max_results: 20,
        include_payload: true,
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
          error: fetchRes ? fetchRes.error : 'Resposta vazia do conector Gmail',
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

      let alreadyProcessed = false
      try {
        const existing = $app.findFirstRecordByFilter(
          'nfe_email_inbox',
          'gmail_message_id = {:mid}',
          { mid: msgId },
        )
        if (existing) {
          alreadyProcessed = true
        }
      } catch (_) {}

      if (alreadyProcessed) continue

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
          const fn = (part.filename || part.file_name || '').toLowerCase()
          const mime = (part.mimeType || part.mime_type || '').toLowerCase()
          const bodyObj = part.body || {}

          if (fn.endsWith('.xml') || mime.includes('xml')) {
            if (bodyObj.data && typeof bodyObj.data === 'string') {
              try {
                let cleanB64 = bodyObj.data.replace(/-/g, '+').replace(/_/g, '/')
                while (cleanB64.length % 4 !== 0) cleanB64 += '='
                const decodedBytes = $security.parseBase64(cleanB64)
                let textContent = ''
                if (decodedBytes && typeof decodedBytes.length === 'number') {
                  try {
                    textContent = String.fromCharCode.apply(null, decodedBytes)
                  } catch (_) {
                    textContent = ''
                  }
                }
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
              attachmentsToFetch.push({
                attachment_id: bodyObj.attachmentId || part.attachment_id || part.attachmentId,
                file_name: part.filename || part.file_name || 'nfe.xml',
              })
            }
          }

          if (part.parts) {
            searchParts(part.parts)
          }
        }
      }

      if (msg.payload && msg.payload.parts) {
        searchParts(msg.payload.parts)
      } else if (Array.isArray(msg.attachments)) {
        for (let a = 0; a < msg.attachments.length; a++) {
          const att = msg.attachments[a]
          const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
          if (fn.endsWith('.xml')) {
            if (att.content || att.data) {
              try {
                let b64 = att.content || att.data
                let cleanB64 = b64.replace(/-/g, '+').replace(/_/g, '/')
                while (cleanB64.length % 4 !== 0) cleanB64 += '='
                const decodedBytes = $security.parseBase64(cleanB64)
                const textContent = String.fromCharCode.apply(null, decodedBytes)
                if (textContent) xmlList.push(textContent)
              } catch (_) {}
            } else if (att.attachment_id || att.id) {
              attachmentsToFetch.push({
                attachment_id: att.attachment_id || att.id,
                file_name: att.filename || att.file_name || 'nfe.xml',
              })
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
            const rawAttData = attRes.data.data || attRes.data.content || attRes.data.file || ''
            if (rawAttData) {
              let cleanB64 = String(rawAttData).replace(/-/g, '+').replace(/_/g, '/')
              while (cleanB64.length % 4 !== 0) cleanB64 += '='
              const decodedBytes = $security.parseBase64(cleanB64)
              const textContent = String.fromCharCode.apply(null, decodedBytes)
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
        const inboxRec = new Record(inboxCol)
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
routerAdd(
  'POST',
  '/backend/v1/nfe/email-inbox/sync',
  (e) => {
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

      if (!supplierRec && parsed.emitCnpj) {
        try {
          const custCol = $app.findCollectionByNameOrId('customers')
          const newSupp = new Record(custCol)
          newSupp.set('name', parsed.emitName || 'Fornecedor CNPJ ' + parsed.emitCnpj)
          newSupp.set('company', parsed.emitName || '')
          newSupp.set('cnpj', parsed.emitCnpj)
          newSupp.set('email', senderEmail || '')
          newSupp.set('type', 'PJ')
          newSupp.set('customer_type', 'Fornecedor')
          newSupp.set('source', 'nfe_email_inbox')
          newSupp.set('notes', 'Cadastrado automaticamente via entrada de NF-e por Email.')
          $app.save(newSupp)
          supplierRec = newSupp
        } catch (suppErr) {
          console.log('[NFE-EMAIL-SUPPLIER-CREATE-ERR]', String(suppErr))
        }
      }

      let companyCnpj = ''
      try {
        const s = $app.findFirstRecordByFilter('settings', "id != ''")
        if (s) {
          companyCnpj = cleanDigits(s.getString('company_cnpj') || '')
        }
      } catch (_) {}

      const guardReasons = []
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
            ').',
        )
      }

      if (!parsed.cStat || (parsed.cStat !== '100' && parsed.cStat !== '150')) {
        guardReasons.push(
          'NF-e não autorizada ou sem protocolo válido (cStat=' +
            (parsed.cStat || 'ausente') +
            ' - ' +
            (parsed.xMotivo || 'N/A') +
            ').',
        )
      }

      for (let c = 0; c < parsed.items.length; c++) {
        const itCfop = String(parsed.items[c].cfop || '').trim()
        if (itCfop !== '1102' && itCfop !== '2102') {
          guardReasons.push('CFOP não padrão para compra direta (' + itCfop + ').')
          break
        }
      }

      let sumItems = 0
      for (let s = 0; s < parsed.items.length; s++) {
        sumItems += parsed.items[s].vProd
      }
      const diff = Math.abs(sumItems - parsed.itemsTotal)
      if (diff > 0.05 && parsed.itemsTotal > 0) {
        guardReasons.push(
          'Inconsistência de totais: soma ' +
            sumItems.toFixed(2) +
            ' != total ' +
            parsed.itemsTotal.toFixed(2) +
            '.',
        )
      }

      let exceptionReason =
        'Entrada por email (Gmail): fase de validação — lançamento manual após revisão.'
      if (guardReasons.length > 0) {
        exceptionReason = guardReasons.join(' | ') + ' | ' + exceptionReason
      }

      let emailTrail =
        'Origem: email | De: ' +
        (senderEmail || senderName || 'Desconhecido') +
        ' | Assunto: ' +
        (subject || 'Sem assunto') +
        ' | Data do email: ' +
        (emailDate || brasiliaNow)
      if (!senderKnown) {
        const alertMsg =
          'ALERTA: Remetente não consta como fornecedor/contato conhecido do CRM — verifique a origem do XML.'
        emailTrail += ' | ' + alertMsg
        exceptionReason = alertMsg + ' | ' + exceptionReason
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
      nfeRec.set('xml_payload', xmlContent)
      nfeRec.set('notes', emailTrail)
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
      qRec.set('description', 'Nota recebida por email: ' + exceptionReason)
      qRec.set('status', 'pendente')
      qRec.set('item_type', 'excecao')
      qRec.set('resolution_notes', emailTrail)
      $app.save(qRec)

      console.log(
        '[NFE-EMAIL-INGESTED]',
        JSON.stringify({
          horarioBrasilia: brasiliaNow,
          accessKey: accessKey,
          nfeNumber: parsed.nfeNumber,
          totalAmount: parsed.totalAmount,
          senderKnown: senderKnown,
          senderEmail: senderEmail,
          messageId: gmailMsgId,
          nfeId: nfeRec.id,
          status: 'erro_fila_revisao',
        }),
      )

      return {
        success: true,
        access_key: accessKey,
        nfe_number: parsed.nfeNumber,
        nfe_id: nfeRec.id,
        sender_known: senderKnown,
        status: 'fila_revisao',
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
        query: 'filename:xml OR "xml" OR "nfe" OR "danfe"',
        max_results: 20,
        include_payload: true,
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
        error: fetchRes ? fetchRes.error : 'Resposta inválida do conector Gmail',
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

      let alreadyProcessed = false
      try {
        const existing = $app.findFirstRecordByFilter(
          'nfe_email_inbox',
          'gmail_message_id = {:mid}',
          { mid: msgId },
        )
        if (existing) {
          alreadyProcessed = true
        }
      } catch (_) {}

      if (alreadyProcessed) continue

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
          const fn = (part.filename || part.file_name || '').toLowerCase()
          const mime = (part.mimeType || part.mime_type || '').toLowerCase()
          const bodyObj = part.body || {}

          if (fn.endsWith('.xml') || mime.includes('xml')) {
            if (bodyObj.data && typeof bodyObj.data === 'string') {
              try {
                let cleanB64 = bodyObj.data.replace(/-/g, '+').replace(/_/g, '/')
                while (cleanB64.length % 4 !== 0) cleanB64 += '='
                const decodedBytes = $security.parseBase64(cleanB64)
                let textContent = ''
                if (decodedBytes && typeof decodedBytes.length === 'number') {
                  try {
                    textContent = String.fromCharCode.apply(null, decodedBytes)
                  } catch (_) {
                    textContent = ''
                  }
                }
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
              attachmentsToFetch.push({
                attachment_id: bodyObj.attachmentId || part.attachment_id || part.attachmentId,
                file_name: part.filename || part.file_name || 'nfe.xml',
              })
            }
          }

          if (part.parts) {
            searchParts(part.parts)
          }
        }
      }

      if (msg.payload && msg.payload.parts) {
        searchParts(msg.payload.parts)
      } else if (Array.isArray(msg.attachments)) {
        for (let a = 0; a < msg.attachments.length; a++) {
          const att = msg.attachments[a]
          const fn = (att.filename || att.file_name || att.name || '').toLowerCase()
          if (fn.endsWith('.xml')) {
            if (att.content || att.data) {
              try {
                let b64 = att.content || att.data
                let cleanB64 = b64.replace(/-/g, '+').replace(/_/g, '/')
                while (cleanB64.length % 4 !== 0) cleanB64 += '='
                const decodedBytes = $security.parseBase64(cleanB64)
                const textContent = String.fromCharCode.apply(null, decodedBytes)
                if (textContent) xmlList.push(textContent)
              } catch (_) {}
            } else if (att.attachment_id || att.id) {
              attachmentsToFetch.push({
                attachment_id: att.attachment_id || att.id,
                file_name: att.filename || att.file_name || 'nfe.xml',
              })
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
            const rawAttData = attRes.data.data || attRes.data.content || attRes.data.file || ''
            if (rawAttData) {
              let cleanB64 = String(rawAttData).replace(/-/g, '+').replace(/_/g, '/')
              while (cleanB64.length % 4 !== 0) cleanB64 += '='
              const decodedBytes = $security.parseBase64(cleanB64)
              const textContent = String.fromCharCode.apply(null, decodedBytes)
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
        const inboxRec = new Record(inboxCol)
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
  },
  $apis.requireAuth(),
)
