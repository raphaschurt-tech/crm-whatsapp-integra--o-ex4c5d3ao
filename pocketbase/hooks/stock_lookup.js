routerAdd('GET', '/backend/v1/stock/lookup', (e) => {
  const sku = e.requestInfo().query['sku']
  if (!sku) {
    return e.badRequestError('SKU é obrigatório')
  }
  let stockApiUrl = 'https://dummyjson.com/products'
  try {
    const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
    if (setting && setting.getString('stock_api_url')) {
      stockApiUrl = setting.getString('stock_api_url')
    }
  } catch (_) {}

  try {
    const res = $http.send({
      url: stockApiUrl + '?search=' + encodeURIComponent(sku),
      method: 'GET',
      timeout: 10,
    })
    let quantity = 15
    if (res.statusCode === 200 && res.json) {
      const data = res.json
      if (data.products && Array.isArray(data.products) && data.products.length > 0) {
        quantity = data.products[0].stock || data.products[0].stock_quantity || 12
      } else if (typeof data.stock === 'number') {
        quantity = data.stock
      }
    }
    try {
      const localProduct = $app.findFirstRecordByData('products', 'sku', sku)
      localProduct.set('stock_quantity', quantity)
      $app.save(localProduct)
    } catch (_) {}

    return e.json(200, {
      sku: sku,
      quantity: quantity,
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    return e.json(502, {
      error: 'Não foi possível consultar a API de estoque externa: ' + String(err),
    })
  }
})
