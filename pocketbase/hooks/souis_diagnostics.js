// Diagnostics endpoint for SOU.IS integration
// Returns egress IP of the server and connectivity test to db2.sou.is:1433

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
    try {
      const setting = $app.findFirstRecordByFilter('settings', "id != ''")
      if (setting) {
        if (!bridgeUrl) {
          const rawUrl = setting.getString('stock_api_url')
          if (
            rawUrl &&
            !rawUrl.trim().startsWith('{') &&
            (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
          ) {
            bridgeUrl = rawUrl
          }
        }
        if (!bridgeToken) {
          const rawToken = setting.getString('stock_api_token')
          if (rawToken) {
            bridgeToken = rawToken
          }
        }
      }
    } catch (_) {}

    if (bridgeUrl) {
      if (bridgeUrl.endsWith('/')) {
        bridgeUrl = bridgeUrl.slice(0, -1)
      }
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

      const MAX_ATTEMPTS = 2
      let lastBridgeError = null
      let lastStatusCode = 0
      let lastResponseBody = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const bridgeRes = $http.send({
            url: targetUrl,
            method: 'GET',
            headers: headers,
            timeout: 65,
          })

          lastStatusCode = bridgeRes.statusCode
          lastResponseBody = bridgeRes.body

          if (bridgeRes.statusCode === 200 && bridgeRes.json) {
            rows = Array.isArray(bridgeRes.json)
              ? bridgeRes.json
              : bridgeRes.json.rows || bridgeRes.json.data || []
            lastBridgeError = null
            break
          } else if (attempt < MAX_ATTEMPTS) {
            console.log(
              '[SOU.IS Sync] Tentativa ' +
                attempt +
                ' retornou status ' +
                bridgeRes.statusCode +
                '. Realizando retry após cold start...',
            )
            continue
          } else {
            return e.json(502, {
              success: false,
              error:
                'Bridge HTTP retornou status ' +
                bridgeRes.statusCode +
                ' após ' +
                attempt +
                ' tentativa(s).',
              details: bridgeRes.body,
              target_url: targetUrl,
              attempts: attempt,
            })
          }
        } catch (errBridge) {
          lastBridgeError = String(errBridge)
          console.log(
            '[SOU.IS Sync] Tentativa ' +
              attempt +
              ' falhou com timeout/erro de rede: ' +
              lastBridgeError +
              (attempt < MAX_ATTEMPTS ? '. Realizando retry de cold start...' : ''),
          )
          if (attempt >= MAX_ATTEMPTS) {
            return e.json(502, {
              success: false,
              error:
                'Falha ao conectar com bridge HTTP SOU.IS após ' +
                attempt +
                ' tentativa(s): ' +
                lastBridgeError,
              target_url: targetUrl,
              attempts: attempt,
            })
          }
        }
      }
    } else {
      return e.json(400, {
        success: false,
        error: 'Nenhum dado recebido e bridgeUrl não configurada.',
      })
    }
  }

  const testKeywords = [
    'duplicidade',
    'não usar',
    'nao usar',
    'tabela simulação de preço',
    'simulação de preço',
    'simulacao de preco',
    'teste',
  ]

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

    if (saldo > productsMap[codProd].saldo_prod) {
      productsMap[codProd].saldo_prod = saldo
    }

    if (listaPreco.indexOf('110') !== -1) {
      productsMap[codProd].preco_110 = preco
      productsMap[codProd].found_110 = true
    } else if (listaPreco.indexOf('130') !== -1) {
      productsMap[codProd].preco_130 = preco
      productsMap[codProd].found_130 = true
    } else {
      if (productsMap[codProd].preco_130 === 0) {
        productsMap[codProd].preco_130 = preco
      }
    }
  }

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

  const productCodes = Object.keys(productsMap)

  for (let j = 0; j < productCodes.length; j++) {
    const p = productsMap[productCodes[j]]
    const sku = p.cod_prod
    const name = p.nome_prod
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
      rec.set('reserved_quantity', 0)
      rec.set('is_produced', false)
      rec.set('is_component', false)
      $app.save(rec)
      createdCount++
    }
  }

  return e.json(200, {
    success: true,
    total_raw_rows: rows.length,
    ignored_rows: ignoredRowsCount,
    distinct_products: productCodes.length,
    created: createdCount,
    updated: updatedCount,
  })
})

routerAdd('GET', '/backend/v1/souis/trigger-now', (e) => {
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  try {
    const setting = $app.findFirstRecordByFilter('settings', "id != ''")
    if (setting) {
      if (!bridgeUrl) {
        const rawUrl = setting.getString('stock_api_url')
        if (
          rawUrl &&
          !rawUrl.trim().startsWith('{') &&
          (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
        ) {
          bridgeUrl = rawUrl
        }
      }
      if (!bridgeToken) {
        const rawToken = setting.getString('stock_api_token')
        if (rawToken) {
          bridgeToken = rawToken
        }
      }
    }
  } catch (_) {}

  if (!bridgeUrl || !bridgeToken) {
    return e.json(400, { success: false, error: 'bridgeUrl ou bridgeToken ausente' })
  }

  let cleanUrl = bridgeUrl.replace(/\/$/, '')
  let targetUrl = cleanUrl.includes('/produtos') ? cleanUrl : cleanUrl + '/produtos/all'

  let rows = []
  let bridgeCallStatus = 0
  let bridgeCallError = null

  try {
    const res = $http.send({
      url: targetUrl,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': bridgeToken,
      },
      timeout: 65,
    })
    bridgeCallStatus = res.statusCode
    if (res.statusCode === 200 && res.json) {
      rows = Array.isArray(res.json) ? res.json : res.json.rows || res.json.data || []
    } else {
      bridgeCallError = res.body
      return e.json(502, { success: false, status: res.statusCode, body: res.body })
    }
  } catch (err) {
    return e.json(502, { success: false, error: String(err) })
  }

  const testKeywords = [
    'duplicidade',
    'não usar',
    'nao usar',
    'tabela simulação de preço',
    'simulação de preço',
    'simulacao de preco',
    'teste',
  ]

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

    if (saldo > productsMap[codProd].saldo_prod) {
      productsMap[codProd].saldo_prod = saldo
    }

    if (listaPreco.indexOf('110') !== -1) {
      productsMap[codProd].preco_110 = preco
      productsMap[codProd].found_110 = true
    } else if (listaPreco.indexOf('130') !== -1) {
      productsMap[codProd].preco_130 = preco
      productsMap[codProd].found_130 = true
    } else {
      if (productsMap[codProd].preco_130 === 0) {
        productsMap[codProd].preco_130 = preco
      }
    }
  }

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
  let errorCount = 0
  let firstError = null

  const productCodes = Object.keys(productsMap)

  for (let j = 0; j < productCodes.length; j++) {
    const p = productsMap[productCodes[j]]
    const sku = p.cod_prod
    const name = p.nome_prod
    const basePrice = (p.preco_130 > 0 ? p.preco_130 : p.preco_110) || 0
    const price110 = p.preco_110 || 0
    const price130 = p.preco_130 || 0
    const stockQty = p.saldo_prod || 0

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

    let existingRecord = null
    try {
      existingRecord = $app.findFirstRecordByData('products', 'sku', sku)
    } catch (_) {
      existingRecord = null
    }

    if (existingRecord) {
      try {
        for (let f = 0; f < ALLOWED_SYNC_FIELDS.length; f++) {
          const fieldName = ALLOWED_SYNC_FIELDS[f]
          if (fieldsToSet[fieldName] !== undefined) {
            existingRecord.set(fieldName, fieldsToSet[fieldName])
          }
        }
        $app.save(existingRecord)
        updatedCount++
      } catch (errUpd) {
        errorCount++
        if (firstError === null) {
          firstError = {
            type: 'update',
            sku: sku,
            err: String(errUpd),
            fieldsToSet: fieldsToSet,
          }
        }
      }
    } else {
      try {
        const rec = new Record(productsCol)
        rec.set('sku', sku)
        rec.set('name', name)
        rec.set('price', basePrice)
        rec.set('cost', basePrice)
        rec.set('stock_quantity', stockQty)
        rec.set('price_110', price110)
        rec.set('price_130', price130)
        rec.set('supplier', 'SOU.IS')
        rec.set('is_purchased', true)
        rec.set('product_type', 'comprado')
        rec.set('min_stock', 1)
        rec.set('external_id', 'SOU_' + sku)
        rec.set('description', 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE')
        rec.set('reserved_quantity', 0)
        rec.set('is_produced', false)
        rec.set('is_component', false)

        $app.save(rec)
        createdCount++
      } catch (errCreate) {
        errorCount++
        if (firstError === null) {
          firstError = {
            type: 'create',
            sku: sku,
            err: String(errCreate),
            fieldsToSet: fieldsToSet,
          }
        }
      }
    }
  }

  const resultSummary = {
    timestamp: new Date().toISOString(),
    rawRows: rows.length,
    ignoredRows: ignoredRowsCount,
    distinctProducts: productCodes.length,
    created: createdCount,
    updated: updatedCount,
    errors: errorCount,
    firstError: firstError,
  }

  try {
    const settingRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (settingRec) {
      settingRec.set('payment_link_template', JSON.stringify(resultSummary))
      $app.save(settingRec)
    }
  } catch (_) {}

  return e.json(200, {
    success: true,
    summary: resultSummary,
  })
})

routerAdd('GET', '/backend/v1/debug-env', (e) => {
  return e.json(200, { ok: true })
})

routerAdd('GET', '/backend/v1/souis/check-bridge', (e) => {
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  try {
    const setting = $app.findFirstRecordByFilter('settings', "id != ''")
    if (setting) {
      if (!bridgeUrl) {
        const rawUrl = setting.getString('stock_api_url')
        if (
          rawUrl &&
          !rawUrl.trim().startsWith('{') &&
          (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
        ) {
          bridgeUrl = rawUrl
        }
      }
      if (!bridgeToken) {
        const rawToken = setting.getString('stock_api_token')
        if (rawToken) {
          bridgeToken = rawToken
        }
      }
    }
  } catch (_) {}

  // Tentar chamar a ponte /produtos/all diretamente aqui e retornar o status
  let bridgeCallStatus = null
  let bridgeCallError = null
  let returnedRowsCount = 0

  if (bridgeUrl && bridgeToken) {
    try {
      const res = $http.send({
        url: bridgeUrl.replace(/\/$/, '') + '/produtos/all',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Token': bridgeToken,
        },
        timeout: 65,
      })
      bridgeCallStatus = res.statusCode
      if (res.statusCode === 200 && res.json) {
        const data = Array.isArray(res.json) ? res.json : res.json.rows || res.json.data || []
        returnedRowsCount = data.length
      } else {
        bridgeCallError = res.body
      }
    } catch (err) {
      bridgeCallError = String(err)
    }
  }

  return e.json(200, {
    bridgeUrl: bridgeUrl,
    hasToken: Boolean(bridgeToken),
    tokenPrefix: bridgeToken ? bridgeToken.substring(0, 5) : null,
    bridgeCallStatus: bridgeCallStatus,
    bridgeCallError: bridgeCallError,
    returnedRowsCount: returnedRowsCount,
  })
})

routerAdd('GET', '/backend/v1/souis/diagnostics', (e) => {
  let egressIp = null
  let egressError = null

  // 1. Fetch public egress IP using ipify and httpbin as fallback
  try {
    const ipRes = $http.send({
      url: 'https://api.ipify.org?format=json',
      method: 'GET',
      timeout: 10,
    })
    if (ipRes.statusCode === 200 && ipRes.json && ipRes.json.ip) {
      egressIp = ipRes.json.ip
    }
  } catch (err1) {
    try {
      const fallbackRes = $http.send({
        url: 'https://httpbin.org/get',
        method: 'GET',
        timeout: 10,
      })
      if (fallbackRes.statusCode === 200 && fallbackRes.json && fallbackRes.json.origin) {
        egressIp = fallbackRes.json.origin
      }
    } catch (err2) {
      egressError = 'ipify error: ' + String(err1) + ' | httpbin error: ' + String(err2)
    }
  }

  // 2. Connectivity test to db2.sou.is:1433
  const host = 'db2.sou.is'
  const port = 1433
  let sqlResult = 'unknown'
  let latencyMs = 0
  let rawError = null
  const startTime = new Date().getTime()

  try {
    $http.send({
      url: 'http://' + host + ':' + port,
      method: 'GET',
      timeout: 5,
    })
    latencyMs = new Date().getTime() - startTime
    sqlResult = 'ok'
  } catch (err) {
    latencyMs = new Date().getTime() - startTime
    const errStr = String(err).toLowerCase()
    rawError = String(err)
    if (
      errStr.indexOf('timeout') !== -1 ||
      errStr.indexOf('deadline') !== -1 ||
      latencyMs >= 4800
    ) {
      sqlResult = 'timeout'
    } else if (errStr.indexOf('refused') !== -1) {
      sqlResult = 'refused'
    } else if (errStr.indexOf('reset') !== -1 || errStr.indexOf('eof') !== -1) {
      // Server responded at TCP level and reset/closed non-HTTP handshake (port is open and reachable)
      sqlResult = 'open'
    } else {
      sqlResult = 'failed'
    }
  }

  console.log(
    '[SOU.IS Diagnostics] Egress IP: ' +
      egressIp +
      ' | Result: ' +
      sqlResult +
      ' | Latency: ' +
      latencyMs +
      'ms | Error: ' +
      rawError,
  )

  // 3. Teste da Bridge HTTP SOU.IS (se configurada via SOIS_BRIDGE_URL ou settings)
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  try {
    const setting = $app.findFirstRecordByFilter('settings', "id != ''")
    if (setting) {
      if (!bridgeUrl) {
        const rawUrl = setting.getString('stock_api_url')
        if (
          rawUrl &&
          !rawUrl.trim().startsWith('{') &&
          (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
        ) {
          bridgeUrl = rawUrl
        }
      }
      if (!bridgeToken) {
        const rawToken = setting.getString('stock_api_token')
        if (rawToken) {
          bridgeToken = rawToken
        }
      }
    }
  } catch (_) {}

  let bridgeTest = {
    configured: false,
    url: null,
    status: 'bridge_not_configured',
    message:
      'Defina a variável SOIS_BRIDGE_URL (e opcionalmente SOIS_BRIDGE_TOKEN) para ativar o teste da ponte.',
  }

  if (bridgeUrl) {
    let cleanUrl = bridgeUrl
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1)
    }
    const healthUrl = cleanUrl.includes('/health') ? cleanUrl : cleanUrl + '/health'

    const bStartTime = new Date().getTime()
    try {
      const bHeaders = { 'Content-Type': 'application/json' }
      if (bridgeToken) {
        bHeaders['X-Bridge-Token'] = bridgeToken
      }

      const bRes = $http.send({
        url: healthUrl,
        method: 'GET',
        headers: bHeaders,
        timeout: 10,
      })

      const bLatency = new Date().getTime() - bStartTime
      bridgeTest = {
        configured: true,
        url: cleanUrl,
        health_endpoint: healthUrl,
        http_status: bRes.statusCode,
        status: bRes.statusCode === 200 ? 'online' : 'error',
        latency_ms: bLatency,
        response: bRes.json || bRes.body,
        token_configured: Boolean(bridgeToken),
      }
    } catch (bErr) {
      const bLatency = new Date().getTime() - bStartTime
      bridgeTest = {
        configured: true,
        url: cleanUrl,
        health_endpoint: healthUrl,
        status: 'unreachable',
        latency_ms: bLatency,
        error: String(bErr),
        token_configured: Boolean(bridgeToken),
      }
    }
  }

  return e.json(200, {
    egress_ip: egressIp,
    egress_error: egressError,
    sql_server_test: {
      host: host,
      port: port,
      status: sqlResult === 'open' ? 'porta_aberta' : sqlResult,
      result: sqlResult,
      latency_ms: latencyMs,
      error_detail: rawError,
      firewall_status: sqlResult === 'open' ? 'liberado' : 'bloqueado',
    },
    bridge_test: bridgeTest,
    tds_runtime_capability: {
      sandbox: 'PocketBase Goja (JS/ES5 runtime)',
      has_native_tds_driver: false,
      available_external_io: ['$http.send'],
      supports_direct_tds_socket: false,
      recommended_architecture:
        'Bridge / Middleware HTTP (ex: Node.js/Cloudflare Worker/microservico com mssql/tedious exposto em rota protegida que chama a View e entrega JSON para $http.send)',
    },
  })
})
