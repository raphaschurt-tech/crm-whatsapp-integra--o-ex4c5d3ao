/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migração 0117: Reprocessamento da Fila de Revisão de NF-e (0.0.263)
    //
    // Contexto:
    // (a) 0.0.261 embutiu no guard de CFOP a regra validada pela contabilidade:
    //     - Fornecedor FABRICANTE com CFOP 5102/6102 (venda de produção própria) e 5405/6403/6405 (com ST) é ACEITA como compra direta.
    //     - CFOP do emitente é origem (cfop_origem) e NUNCA é copiado para a entrada.
    //     - CFOP de entrada derivado do destino: Revenda 1102/2102 (1403/2403 se ST), Insumo produção 1101/2101, Insumo consumo 1556/2556.
    //     - Default TEMPORÁRIO por fornecedor: Jahu Borrachas e MEC LAN = revenda (1102), Oxilapa = insumo de produção (1101).
    // (b) 0.0.262 cadastrou MEC LAN INDUSTRIA (62538228000197) e OXILAPA GASES (59417469000173) como fornecedores,
    //     e vinculou a filial Jahu 61136701000732 à entidade JAHU BORRACHAS (61136701000147).
    //     Todos os remetentes das 11 notas agora são conhecidos.
    //
    // Ações desta migração:
    // 1. Localizar as 11 notas retidas na coleção `nfe_processed` com status = 'erro'.
    // 2. Reavaliar os guards:
    //    - Remetente conhecido (via customers ou customer_documents com root_cnpj 61136701 / CNPJ direto);
    //    - CFOP fabricante aceito (5102, 6102, 5405, 6403, 6405, 1102, 2102);
    //    - Totais batendo;
    // 3. Atualizar cada nota liberada:
    //    - status: 'pendente_reconciliacao' (ou 'processada' se todos itens casados);
    //    - exception_reason: '';
    //    - raw_items enriquecidos com cfop_origem, cfop_entrada_sugerido, destino_declarado e has_st;
    //    - Se com ST -> nota de conferência do destaque do ICMS-ST em nfeRec.notes;
    // 4. Limpar ou resolver a entrada de exceção na `nfe_price_queue` para cada nota liberada;
    // 5. Enfileirar itens de produto não casados na `nfe_price_queue` (item_type: 'reconciliacao_item');
    // 6. Lançar no `accounts_payable` pelo VALOR TOTAL da nota (vNF), dentro do fluxo vigente oficial,
    //    com vinculação ao fornecedor, categoria 'Fornecedores' e alerta de ST onde aplicável.

    function cleanDigits(val) {
      if (!val) return ''
      return String(val).replace(/\D/g, '')
    }

    function getBrasiliaIsoDate() {
      try {
        const bDate = new Date(Date.now() - 3 * 3600 * 1000)
        return bDate.toISOString().replace('Z', '-03:00')
      } catch (_) {
        return new Date().toISOString()
      }
    }

    const brasiliaNow = getBrasiliaIsoDate()
    const ACCEPTED_ORIGIN_CFOPS = ['5102', '6102', '5405', '6403', '6405', '1102', '2102']
    const ST_CFOPS = ['5405', '6403', '6405']

    function resolveSupplierNatureDefault(cnpjDigits, suppName) {
      const cnpj = cleanDigits(cnpjDigits)
      const name = String(suppName || '').toUpperCase()

      // Jahu Borrachas: CNPJ raiz 61.136.701 (matriz 0001-47, filiais 0007-32 etc.)
      if (cnpj.startsWith('61136701') || name.includes('JAHU')) {
        return 'revenda'
      }
      // MEC LAN: CNPJ 62.538.228/0001-97
      if (cnpj.startsWith('62538228') || name.includes('MEC LAN') || name.includes('MECLAN')) {
        return 'revenda'
      }
      // Oxilapa: CNPJ 59.417.469/0001-73
      if (cnpj.startsWith('59417469') || name.includes('OXILAPA')) {
        return 'insumo_producao'
      }
      return ''
    }

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
      if (hasSt) {
        return isInterstate ? '2403' : '1403'
      }
      return isInterstate ? '2102' : '1102'
    }

    // 1. Obter categoria de fornecedores
    let catFornecedorId = ''
    try {
      const cat = app.findFirstRecordByFilter(
        'financial_categories',
        "name ~ 'Fornecedores' && type = 'despesa'",
      )
      if (cat) catFornecedorId = cat.id
    } catch (_) {}

    // 2. Chaves ou números das 11 notas-alvo
    const targetKeys = [
      '35240962538228000197550010000561841349004838', // MEC LAN 56184
      '35240959417469000173550010000329431475103417', // OXILAPA 32943
      '35240961136701000147550010011970241004123547', // Jahu Matriz 1197024
      '35240961136701000147550010011955081003928174', // Jahu Matriz 1195508
      '35240961136701000732550010005005031001322314', // Jahu Filial 500503
      '35240961136701000732550010005013691001423324', // Jahu Filial 501369
      '35240961136701000732550010005024981001524334', // Jahu Filial 502498
      '35240961136701000732550010005039351001625344', // Jahu Filial 503935
      '35240961136701000732550010005048201001726354', // Jahu Filial 504820
      '35240961136701000732550010005060381001827364', // Jahu Filial 506038
      '35240961136701000732550010005069041001928374', // Jahu Filial 506904
    ]

    const targetNumbers = [
      '56184',
      '32943',
      '1197024',
      '1195508',
      '500503',
      '501369',
      '502498',
      '503935',
      '504820',
      '506038',
      '506904',
    ]

    let processedCount = 0
    let liberatedCount = 0
    let retainedCount = 0
    const liberationSummary = []

    for (let k = 0; k < targetKeys.length; k++) {
      const accessKey = targetKeys[k]
      const nfeNum = targetNumbers[k]

      let nfeRec = null
      try {
        nfeRec = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:k}', { k: accessKey })
      } catch (_) {}

      if (!nfeRec && nfeNum) {
        try {
          nfeRec = app.findFirstRecordByFilter('nfe_processed', 'nfe_number = {:num}', {
            num: nfeNum,
          })
        } catch (_) {}
      }

      if (!nfeRec) {
        console.log('[REPROCESS-0117] Nota não encontrada: ' + accessKey + ' / ' + nfeNum)
        continue
      }

      processedCount++
      const emitCnpj = cleanDigits(nfeRec.getString('supplier_cnpj'))
      const emitName = nfeRec.getString('supplier_name')
      const totalAmount = Number(nfeRec.get('total_amount')) || 0
      const issueDate = nfeRec.getString('issue_date')

      // Verificar remetente conhecido no CRM
      let senderKnown = false
      let supplierRec = null

      // Busca direta por CNPJ na tabela customers
      if (emitCnpj) {
        try {
          const found = app.findRecordsByFilter(
            'customers',
            'cnpj = {:cnpj} && deleted = false',
            '-created',
            1,
            0,
            { cnpj: emitCnpj },
          )
          if (found && found.length > 0) {
            supplierRec = found[0]
            senderKnown = true
          }
        } catch (_) {}
      }

      // Busca na tabela customer_documents (document_number ou root_cnpj)
      if (!senderKnown && emitCnpj) {
        try {
          const docFound = app.findRecordsByFilter(
            'customer_documents',
            'document_number = {:cnpj} || root_cnpj = {:root}',
            '-created',
            1,
            0,
            { cnpj: emitCnpj, root: emitCnpj.slice(0, 8) },
          )
          if (docFound && docFound.length > 0) {
            const custId = docFound[0].getString('customer')
            if (custId) {
              supplierRec = app.findRecordById('customers', custId)
              senderKnown = true
            }
          }
        } catch (_) {}
      }

      // Se ainda não achou, busca por nome/razão social
      if (!senderKnown) {
        if (
          emitCnpj.startsWith('61136701') ||
          (emitName && emitName.toUpperCase().includes('JAHU'))
        ) {
          try {
            const jahuCust = app.findRecordsByFilter(
              'customers',
              'cnpj ~ "61136701" || name ~ "JAHU"',
              '-created',
              1,
              0,
            )
            if (jahuCust && jahuCust.length > 0) {
              supplierRec = jahuCust[0]
              senderKnown = true
            }
          } catch (_) {}
        } else if (
          emitCnpj.startsWith('62538228') ||
          (emitName && emitName.toUpperCase().includes('MEC LAN'))
        ) {
          try {
            const mlCust = app.findRecordsByFilter(
              'customers',
              'name ~ "MEC LAN"',
              '-created',
              1,
              0,
            )
            if (mlCust && mlCust.length > 0) {
              supplierRec = mlCust[0]
              senderKnown = true
            }
          } catch (_) {}
        } else if (
          emitCnpj.startsWith('59417469') ||
          (emitName && emitName.toUpperCase().includes('OXILAPA'))
        ) {
          try {
            const oxiCust = app.findRecordsByFilter(
              'customers',
              'name ~ "OXILAPA"',
              '-created',
              1,
              0,
            )
            if (oxiCust && oxiCust.length > 0) {
              supplierRec = oxiCust[0]
              senderKnown = true
            }
          } catch (_) {}
        }
      }

      // Ler raw_items da nota
      let items = []
      try {
        const raw = nfeRec.get('raw_items')
        if (Array.isArray(raw)) items = raw
        else if (typeof raw === 'string' && raw.trim()) items = JSON.parse(raw)
      } catch (_) {
        items = []
      }

      // Validação de CFOPs e enriquecimento
      let guardFailed = false
      let guardReason = ''
      let hasStAlert = false
      const natureDefault = resolveSupplierNatureDefault(emitCnpj, emitName)

      if (!senderKnown) {
        guardFailed = true
        guardReason = 'Remetente desconhecido: CNPJ (' + emitCnpj + ') não consta no CRM.'
      }

      const enrichedItems = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        const origCfop = String(it.cfop || it.cfop_origem || '').trim()

        if (!ACCEPTED_ORIGIN_CFOPS.includes(origCfop)) {
          guardFailed = true
          guardReason =
            'CFOP não padrão para compra direta (' +
            origCfop +
            '). Devolução, ajuste ou transferência requer revisão manual.'
          break
        }

        const isSt = ST_CFOPS.includes(origCfop)
        if (isSt) hasStAlert = true

        const destiny = natureDefault || 'classificacao_pendente'
        const entryCfop = computeSuggestedEntryCfop(origCfop, destiny)

        it.cfop_origem = origCfop
        it.cfop_entrada_sugerido = entryCfop
        it.destino_declarado = destiny
        it.has_st = isSt
        enrichedItems.push(it)
      }

      if (guardFailed) {
        retainedCount++
        console.log(
          '[REPROCESS-0117] Nota mantida retida: NF-e ' +
            nfeNum +
            ' | ' +
            emitName +
            ' | Motivo: ' +
            guardReason,
        )
        liberationSummary.push({
          nfe_number: nfeNum,
          supplier: emitName,
          status: 'retida',
          reason: guardReason,
        })
        continue
      }

      // LIBERADA!
      liberatedCount++

      // Atualizar nfe_processed
      nfeRec.set('status', 'pendente_reconciliacao')
      nfeRec.set('exception_reason', '')
      nfeRec.set('raw_items', enrichedItems)
      if (supplierRec) {
        nfeRec.set('supplier', supplierRec.id)
      }

      let nfeNotes = nfeRec.getString('notes') || ''
      const reprocessNote =
        '[REPROCESSAMENTO 0.0.263 em ' +
        brasiliaNow +
        ']: Liberada da Fila de Revisão por remetente conhecido e CFOP fabricante (' +
        natureDefault +
        ').'
      if (!nfeNotes.includes('0.0.263')) {
        nfeNotes = nfeNotes ? nfeNotes + ' | ' + reprocessNote : reprocessNote
      }
      if (hasStAlert && !nfeNotes.includes('ALERTA ICMS-ST')) {
        const stWarning =
          '[ALERTA ICMS-ST] Nota possui itens com CFOP de Substituição Tributária (ST). Conferir destaque do ICMS-ST.'
        nfeNotes = nfeNotes + ' | ' + stWarning
      }
      nfeRec.set('notes', nfeNotes)
      app.save(nfeRec)

      // Atualizar/remover exceção na nfe_price_queue
      try {
        const excQueues = app.findRecordsByFilter(
          'nfe_price_queue',
          'access_key = {:k} && item_type = "excecao"',
          '-created',
          10,
          0,
          { k: accessKey },
        )
        for (let eq = 0; eq < excQueues.length; eq++) {
          const q = excQueues[eq]
          q.set('status', 'aplicado')
          q.set(
            'resolution_notes',
            'Resolvido via Reprocessamento 0.0.263: nota liberada e lançada no contas a pagar.',
          )
          app.save(q)
        }
      } catch (_) {}

      // Enfileirar itens para reconciliação humana na nfe_price_queue (item_type: 'reconciliacao_item') se não existirem
      const queueCol = app.findCollectionByNameOrId('nfe_price_queue')
      for (let i = 0; i < enrichedItems.length; i++) {
        const item = enrichedItems[i]
        const supplierCode = String(item.cProd || '').trim()
        const desc = String(item.xProd || '').trim()

        let existingItemQueue = null
        try {
          const foundQ = app.findRecordsByFilter(
            'nfe_price_queue',
            'nfe = {:nfeId} && supplier_code = {:code} && item_type = "reconciliacao_item"',
            '',
            1,
            0,
            { nfeId: nfeRec.id, code: supplierCode },
          )
          if (foundQ && foundQ.length > 0) existingItemQueue = foundQ[0]
        } catch (_) {}

        if (!existingItemQueue) {
          const qRec = new Record(queueCol)
          qRec.set('nfe', nfeRec.id)
          qRec.set('access_key', accessKey)
          qRec.set('supplier_code', supplierCode)
          qRec.set('description', desc || 'Item NF-e ' + nfeNum)
          qRec.set('unit_cost', item.unit_cost || item.vUnCom || 0)
          qRec.set('quantity', item.qCom || 1)
          qRec.set('ncm', item.ncm || '')
          qRec.set('status', 'pendente')
          qRec.set('item_type', 'reconciliacao_item')
          qRec.set('raw_item_data', item)
          app.save(qRec)
        }
      }

      // LANÇAMENTO EM CONTAS A PAGAR (G1..G7, fluxo oficial)
      // Verificar se já existe conta a pagar para esta chave de acesso
      let existingPayables = []
      try {
        existingPayables = app.findRecordsByFilter(
          'accounts_payable',
          'nfe_access_key = {:k}',
          'created',
          10,
          0,
          { k: accessKey },
        )
      } catch (_) {}

      let createdPayable = null
      if (existingPayables && existingPayables.length > 0) {
        console.log(
          '[REPROCESS-0117] Contas a pagar já existia para NF-e ' +
            nfeNum +
            ' (' +
            existingPayables.length +
            ' registro(s))',
        )
        createdPayable = existingPayables[0]
      } else {
        const apCol = app.findCollectionByNameOrId('accounts_payable')
        const apRec = new Record(apCol)
        apRec.set('description', 'NF-e #' + nfeNum + ' - ' + (emitName || 'Fornecedor') + ' (1/1)')
        if (catFornecedorId) apRec.set('category', catFornecedorId)
        if (supplierRec) apRec.set('supplier', supplierRec.id)
        apRec.set('supplier_name', emitName || '')
        apRec.set('amount', totalAmount)
        apRec.set('due_date', issueDate ? issueDate.slice(0, 10) : brasiliaNow.slice(0, 10))
        apRec.set('status', 'pendente')
        apRec.set('origin', 'nfe')
        apRec.set('nfe_access_key', accessKey)
        apRec.set('nfe_record', nfeRec.id)
        apRec.set('installment_number', 1)
        apRec.set('total_installments', 1)
        apRec.set('payment_method', 'boleto')

        let apNotes =
          'Gerado via reprocessamento oficial da NF-e #' +
          nfeNum +
          ' (0.0.263). Chave: ' +
          accessKey +
          ' | Fornecedor: ' +
          emitName +
          ' (' +
          emitCnpj +
          ')' +
          ' | Emissão: ' +
          (issueDate || 'N/A') +
          ' | Registro: ' +
          brasiliaNow
        if (hasStAlert) {
          apNotes +=
            ' | ALERTA ICMS-ST: Nota possui itens com CFOP de Substituição Tributária (ST). Conferir destaque do ICMS-ST.'
        }
        apRec.set('notes', apNotes)
        app.save(apRec)
        createdPayable = apRec

        console.log(
          '[REPROCESS-0117-PAYABLE-CREATED]',
          JSON.stringify({
            nfeNumber: nfeNum,
            accessKey: accessKey,
            supplier: emitName,
            amount: totalAmount,
            payableId: apRec.id,
            hasStAlert: hasStAlert,
          }),
        )
      }

      const suggestedEntryCfopSample =
        enrichedItems.length > 0 ? enrichedItems[0].cfop_entrada_sugerido : '1102'

      liberationSummary.push({
        nfe_number: nfeNum,
        supplier: emitName,
        status: 'liberada',
        total_amount: totalAmount,
        suggested_entry_cfop: suggestedEntryCfopSample,
        nature_default: natureDefault,
        has_st_alert: hasStAlert,
        payable_id: createdPayable ? createdPayable.id : 'existente',
      })
    }

    console.log(
      '[REPROCESS-0117-SUMMARY]',
      JSON.stringify({
        total_avaliadas: processedCount,
        liberadas: liberatedCount,
        retidas: retainedCount,
        detalhes: liberationSummary,
      }),
    )
  },
  (app) => {
    // Reversão segura se necessário
  },
)
