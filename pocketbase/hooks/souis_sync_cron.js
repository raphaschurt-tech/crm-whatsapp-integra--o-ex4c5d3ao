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
      const preco = extractPrice(r)

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
        if (
          lowerNome.indexOf(testKeywords[k]) !== -1 ||
          lowerLista.indexOf(testKeywords[k]) !== -1
        ) {
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
        }
      }

      if (saldo > productsMap[codProd].saldo_prod) {
        productsMap[codProd].saldo_prod = saldo
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
