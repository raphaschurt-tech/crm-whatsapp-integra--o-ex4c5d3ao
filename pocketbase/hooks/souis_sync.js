// Hook de sincronização de produtos da SOU.IS (SQL Server View VW_PRODUTO_PRECO_ESTOQUE)
// Suporta execução via Bridge HTTP / Microserviço ou payload direto de sincronização
// Regras de negócio implementadas:
// 1. Cada produto na View vem em 2 linhas (uma com lista_preco '110%' e outra com '130%')
// 2. Colunas da View: COD_PROD, NOME_PROD, lista_preco, preço, saldo_prod
// 3. Saldo NULL ou ausente -> tratado como 0 (sem estoque)
// 4. Registros de teste como 'duplicidade', 'não usar', 'Tabela Simulação de preço' -> filtrados/ignorados
// 5. Tabela 130% definida como custo e preço base de venda
// 6. Tabela 110% armazenada em price_110 como alternativa
// 7. Produtos espelhados na coleção 'products' com fornecedor 'SOU.IS' e is_purchased = true

routerAdd('POST', '/backend/v1/souis/sync', (e) => {
  let reqData = {}
  try {
    reqData = e.requestInfo().body || {}
  } catch (_) {
    reqData = {}
  }

  let rows = []

  // Opção A: Payload enviado diretamente na requisição (ex: teste piloto ou push da bridge)
  if (reqData.rows && Array.isArray(reqData.rows)) {
    rows = reqData.rows
  } else {
    // Opção B: Tentar consultar a bridge configurada
    let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
    let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
    if (!bridgeUrl) {
      try {
        const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
        if (setting) {
          const rawUrl = setting.getString('stock_api_url')
          if (rawUrl && (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)) {
            bridgeUrl = rawUrl
          }
        }
      } catch (_) {}
    }

    if (bridgeUrl) {
      // Normalizar URL da bridge: se terminar com barra, remover
      if (bridgeUrl.endsWith('/')) {
        bridgeUrl = bridgeUrl.slice(0, -1)
      }
      // Se a URL informada não tiver rota, apontar para /produtos/all
      let targetUrl = bridgeUrl
      if (!targetUrl.includes('/produtos')) {
        targetUrl = targetUrl + '/produtos/all'
      }

      const headers = {
        'Content-Type': 'application/json',
      }
      if (bridgeToken) {
        headers['X-Bridge-Token'] = bridgeToken
      }

      try {
        const bridgeRes = $http.send({
          url: targetUrl,
          method: 'GET',
          headers: headers,
          timeout: 45,
        })
        if (bridgeRes.statusCode === 200 && bridgeRes.json) {
          rows = Array.isArray(bridgeRes.json)
            ? bridgeRes.json
            : bridgeRes.json.rows || bridgeRes.json.data || []
        } else {
          return e.json(502, {
            success: false,
            error: 'Bridge HTTP retornou status ' + bridgeRes.statusCode,
            details: bridgeRes.body,
            target_url: targetUrl,
          })
        }
      } catch (errBridge) {
        return e.json(502, {
          success: false,
          error: 'Falha ao conectar com bridge HTTP SOU.IS: ' + String(errBridge),
          target_url: targetUrl,
        })
      }
    } else {
      // Se não há rows no body nem SOIS_BRIDGE_URL configurada:
      // Executar teste de conectividade para diagnosticar o estado do SQL Server
      const host = $os.getenv('SOIS_DB_HOST') || 'db2.sou.is'
      const port = 1433
      let isPortOpen = false
      let tcpLatency = 0
      const t0 = new Date().getTime()
      try {
        $http.send({
          url: 'http://' + host + ':' + port,
          method: 'GET',
          timeout: 5,
        })
        tcpLatency = new Date().getTime() - t0
        isPortOpen = true
      } catch (tcpErr) {
        tcpLatency = new Date().getTime() - t0
        const errStr = String(tcpErr).toLowerCase()
        if (errStr.indexOf('reset') !== -1 || errStr.indexOf('eof') !== -1) {
          isPortOpen = true
        }
      }

      return e.json(400, {
        success: false,
        error: 'Nenhum dado recebido e SOIS_BRIDGE_URL não está configurada.',
        diagnostics: {
          sql_host: host,
          sql_port: port,
          port_reachable: isPortOpen,
          latency_ms: tcpLatency,
          sandbox_tds_status:
            'O sandbox PocketBase/Goja não possui driver de socket TDS nativo para executar SELECT direto. Requer envio de rows via POST ou apontamento de SOIS_BRIDGE_URL.',
        },
      })
    }
  }

  // Processamento e espelhamento das linhas da View
  // Filtros de registros de teste
  const testKeywords = [
    'duplicidade',
    'não usar',
    'nao usar',
    'tabela simulação de preço',
    'simulação de preço',
    'simulacao de preco',
    'teste',
  ]

  // Agrupamento por código de produto (COD_PROD)
  const productsMap = {}
  let ignoredRowsCount = 0

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r) {
      ignoredRowsCount++
      continue
    }

    const codProd = String(r.COD_PROD || r.cod_prod || r.sku || '').trim()
    const nomeProd = String(r.NOME_PROD || r.nome_prod || r.name || '').trim()
    const listaPreco = String(r.lista_preco || r.LISTA_PRECO || r.tabela || '').trim()
    const precoRaw =
      r['preço'] !== undefined ? r['preço'] : r.preco !== undefined ? r.preco : r.price
    const saldoRaw =
      r.saldo_prod !== undefined
        ? r.saldo_prod
        : r.SALDO_PROD !== undefined
          ? r.SALDO_PROD
          : r.stock

    if (!codProd || !nomeProd) {
      ignoredRowsCount++
      continue
    }

    // Filtrar registros de teste no nome ou na tabela de preço
    const lowerNome = nomeProd.toLowerCase()
    const lowerLista = listaPreco.toLowerCase()
    let isTest = false
    for (let k = 0; k < testKeywords.length; k++) {
      if (lowerNome.indexOf(testKeywords[k]) !== -1 || lowerLista.indexOf(testKeywords[k]) !== -1) {
        isTest = true
        break
      }
    }

    if (isTest) {
      ignoredRowsCount++
      continue
    }

    // Saldo NULL / indefinido -> tratado como 0 (sem estoque)
    let saldo = 0
    if (saldoRaw !== null && saldoRaw !== undefined && saldoRaw !== '') {
      const numSaldo = Number(saldoRaw)
      if (!isNaN(numSaldo) && numSaldo > 0) {
        saldo = numSaldo
      }
    }

    let preco = 0
    if (precoRaw !== null && precoRaw !== undefined && precoRaw !== '') {
      const numPreco = Number(precoRaw)
      if (!isNaN(numPreco)) {
        preco = numPreco
      }
    }

    if (!productsMap[codProd]) {
      productsMap[codProd] = {
        cod_prod: codProd,
        nome_prod: nomeProd,
        saldo_prod: saldo,
        preco_110: 0,
        preco_130: 0,
        found_110: false,
        found_130: false,
      }
    }

    // Atualiza saldo caso alguma linha traga o saldo consolidado
    if (saldo > productsMap[codProd].saldo_prod) {
      productsMap[codProd].saldo_prod = saldo
    }

    // Identificar a lista de preço ('110%' ou '130%')
    if (listaPreco.indexOf('110') !== -1) {
      productsMap[codProd].preco_110 = preco
      productsMap[codProd].found_110 = true
    } else if (listaPreco.indexOf('130') !== -1) {
      productsMap[codProd].preco_130 = preco
      productsMap[codProd].found_130 = true
    } else {
      // Se não especificado explicitamente, usar como tabela padrão se ainda 0
      if (productsMap[codProd].preco_130 === 0) {
        productsMap[codProd].preco_130 = preco
      }
    }
  }

  // Persistir / Atualizar na coleção 'products'
  // ADIÇÃO B (PROTEÇÃO SYNC): Whitelist estrita de campos gravados no sync.
  // souis_sync.js e qualquer sync NUNCA devem alterar products.reserved_quantity nem order_items.*.
  // reserved_quantity e order_items são geridos com exclusividade pelo módulo de pedidos/PCP.
  const ALLOWED_SYNC_FIELDS = [
    'name',
    'price',
    'cost',
    'stock_quantity',
    'price_110',
    'price_130',
    'supplier',
    'is_purchased',
    'product_type',
    'min_stock',
    'external_id',
    'description',
  ]

  const productsCol = $app.findCollectionByNameOrId('products')
  let createdCount = 0
  let updatedCount = 0
  const mirroredExamples = []

  const productCodes = Object.keys(productsMap)

  for (let j = 0; j < productCodes.length; j++) {
    const p = productsMap[productCodes[j]]
    const sku = p.cod_prod
    const name = p.nome_prod
    // Tabela 130% como preço base e custo
    const basePrice = p.preco_130 > 0 ? p.preco_130 : p.preco_110
    const price110 = p.preco_110
    const price130 = p.preco_130
    const stockQty = p.saldo_prod

    const fieldsToSet = {
      name: name,
      price: basePrice,
      cost: basePrice,
      stock_quantity: stockQty,
      price_110: price110,
      price_130: price130,
      supplier: 'SOU.IS',
      is_purchased: true,
      product_type: 'comprado',
    }

    try {
      const existing = $app.findFirstRecordByData('products', 'sku', sku)
      for (let f = 0; f < ALLOWED_SYNC_FIELDS.length; f++) {
        const fieldName = ALLOWED_SYNC_FIELDS[f]
        if (fieldsToSet[fieldName] !== undefined) {
          existing.set(fieldName, fieldsToSet[fieldName])
        }
      }
      $app.save(existing)
      updatedCount++
    } catch (_) {
      const rec = new Record(productsCol)
      rec.set('sku', sku)
      rec.set('min_stock', 1)
      rec.set('external_id', 'SOU_' + sku)
      rec.set('description', 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE')
      for (let f = 0; f < ALLOWED_SYNC_FIELDS.length; f++) {
        const fieldName = ALLOWED_SYNC_FIELDS[f]
        if (fieldsToSet[fieldName] !== undefined) {
          rec.set(fieldName, fieldsToSet[fieldName])
        }
      }
      $app.save(rec)
      createdCount++
    }

    if (mirroredExamples.length < 5) {
      mirroredExamples.push({
        sku: sku,
        name: name,
        price_base_130: basePrice,
        price_alt_110: price110,
        stock_quantity: stockQty,
      })
    }
  }

  return e.json(200, {
    success: true,
    total_raw_rows: rows.length,
    ignored_rows: ignoredRowsCount,
    distinct_products: productCodes.length,
    created: createdCount,
    updated: updatedCount,
    examples: mirroredExamples,
  })
})
