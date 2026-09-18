// Job agendado de sincronização da View SOU.IS
// Frequência: 4x por dia, de segunda a sexta-feira, nos horários 09:00, 12:00, 15:00 e 18:00 (America/Sao_Paulo).
// Conversão de fuso para o scheduler PocketBase (UTC):
// Horários SP: 09:00, 12:00, 15:00, 18:00 (UTC-3)
// Horários UTC: 12:00, 15:00, 18:00, 21:00
// Segunda a sexta: 1-5
// Expressão cron UTC: 0 12,15,18,21 * * 1-5

cronAdd('souis-view-sync-scheduled', '0 12,15,18,21 * * 1-5', () => {
  const bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  if (!bridgeToken) {
    console.log('[SOUIS-SYNC-SKIPPED] token ausente')
    return
  }

  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  if (!bridgeUrl) {
    try {
      const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
      if (setting) {
        const rawUrl = setting.getString('stock_api_url')
        if (
          rawUrl &&
          !rawUrl.trim().startsWith('{') &&
          (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
        ) {
          bridgeUrl = rawUrl
        }
      }
    } catch (_) {}
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
      $app.save(rec)
      createdCount++
    }
  }

  console.log(
    '[SOUIS-SCHEDULED-SYNC-COMPLETE]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      rawRows: rows.length,
      ignoredRows: ignoredRowsCount,
      distinctProducts: productCodes.length,
      created: createdCount,
      updated: updatedCount,
    }),
  )
})
