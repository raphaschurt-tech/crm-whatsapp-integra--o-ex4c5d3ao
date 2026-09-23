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

  function extractPrice(row) {
    if (!row) return 0
    const val =
      row.PRECO !== undefined
        ? row.PRECO
        : row['preço'] !== undefined
          ? row['preço']
          : row.preco !== undefined
            ? row.preco
            : row.price
    if (val !== null && val !== undefined && val !== '') {
      const num = Number(val)
      if (!isNaN(num) && num > 0) {
        return num
      }
    }
    return 0
  }

  function mapRowsToProducts(rows) {
    const testWordRegexes = [
      /\bduplicidade\b/i,
      /\bn[ãa]o\s+usar\b/i,
      /\btabela\s+simula[çc][ãa]o\s+de\s+pre[çc]o\b/i,
      /\bsimula[çc][ãa]o\s+de\s+pre[çc]o\b/i,
      /\bteste\b/i,
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
      const preco = extractPrice(r)

      const loc1Raw =
        r.LOCAL_1 !== undefined ? r.LOCAL_1 : r.local_1 !== undefined ? r.local_1 : r.location_1
      const loc2Raw =
        r.LOCAL_2 !== undefined ? r.LOCAL_2 : r.local_2 !== undefined ? r.local_2 : r.location_2
      const loc3Raw =
        r.LOCAL_3 !== undefined ? r.LOCAL_3 : r.local_3 !== undefined ? r.local_3 : r.location_3

      const loc1 = loc1Raw !== null && loc1Raw !== undefined ? String(loc1Raw).trim() : ''
      const loc2 = loc2Raw !== null && loc2Raw !== undefined ? String(loc2Raw).trim() : ''
      const loc3 = loc3Raw !== null && loc3Raw !== undefined ? String(loc3Raw).trim() : ''

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

      let isTest = false
      for (let k = 0; k < testWordRegexes.length; k++) {
        if (testWordRegexes[k].test(nomeProd) || testWordRegexes[k].test(listaPreco)) {
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

      if (!productsMap[codProd]) {
        productsMap[codProd] = {
          cod_prod: codProd,
          nome_prod: nomeProd,
          saldo_prod: saldo,
          preco_110: null,
          preco_130: null,
          preco_outra: null,
          location_1: loc1,
          location_2: loc2,
          location_3: loc3,
        }
      }

      if (saldo > productsMap[codProd].saldo_prod) {
        productsMap[codProd].saldo_prod = saldo
      }

      if (!productsMap[codProd].location_1 && loc1) {
        productsMap[codProd].location_1 = loc1
      }
      if (!productsMap[codProd].location_2 && loc2) {
        productsMap[codProd].location_2 = loc2
      }
      if (!productsMap[codProd].location_3 && loc3) {
        productsMap[codProd].location_3 = loc3
      }

      if (listaPreco.indexOf('110') !== -1) {
        productsMap[codProd].preco_110 = preco
      } else if (listaPreco.indexOf('130') !== -1) {
        productsMap[codProd].preco_130 = preco
      } else {
        productsMap[codProd].preco_outra = preco
      }
    }

    const productCodes = Object.keys(productsMap)
    const mappedProducts = {}
    const noPriceSkus = []

    for (let j = 0; j < productCodes.length; j++) {
      const sku = productCodes[j]
      const p = productsMap[sku]

      let price110 = p.preco_110 !== null && p.preco_110 !== undefined ? p.preco_110 : 0
      let price130 = p.preco_130 !== null && p.preco_130 !== undefined ? p.preco_130 : 0
      let precoOutra = p.preco_outra !== null && p.preco_outra !== undefined ? p.preco_outra : 0
      let basePrice = 0

      if (price130 > 0 && price110 > 0) {
        basePrice = price130
      } else if (price130 > 0 && price110 <= 0) {
        basePrice = price130
        price110 = price130
      } else if (price110 > 0 && price130 <= 0) {
        basePrice = price110
        price130 = price110
      } else if (precoOutra > 0) {
        basePrice = precoOutra
        if (price130 <= 0) price130 = precoOutra
        if (price110 <= 0) price110 = precoOutra
      }

      if (basePrice <= 0) {
        noPriceSkus.push(sku)
        price110 = 0
        price130 = 0
        basePrice = 0
      }

      mappedProducts[sku] = {
        sku: sku,
        name: p.nome_prod,
        stockQty: p.saldo_prod,
        price: basePrice,
        price_110: price110,
        price_130: price130,
        cost: basePrice,
        location_1: p.location_1 || '',
        location_2: p.location_2 || '',
        location_3: p.location_3 || '',
      }
    }

    return {
      rawRowsCount: rows.length,
      ignoredRowsCount: ignoredRowsCount,
      distinctProductsCount: Object.keys(productsMap).length,
      mappedProducts: mappedProducts,
      noPriceSkus: noPriceSkus,
    }
  }

  const mappedResult = mapRowsToProducts(rows)
  const mappedProducts = mappedResult.mappedProducts
  const productCodes = Object.keys(mappedProducts)

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
    'location_1',
    'location_2',
    'location_3',
  ]

  const productsCol = $app.findCollectionByNameOrId('products')
  let createdCount = 0
  let updatedCount = 0
  let errorCount = 0
  let firstError = null

  for (let j = 0; j < productCodes.length; j++) {
    const p = mappedProducts[productCodes[j]]
    const sku = p.sku
    const name = p.name
    const stockQty = p.stockQty
    const basePrice = p.price
    const price110 = p.price_110
    const price130 = p.price_130

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
      location_1: p.location_1 || '',
      location_2: p.location_2 || '',
      location_3: p.location_3 || '',
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

  return e.json(200, {
    success: true,
    total_raw_rows: mappedResult.rawRowsCount,
    ignored_rows: mappedResult.ignoredRowsCount,
    distinct_products: mappedResult.distinctProductsCount,
    created: createdCount,
    updated: updatedCount,
    errors: errorCount,
    first_error: firstError,
    no_price_skus: mappedResult.noPriceSkus,
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

  function extractPrice(row) {
    if (!row) return 0
    const val =
      row.PRECO !== undefined
        ? row.PRECO
        : row['preço'] !== undefined
          ? row['preço']
          : row.preco !== undefined
            ? row.preco
            : row.price
    if (val !== null && val !== undefined && val !== '') {
      const num = Number(val)
      if (!isNaN(num) && num > 0) {
        return num
      }
    }
    return 0
  }

  function mapRowsToProducts(rows) {
    const testWordRegexes = [
      /\bduplicidade\b/i,
      /\bn[ãa]o\s+usar\b/i,
      /\btabela\s+simula[çc][ãa]o\s+de\s+pre[çc]o\b/i,
      /\bsimula[çc][ãa]o\s+de\s+pre[çc]o\b/i,
      /\bteste\b/i,
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
      const preco = extractPrice(r)

      const loc1Raw =
        r.LOCAL_1 !== undefined ? r.LOCAL_1 : r.local_1 !== undefined ? r.local_1 : r.location_1
      const loc2Raw =
        r.LOCAL_2 !== undefined ? r.LOCAL_2 : r.local_2 !== undefined ? r.local_2 : r.location_2
      const loc3Raw =
        r.LOCAL_3 !== undefined ? r.LOCAL_3 : r.local_3 !== undefined ? r.local_3 : r.location_3

      const loc1 = loc1Raw !== null && loc1Raw !== undefined ? String(loc1Raw).trim() : ''
      const loc2 = loc2Raw !== null && loc2Raw !== undefined ? String(loc2Raw).trim() : ''
      const loc3 = loc3Raw !== null && loc3Raw !== undefined ? String(loc3Raw).trim() : ''

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

      let isTest = false
      for (let k = 0; k < testWordRegexes.length; k++) {
        if (testWordRegexes[k].test(nomeProd) || testWordRegexes[k].test(listaPreco)) {
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

      if (!productsMap[codProd]) {
        productsMap[codProd] = {
          cod_prod: codProd,
          nome_prod: nomeProd,
          saldo_prod: saldo,
          preco_110: null,
          preco_130: null,
          preco_outra: null,
          location_1: loc1,
          location_2: loc2,
          location_3: loc3,
        }
      }

      if (saldo > productsMap[codProd].saldo_prod) {
        productsMap[codProd].saldo_prod = saldo
      }

      if (!productsMap[codProd].location_1 && loc1) {
        productsMap[codProd].location_1 = loc1
      }
      if (!productsMap[codProd].location_2 && loc2) {
        productsMap[codProd].location_2 = loc2
      }
      if (!productsMap[codProd].location_3 && loc3) {
        productsMap[codProd].location_3 = loc3
      }

      if (listaPreco.indexOf('110') !== -1) {
        productsMap[codProd].preco_110 = preco
      } else if (listaPreco.indexOf('130') !== -1) {
        productsMap[codProd].preco_130 = preco
      } else {
        productsMap[codProd].preco_outra = preco
      }
    }

    const productCodes = Object.keys(productsMap)
    const mappedProducts = {}
    const noPriceSkus = []

    for (let j = 0; j < productCodes.length; j++) {
      const sku = productCodes[j]
      const p = productsMap[sku]

      let price110 = p.preco_110 !== null && p.preco_110 !== undefined ? p.preco_110 : 0
      let price130 = p.preco_130 !== null && p.preco_130 !== undefined ? p.preco_130 : 0
      let precoOutra = p.preco_outra !== null && p.preco_outra !== undefined ? p.preco_outra : 0
      let basePrice = 0

      if (price130 > 0 && price110 > 0) {
        basePrice = price130
      } else if (price130 > 0 && price110 <= 0) {
        basePrice = price130
        price110 = price130
      } else if (price110 > 0 && price130 <= 0) {
        basePrice = price110
        price130 = price110
      } else if (precoOutra > 0) {
        basePrice = precoOutra
        if (price130 <= 0) price130 = precoOutra
        if (price110 <= 0) price110 = precoOutra
      }

      if (basePrice <= 0) {
        noPriceSkus.push(sku)
        price110 = 0
        price130 = 0
        basePrice = 0
      }

      mappedProducts[sku] = {
        sku: sku,
        name: p.nome_prod,
        stockQty: p.saldo_prod,
        price: basePrice,
        price_110: price110,
        price_130: price130,
        cost: basePrice,
        location_1: p.location_1 || '',
        location_2: p.location_2 || '',
        location_3: p.location_3 || '',
      }
    }

    return {
      rawRowsCount: rows.length,
      ignoredRowsCount: ignoredRowsCount,
      distinctProductsCount: Object.keys(productsMap).length,
      mappedProducts: mappedProducts,
      noPriceSkus: noPriceSkus,
    }
  }

  const mappedResult = mapRowsToProducts(rows)
  const mappedProducts = mappedResult.mappedProducts
  const productCodes = Object.keys(mappedProducts)

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

  for (let j = 0; j < productCodes.length; j++) {
    const p = mappedProducts[productCodes[j]]
    const sku = p.sku
    const name = p.name
    const stockQty = p.stockQty
    const basePrice = p.price
    const price110 = p.price_110
    const price130 = p.price_130

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
    rawRows: mappedResult.rawRowsCount,
    ignoredRows: mappedResult.ignoredRowsCount,
    distinctProducts: mappedResult.distinctProductsCount,
    created: createdCount,
    updated: updatedCount,
    errors: errorCount,
    firstError: firstError,
    no_price_skus: mappedResult.noPriceSkus,
  }

  try {
    $app
      .db()
      .newQuery("UPDATE settings SET payment_link_template = {:val} WHERE id != ''")
      .bind({ val: JSON.stringify(resultSummary) })
      .execute()
  } catch (_) {}

  return e.json(200, {
    success: true,
    summary: resultSummary,
  })
})
routerAdd('GET', '/backend/v1/souis/trigger-save', (e) => {
  const result = {}
  try {
    const productsCol = $app.findCollectionByNameOrId('products')
    const rec = new Record(productsCol)
    rec.set('sku', 'TEST-ERR-PROBE')
    rec.set('name', 'Test Err Probe')
    rec.set('price', 10)
    rec.set('cost', 10)
    rec.set('stock_quantity', 1)
    rec.set('price_110', 10)
    rec.set('price_130', 10)
    rec.set('supplier', 'SOU.IS')
    rec.set('is_purchased', true)
    rec.set('product_type', 'comprado')
    rec.set('min_stock', 1)
    rec.set('external_id', 'SOU_TEST-ERR-PROBE')
    rec.set('description', 'Test probe')
    rec.set('reserved_quantity', 0)
    rec.set('is_produced', false)
    rec.set('is_component', false)

    $app.save(rec)
    const savedId = rec.id
    $app.delete(rec)
    result.saveProbe = { ok: true, savedId: savedId }
  } catch (err) {
    result.saveProbe = {
      ok: false,
      err: String(err),
      msg: err.message,
      data: err.data,
      rawData: err.rawData,
    }
  }

  try {
    const setRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (setRec) {
      setRec.set('payment_link_template', JSON.stringify(result))
      $app.save(setRec)
    }
  } catch (errSet) {
    result.errSet = String(errSet)
  }

  return e.json(200, result)
})

routerAdd('GET', '/backend/v1/souis/test-create', (e) => {
  const productsCol = $app.findCollectionByNameOrId('products')
  try {
    const rec = new Record(productsCol)
    rec.set('sku', 'TEST-ERR-PROBE')
    rec.set('name', 'Test Err Probe')
    rec.set('price', 10)
    rec.set('cost', 10)
    rec.set('stock_quantity', 1)
    rec.set('price_110', 10)
    rec.set('price_130', 10)
    rec.set('supplier', 'SOU.IS')
    rec.set('is_purchased', true)
    rec.set('product_type', 'comprado')
    rec.set('min_stock', 1)
    rec.set('external_id', 'SOU_TEST-ERR-PROBE')
    rec.set('description', 'Test probe')
    rec.set('reserved_quantity', 0)
    rec.set('is_produced', false)
    rec.set('is_component', false)

    $app.save(rec)
    const savedId = rec.id
    $app.delete(rec)
    return e.json(200, { success: true, savedId: savedId })
  } catch (err) {
    let rawKeys = []
    try {
      rawKeys = Object.keys(err)
    } catch (_) {}
    return e.json(500, {
      success: false,
      errString: String(err),
      errMessage: err.message,
      errData: err.data,
      errRawData: err.rawData,
      errKeys: rawKeys,
      errValues: JSON.stringify(err),
    })
  }
})

routerAdd('GET', '/backend/v1/souis/check-bridge', (e) => {
  let probeResult = null
  try {
    const productsCol = $app.findCollectionByNameOrId('products')
    const rec = new Record(productsCol)
    rec.set('sku', 'TEST-ERR-PROBE')
    rec.set('name', 'Test Err Probe')
    rec.set('price', 10)
    rec.set('cost', 10)
    rec.set('stock_quantity', 1)
    rec.set('price_110', 10)
    rec.set('price_130', 10)
    rec.set('supplier', 'SOU.IS')
    rec.set('is_purchased', true)
    rec.set('product_type', 'comprado')
    rec.set('min_stock', 1)
    rec.set('external_id', 'SOU_TEST-ERR-PROBE')
    rec.set('description', 'Test probe')
    rec.set('reserved_quantity', 0)
    rec.set('is_produced', false)
    rec.set('is_component', false)

    $app.save(rec)
    const savedId = rec.id
    $app.delete(rec)
    probeResult = { ok: true, savedId: savedId }
  } catch (err) {
    probeResult = {
      ok: false,
      err: String(err),
      msg: err.message,
      data: err.data,
      str: JSON.stringify(err),
    }
  }

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

  // Teste de status
  let testFnResult = 'ok'

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
    probeResult: probeResult,
    testFnResult: testFnResult,
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

    // 4. Teste de contagem bruta de /produtos/all (somente leitura / contagem)
    let produtosAllEndpoint = cleanUrl + '/produtos/all'
    let produtosAllTest = {
      endpoint: produtosAllEndpoint,
      success: false,
      status_code: null,
      raw_rows_count: null,
      sample_first_row: null,
      latency_ms: 0,
      error: null,
    }

    const pStartTime = new Date().getTime()
    try {
      const pHeaders = { 'Content-Type': 'application/json' }
      if (bridgeToken) {
        pHeaders['X-Bridge-Token'] = bridgeToken
      }

      const pRes = $http.send({
        url: produtosAllEndpoint,
        method: 'GET',
        headers: pHeaders,
        timeout: 65,
      })
      const pLatency = new Date().getTime() - pStartTime
      produtosAllTest.status_code = pRes.statusCode
      produtosAllTest.latency_ms = pLatency

      if (pRes.statusCode === 200 && pRes.json) {
        const rows = Array.isArray(pRes.json) ? pRes.json : pRes.json.rows || pRes.json.data || []
        produtosAllTest.success = true
        produtosAllTest.raw_rows_count = rows.length
        if (rows.length > 0) {
          produtosAllTest.sample_first_row = rows[0]
        }
      } else {
        produtosAllTest.error =
          'Status ' + pRes.statusCode + ': ' + (pRes.raw ? pRes.raw.substring(0, 200) : '')
      }
    } catch (pErr) {
      const pLatency = new Date().getTime() - pStartTime
      produtosAllTest.latency_ms = pLatency
      produtosAllTest.error = String(pErr)
    }

    bridgeTest.produtos_all_test = produtosAllTest
    console.log(
      '[SOU.IS Diagnostics] /produtos/all rawRowsCount=' +
        produtosAllTest.raw_rows_count +
        ' success=' +
        produtosAllTest.success +
        ' error=' +
        produtosAllTest.error,
    )
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
