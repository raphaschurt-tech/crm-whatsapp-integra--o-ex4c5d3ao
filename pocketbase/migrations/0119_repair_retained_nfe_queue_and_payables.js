/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migração 0119: REPARO DEFINITIVO — Efeito da 0117 nos Dados Reais das 11 Notas
    //
    // Contexto e Diagnóstico:
    // A migração 0117 executou sem erro mas buscou chaves de acesso com ano '2409'
    // (ex: 352409...) geradas por erro de mock/cópia, enquanto as 11 notas reais no banco
    // foram gravadas com o ano correto '2609'/'2610' (ex: 352609... / 352610...).
    // Por conta disso, findFirstRecordByFilter não encontrou as notas pelas chaves antigas,
    // o fallback por nfe_number falhou em algumas e os registros não foram atualizados.
    //
    // Ações desta migração 0119:
    // 1. Criar formalmente a coluna `cfop_entrada_sugerido` em `nfe_processed` caso ainda não exista.
    // 2. Reclassificar as 11 notas reais no banco:
    //    - status: 'pendente_reconciliacao'
    //    - exception_reason: '' (limpa mensagens antigas)
    //    - supplier: vinculado ao fornecedor correto (Jahu ukuwsuetw0d3p2m, MEC LAN bwd7wotwwizccnn, Oxilapa klma9h4msc1nsw3)
    //    - raw_items: enriquecidos preservando `cfop_origem` (5102) em campo separado, adicionando `cfop_entrada_sugerido`
    //      (1102 para Jahu e MEC LAN revenda; 1101 para Oxilapa insumo_producao)
    //    - cfop_entrada_sugerido na coluna da nota (1102 / 1101)
    // 3. Criar as 11 Contas a Pagar em `accounts_payable`:
    //    - Uma por nota, origin='nfe', status='pendente', category='Fornecedores'
    //    - nfe_access_key de 44 dígitos exata da nota real
    //    - nfe_record vinculado ao ID da nota
    //    - Idempotência: deduplica por nfe_access_key antes de inserir.

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

    // 1. Criar coluna cfop_entrada_sugerido em nfe_processed se não existir
    try {
      const nfeCol = app.findCollectionByNameOrId('nfe_processed')
      if (!nfeCol.fields.getByName('cfop_entrada_sugerido')) {
        nfeCol.fields.add(
          new TextField({
            name: 'cfop_entrada_sugerido',
            required: false,
          }),
        )
        app.save(nfeCol)
        console.log('[MIGRATION-0119] Coluna cfop_entrada_sugerido criada em nfe_processed.')
      }
    } catch (err) {
      console.log('[MIGRATION-0119-COL-ERR]', err.message || String(err))
    }

    // 2. Categoria Fornecedores em financial_categories
    let catFornecedorId = ''
    try {
      const cat = app.findFirstRecordByFilter(
        'financial_categories',
        "name ~ 'Fornecedores' && type = 'despesa'",
      )
      if (cat) {
        catFornecedorId = cat.id
      } else {
        const anyCat = app.findFirstRecordByFilter('financial_categories', "type = 'despesa'")
        if (anyCat) catFornecedorId = anyCat.id
      }
    } catch (_) {}

    // 3. Fornecedores conhecidos
    const SUPPLIER_MAP = {
      JAHU: 'ukuwsuetw0d3p2m',
      MECLAN: 'bwd7wotwwizccnn',
      OXILAPA: 'klma9h4msc1nsw3',
    }

    // 4. As 11 notas-alvo com suas chaves de acesso reais de 44 dígitos
    const TARGET_NFES = [
      {
        access_key: '35261061136701000147550010011955081731581098',
        nfe_number: '1195508',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35261061136701000147550010011970241843930987',
        nfe_number: '1197024',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35261059417469000173550010000329431406428669',
        nfe_number: '32943',
        supplier_id: SUPPLIER_MAP.OXILAPA,
        nature: 'insumo_producao',
        expected_entry_cfop: '1101',
      },
      {
        access_key: '35260961136701000732550010005005031273283880',
        nfe_number: '500503',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35260961136701000732550010005013691913994109',
        nfe_number: '501369',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35260961136701000732550010005024981994937196',
        nfe_number: '502498',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35260961136701000732550010005039351330899154',
        nfe_number: '503935',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35260961136701000732550010005048201698057487',
        nfe_number: '504820',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35260961136701000732550010005060381548219210',
        nfe_number: '506038',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35261061136701000732550010005069041294114447',
        nfe_number: '506904',
        supplier_id: SUPPLIER_MAP.JAHU,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
      {
        access_key: '35261062538228000197550010000561841438996935',
        nfe_number: '56184',
        supplier_id: SUPPLIER_MAP.MECLAN,
        nature: 'revenda',
        expected_entry_cfop: '1102',
      },
    ]

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

    let nfeUpdatedCount = 0
    let payablesCreatedCount = 0
    let totalPayablesAmount = 0
    const summaryRows = []

    for (let i = 0; i < TARGET_NFES.length; i++) {
      const target = TARGET_NFES[i]

      let nfeRec = null
      try {
        nfeRec = app.findFirstRecordByFilter('nfe_processed', 'access_key = {:key}', {
          key: target.access_key,
        })
      } catch (_) {}

      if (!nfeRec) {
        try {
          nfeRec = app.findFirstRecordByFilter('nfe_processed', 'nfe_number = {:num}', {
            num: target.nfe_number,
          })
        } catch (_) {}
      }

      if (!nfeRec) {
        console.log(
          '[MIGRATION-0119-WARN] Nota não encontrada:',
          target.nfe_number,
          target.access_key,
        )
        continue
      }

      const totalAmount = Number(nfeRec.get('total_amount')) || 0
      const emitName = nfeRec.getString('supplier_name') || ''
      const emitCnpj = cleanDigits(nfeRec.getString('supplier_cnpj'))
      const issueDate = nfeRec.getString('issue_date') || ''

      // Ler raw_items
      let items = []
      try {
        const raw = nfeRec.get('raw_items')
        if (Array.isArray(raw)) items = raw
        else if (typeof raw === 'string' && raw.trim()) items = JSON.parse(raw)
      } catch (_) {
        items = []
      }

      // Enriquecer items preservando cfop_origem (5102) à parte
      const enrichedItems = []
      let hasStAlert = false
      for (let j = 0; j < items.length; j++) {
        const it = items[j]
        const origCfop = String(it.cfop || it.cfop_origem || '5102').trim()
        const isSt = ST_CFOPS.includes(origCfop)
        if (isSt) hasStAlert = true

        const destiny = target.nature
        const entryCfop = computeSuggestedEntryCfop(origCfop, destiny)

        it.cfop_origem = origCfop
        it.cfop_entrada_sugerido = entryCfop
        it.destino_declarado = destiny
        it.has_st = isSt
        enrichedItems.push(it)
      }

      // Atualizar nfe_processed
      nfeRec.set('status', 'pendente_reconciliacao')
      nfeRec.set('exception_reason', '')
      nfeRec.set('raw_items', enrichedItems)
      nfeRec.set('cfop_entrada_sugerido', target.expected_entry_cfop)
      if (target.supplier_id) {
        nfeRec.set('supplier', target.supplier_id)
      }

      let nfeNotes = nfeRec.getString('notes') || ''
      const reprocessNote =
        '[REPARO 0119 em ' +
        brasiliaNow +
        ']: Liberada da Fila de Revisão. Remetente conhecido. CFOP de entrada sugerido ' +
        target.expected_entry_cfop +
        ' pela natureza ' +
        target.nature +
        '.'
      if (!nfeNotes.includes('REPARO 0119')) {
        nfeNotes = nfeNotes ? nfeNotes + ' | ' + reprocessNote : reprocessNote
      }
      nfeRec.set('notes', nfeNotes)
      app.save(nfeRec)
      nfeUpdatedCount++

      // Idempotência: verificar se conta a pagar já existe para esta access_key
      let existingAp = null
      try {
        const aps = app.findRecordsByFilter(
          'accounts_payable',
          'nfe_access_key = {:key}',
          '-created',
          1,
          0,
          { key: target.access_key },
        )
        if (aps && aps.length > 0) existingAp = aps[0]
      } catch (_) {}

      let apId = ''
      if (!existingAp) {
        const apCol = app.findCollectionByNameOrId('accounts_payable')
        const apRec = new Record(apCol)
        apRec.set('description', 'NF-e #' + target.nfe_number + ' - ' + emitName + ' (1/1)')
        if (catFornecedorId) apRec.set('category', catFornecedorId)
        if (target.supplier_id) apRec.set('supplier', target.supplier_id)
        apRec.set('supplier_name', emitName)
        apRec.set('amount', totalAmount)
        apRec.set('due_date', issueDate ? issueDate.slice(0, 10) : brasiliaNow.slice(0, 10))
        apRec.set('status', 'pendente')
        apRec.set('origin', 'nfe')
        apRec.set('nfe_access_key', target.access_key)
        apRec.set('nfe_record', nfeRec.id)
        apRec.set('installment_number', 1)
        apRec.set('total_installments', 1)
        apRec.set('payment_method', 'boleto')

        let apNotes =
          'Gerado via reparo 0119 da NF-e #' +
          target.nfe_number +
          '. Chave: ' +
          target.access_key +
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
          apNotes += ' | ALERTA ICMS-ST: Conferir destaque.'
        }
        apRec.set('notes', apNotes)
        app.save(apRec)
        apId = apRec.id
        payablesCreatedCount++
        totalPayablesAmount += totalAmount
      } else {
        apId = existingAp.id
        totalPayablesAmount += totalAmount
      }

      summaryRows.push({
        nfe_number: target.nfe_number,
        access_key: target.access_key,
        supplier: emitName,
        nature: target.nature,
        suggested_entry_cfop: target.expected_entry_cfop,
        amount: totalAmount,
        ap_id: apId,
      })
    }

    console.log(
      '[MIGRATION-0119-DONE]',
      JSON.stringify({
        nfe_updated: nfeUpdatedCount,
        payables_created: payablesCreatedCount,
        total_payables_amount: Number(totalPayablesAmount.toFixed(2)),
        summary: summaryRows,
      }),
    )
  },
  (app) => {
    // Reversão
  },
)
