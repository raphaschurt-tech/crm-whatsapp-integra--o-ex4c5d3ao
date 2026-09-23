// Job agendado de sincronização da View SOU.IS
// Frequência: 4x por dia, de segunda a sexta-feira, nos horários 09:00, 12:00, 15:00 e 18:00 (America/Sao_Paulo).
// Conversão de fuso para o scheduler PocketBase (UTC):
// Horários SP: 09:00, 12:00, 15:00, 18:00 (UTC-3)
// Horários UTC: 12:00, 15:00, 18:00, 21:00
// Segunda a sexta: 1-5
// Expressão cron UTC: 0 12,15,18,21 * * 1-5

cronAdd('souis-view-sync-scheduled', '0 12,15,18,21 * * 1-5', () => {
  // Funções inline de mapeamento SOU.IS
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

      const brandRaw =
        r.MARCA !== undefined
          ? r.MARCA
          : r.marca !== undefined
            ? r.marca
            : r.brand !== undefined
              ? r.brand
              : r.BRAND
      const brandVal = brandRaw !== null && brandRaw !== undefined ? String(brandRaw).trim() : ''

      const barcodeRaw =
        r.CODIGOBARRAS !== undefined
          ? r.CODIGOBARRAS
          : r.codigobarras !== undefined
            ? r.codigobarras
            : r.codigo_barras !== undefined
              ? r.codigo_barras
              : r.CODIGO_BARRAS !== undefined
                ? r.CODIGO_BARRAS
                : r.barcode !== undefined
                  ? r.barcode
                  : r.BARCODE
      const barcodeVal =
        barcodeRaw !== null && barcodeRaw !== undefined ? String(barcodeRaw).trim() : ''

      const reducedCodeRaw =
        r.CODREDUZIDO !== undefined
          ? r.CODREDUZIDO
          : r.codreduzido !== undefined
            ? r.codreduzido
            : r.cod_reduzido !== undefined
              ? r.cod_reduzido
              : r.COD_REDUZIDO !== undefined
                ? r.COD_REDUZIDO
                : r.reduced_code !== undefined
                  ? r.reduced_code
                  : r.REDUCED_CODE
      const reducedCodeVal =
        reducedCodeRaw !== null && reducedCodeRaw !== undefined ? String(reducedCodeRaw).trim() : ''

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
          brand: brandVal,
          barcode: barcodeVal,
          reduced_code: reducedCodeVal,
        }
      }

      if (saldo > productsMap[codProd].saldo_prod) {
        productsMap[codProd].saldo_prod = saldo
      }

      // Consolidação da localização: manter a primeira não vazia
      if (!productsMap[codProd].location_1 && loc1) {
        productsMap[codProd].location_1 = loc1
      }
      if (!productsMap[codProd].location_2 && loc2) {
        productsMap[codProd].location_2 = loc2
      }
      if (!productsMap[codProd].location_3 && loc3) {
        productsMap[codProd].location_3 = loc3
      }

      // Consolidação de marca, código de barras e código reduzido: primeira não vazia
      if (!productsMap[codProd].brand && brandVal) {
        productsMap[codProd].brand = brandVal
      }
      if (!productsMap[codProd].barcode && barcodeVal) {
        productsMap[codProd].barcode = barcodeVal
      }
      if (!productsMap[codProd].reduced_code && reducedCodeVal) {
        productsMap[codProd].reduced_code = reducedCodeVal
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
        brand: p.brand || '',
        barcode: p.barcode || '',
        reduced_code: p.reduced_code || '',
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

  let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''

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

  if (!bridgeToken) {
    console.log('[SOUIS-SYNC-SKIPPED] token ausente')
    return
  }

  if (!bridgeUrl) {
    console.log('[SOUIS-SYNC-SKIPPED] bridge_url ausente')
    return
  }

  let cleanUrl = bridgeUrl
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }
  let targetUrl = cleanUrl
  if (!targetUrl.includes('/produtos')) {
    targetUrl = targetUrl + '/produtos/all'
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Bridge-Token': bridgeToken,
  }

  const MAX_ATTEMPTS = 2
  let rows = []
  let lastBridgeError = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const bridgeRes = $http.send({
        url: targetUrl,
        method: 'GET',
        headers: headers,
        timeout: 65,
      })

      if (bridgeRes.statusCode === 200 && bridgeRes.json) {
        rows = Array.isArray(bridgeRes.json)
          ? bridgeRes.json
          : bridgeRes.json.rows || bridgeRes.json.data || []
        lastBridgeError = null
        break
      } else if (attempt < MAX_ATTEMPTS) {
        console.log(
          '[SOU.IS Cron Sync] Tentativa ' +
            attempt +
            ' retornou status ' +
            bridgeRes.statusCode +
            '. Realizando retry após cold start...',
        )
        continue
      } else {
        console.log(
          '[SOU.IS Cron Sync] Falha: bridge retornou status ' +
            bridgeRes.statusCode +
            ' após ' +
            attempt +
            ' tentativas.',
        )
        return
      }
    } catch (errBridge) {
      lastBridgeError = String(errBridge)
      console.log(
        '[SOU.IS Cron Sync] Tentativa ' +
          attempt +
          ' falhou com timeout/erro de rede: ' +
          lastBridgeError +
          (attempt < MAX_ATTEMPTS ? '. Realizando retry de cold start...' : ''),
      )
      if (attempt >= MAX_ATTEMPTS) {
        console.log('[SOU.IS Cron Sync] Abortando sync após falha de rede/timeout.')
        return
      }
    }
  }

  const mappedResult = mapRowsToProducts(rows)
  const mappedProducts = mappedResult.mappedProducts
  const productCodes = Object.keys(mappedProducts)

  // ADIÇÃO B (PROTEÇÃO SYNC): Whitelist estrita de campos gravados no sync.
  // souis_sync e qualquer sync NUNCA devem alterar products.reserved_quantity nem order_items.*.
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
    'brand',
    'barcode',
    'reduced_code',
  ]

  const productsCol = $app.findCollectionByNameOrId('products')
  let createdCount = 0
  let updatedCount = 0

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
      brand: p.brand || '',
      barcode: p.barcode || '',
      reduced_code: p.reduced_code || '',
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
      // Campos obrigatórios ou auxiliares com valores padrão
      rec.set('reserved_quantity', 0)
      rec.set('is_produced', false)
      rec.set('is_component', false)
      $app.save(rec)
      createdCount++
    }
  }

  console.log(
    '[SOUIS-SCHEDULED-SYNC-COMPLETE]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      rawRows: mappedResult.rawRowsCount,
      ignoredRows: mappedResult.ignoredRowsCount,
      distinctProducts: mappedResult.distinctProductsCount,
      created: createdCount,
      updated: updatedCount,
      noPriceSkus: mappedResult.noPriceSkus,
    }),
  )
})
