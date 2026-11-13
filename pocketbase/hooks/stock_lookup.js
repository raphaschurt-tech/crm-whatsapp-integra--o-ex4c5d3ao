routerAdd('GET', '/backend/v1/stock/lookup', (e) => {
  const sku = e.requestInfo().query['sku']
  if (!sku) {
    return e.badRequestError('SKU é obrigatório')
  }
  let stockApiUrl = ''
  try {
    const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
    if (setting && setting.getString('stock_api_url')) {
      stockApiUrl = setting.getString('stock_api_url')
    }
  } catch (_) {}

  // Consulta API externa SOMENTE se stock_api_url estiver configurado
  let quantity = null
  if (stockApiUrl) {
    try {
      const res = $http.send({
        url: stockApiUrl + '?search=' + encodeURIComponent(sku),
        method: 'GET',
        timeout: 10,
      })
      if (res.statusCode === 200 && res.json) {
        const data = res.json
        if (data.products && Array.isArray(data.products) && data.products.length > 0) {
          const st =
            data.products[0].stock != null
              ? data.products[0].stock
              : data.products[0].stock_quantity
          if (typeof st === 'number' && !isNaN(st)) {
            quantity = st
          }
        } else if (typeof data.stock === 'number') {
          quantity = data.stock
        }
      }
    } catch (err) {
      return e.json(502, {
        error: 'Não foi possível consultar a API de estoque externa: ' + String(err),
      })
    }
  }

  // NUNCA grava em products.stock_quantity — apenas lê o valor da tabela products
  try {
    const localProduct = $app.findFirstRecordByData('products', 'sku', sku)
    const tableStock = Number(localProduct.get('stock_quantity')) || 0
    return e.json(200, {
      sku: sku,
      quantity: tableStock,
      live_quantity: quantity,
      updated_at: new Date().toISOString(),
    })
  } catch (_) {
    return e.json(404, {
      sku: sku,
      quantity: 0,
      live_quantity: quantity,
      error: 'Produto não encontrado na tabela products',
      updated_at: new Date().toISOString(),
    })
  }
})
