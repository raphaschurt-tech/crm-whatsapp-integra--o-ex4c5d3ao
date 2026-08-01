routerAdd(
  'POST',
  '/backend/v1/stock/sync',
  (e) => {
    let stockApiUrl = 'https://dummyjson.com/products'
    try {
      const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
      if (setting && setting.getString('stock_api_url')) {
        stockApiUrl = setting.getString('stock_api_url')
      }
    } catch (_) {}

    let updatedCount = 0
    let createdCount = 0

    try {
      const res = $http.send({
        url: stockApiUrl + '?limit=20',
        method: 'GET',
        timeout: 15,
      })
      if (res.statusCode === 200 && res.json) {
        const items = res.json.products || (Array.isArray(res.json) ? res.json : [])
        const productsCol = $app.findCollectionByNameOrId('products')

        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const sku = item.sku || 'SKU-' + (item.id || i + 1)
          const name = item.title || item.name || 'Produto ' + sku
          const price = item.price || 99.9
          const stock = typeof item.stock === 'number' ? item.stock : 10

          try {
            const existing = $app.findFirstRecordByData('products', 'sku', sku)
            existing.set('stock_quantity', stock)
            existing.set('price', price)
            $app.save(existing)
            updatedCount++
          } catch (_) {
            const rec = new Record(productsCol)
            rec.set('name', name)
            rec.set('sku', sku)
            rec.set('price', price)
            rec.set('stock_quantity', stock)
            rec.set('min_stock', 5)
            rec.set('description', item.description || '')
            rec.set('external_id', String(item.id || ''))
            $app.save(rec)
            createdCount++
          }
        }
      }
      return e.json(200, { updated: updatedCount, created: createdCount, success: true })
    } catch (err) {
      return e.json(502, { error: 'Erro ao sincronizar com a API externa: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)
