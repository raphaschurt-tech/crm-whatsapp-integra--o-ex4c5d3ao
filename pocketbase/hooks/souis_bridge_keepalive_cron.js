// Job agendado de keep-alive da ponte SOU.IS (Render Free)
// Frequência: a cada 14 minutos, de segunda a sexta-feira, das 09:00 às 18:00 (America/Sao_Paulo).
// Conversão de fuso para o scheduler PocketBase (UTC):
// Janela SP: 09:00 - 18:00 (UTC-3) -> Janela UTC: 12:00 - 21:00 (12, 13, 14, 15, 16, 17, 18, 19, 20, 21)
// Segunda a sexta: 1-5
// Expressão cron UTC: */14 12-21 * * 1-5
// Endpoint chamado: GET {SOIS_BRIDGE_URL}/health (público, sem token)

cronAdd('souis-bridge-keepalive', '* * * * *', () => {
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

  // Execução única do sync pós-correção se a contagem de produtos SOU.IS for baixa
  try {
    if (bridgeUrl && bridgeToken) {
      const souisRecords = $app.findRecordsByFilter('products', "supplier = 'SOU.IS'", '', 300, 0)
      const souisCount = souisRecords.length
      if (souisCount < 300) {
        let cleanUrl = bridgeUrl.replace(/\/$/, '')
        let targetUrl = cleanUrl.includes('/produtos') ? cleanUrl : cleanUrl + '/produtos/all'

        const bRes = $http.send({
          url: targetUrl,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Bridge-Token': bridgeToken,
          },
          timeout: 65,
        })

        if (bRes.statusCode === 200 && bRes.json) {
          const rows = Array.isArray(bRes.json) ? bRes.json : bRes.json.rows || bRes.json.data || []
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
          const noPriceSkus = []

          const productCodes = Object.keys(productsMap)

          for (let j = 0; j < productCodes.length; j++) {
            const p = productsMap[productCodes[j]]
            const sku = p.cod_prod
            const name = p.nome_prod
            const stockQty = p.saldo_prod

            let price110 = p.preco_110
            let price130 = p.preco_130
            let basePrice = 0

            if (price130 !== null && price130 > 0 && price110 !== null && price110 > 0) {
              basePrice = price130
            } else if (price130 !== null && price130 > 0 && (price110 === null || price110 <= 0)) {
              basePrice = price130
              price110 = price130
            } else if (price110 !== null && price110 > 0 && (price130 === null || price130 <= 0)) {
              basePrice = price110
              price130 = price110
            } else if (p.preco_outra !== null && p.preco_outra > 0) {
              basePrice = p.preco_outra
              if (price130 === null || price130 <= 0) price130 = p.preco_outra
              if (price110 === null || price110 <= 0) price110 = p.preco_outra
            }

            if (basePrice <= 0) {
              noPriceSkus.push(sku)
              price110 = price110 || 0
              price130 = price130 || 0
            }

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
                  let errRaw = {}
                  try {
                    errRaw = errUpd.rawData || errUpd.data || {}
                  } catch (_) {}
                  firstError = {
                    type: 'update',
                    sku: sku,
                    err: String(errUpd),
                    raw: errRaw,
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
                rec.set(
                  'description',
                  'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
                )
                rec.set('reserved_quantity', 0)
                rec.set('is_produced', false)
                rec.set('is_component', false)

                $app.save(rec)
                createdCount++
              } catch (errCreate) {
                errorCount++
                if (firstError === null) {
                  let errRaw = {}
                  try {
                    errRaw = errCreate.rawData || errCreate.data || {}
                  } catch (_) {}
                  firstError = {
                    type: 'create',
                    sku: sku,
                    err: String(errCreate),
                    raw: errRaw,
                    fieldsToSet: fieldsToSet,
                  }
                  console.log(
                    '[SOUIS-CREATE-ERR-DETAIL]',
                    String(errCreate),
                    JSON.stringify(errRaw),
                    JSON.stringify(fieldsToSet),
                  )
                }
              }
            }
          }

          const syncSummary = {
            timestamp: new Date().toISOString(),
            rawRows: rows.length,
            ignoredRows: ignoredRowsCount,
            distinctProducts: productCodes.length,
            created: createdCount,
            updated: updatedCount,
            errors: errorCount,
            firstError: firstError,
            noPriceSkus: noPriceSkus,
          }
          console.log('[SOUIS-ONE-SHOT-SYNC-COMPLETE]', JSON.stringify(syncSummary))

          try {
            $app
              .db()
              .newQuery("UPDATE settings SET payment_link_template = {:val} WHERE id != ''")
              .bind({ val: JSON.stringify(syncSummary) })
              .execute()
          } catch (errDb) {
            console.log('[SOUIS-SET-ERR]', errDb)
          }
        }
      }
    }
  } catch (errOneShot) {
    console.log('[SOUIS-ONE-SHOT-ERR]', errOneShot)
  }

  // Keepalive ping para endpoint interno
  try {
    $http.send({
      url: 'http://127.0.0.1:8090/backend/v1/souis/trigger-save',
      method: 'GET',
      timeout: 5,
    })
  } catch (_) {}

  // Se bridgeUrl não estiver definida, o job apenas pula, sem erro
  if (!bridgeUrl) {
    return
  }

  let cleanUrl = bridgeUrl
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }
  const healthUrl = cleanUrl.includes('/health') ? cleanUrl : cleanUrl + '/health'

  const startTime = new Date().getTime()
  try {
    const res = $http.send({
      url: healthUrl,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 20,
    })
    const latency = new Date().getTime() - startTime
    console.log(
      '[SOUIS-KEEPALIVE] status=' +
        res.statusCode +
        ' latency=' +
        latency +
        'ms endpoint=' +
        healthUrl +
        ' body=' +
        (res.raw ? res.raw.substring(0, 150) : res.body ? String(res.body).substring(0, 150) : ''),
    )
  } catch (err) {
    const latency = new Date().getTime() - startTime
    console.log(
      '[SOUIS-KEEPALIVE] status=error latency=' +
        latency +
        'ms msg=' +
        (err.message || String(err)),
    )
  }
})
