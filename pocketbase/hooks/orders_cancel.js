// Hook para cancelamento de pedido (Slice 1A - PCP)
// Rota: POST /backend/v1/orders/cancel
// Requisitos atendidos:
// - Libera reservas: decrementa products.reserved_quantity conforme order_items
// - NUNCA toca em stock_quantity
// - NUNCA deixa reserved_quantity negativo
// - Idempotente (se já cancelado, não decrementa reservas novamente)
// - Marca commercial_status = 'cancelado'
// - NÃO altera o orçamento original (ADIÇÃO C)
// - Executado em transação atômica

routerAdd(
  'POST',
  '/backend/v1/orders/cancel',
  (e) => {
    let reqData = {}
    try {
      reqData = e.requestInfo().body || {}
    } catch (_) {
      reqData = {}
    }

    const orderId = String(reqData.order_id || '').trim()
    if (!orderId) {
      return e.json(400, { success: false, error: 'order_id é obrigatório' })
    }

    let order = null
    try {
      order = $app.findRecordById('orders', orderId)
    } catch (err) {
      return e.json(404, { success: false, error: 'Pedido não encontrado: ' + String(err) })
    }

    // Se já estiver cancelado, responder com sucesso idempotente sem reprocessar reservas
    if (order.getString('commercial_status') === 'cancelado') {
      return e.json(200, {
        success: true,
        order: order,
        idempotent: true,
        message: 'Pedido já se encontra cancelado.',
      })
    }

    let items = []
    try {
      items = $app.findRecordsByFilter('order_items', 'order_id = {:oid}', 'created', 500, 0, {
        oid: orderId,
      })
    } catch (itErr) {
      console.log('[ORDERS-CANCEL-FETCH-ITEMS-ERR]', String(itErr))
    }

    try {
      $app.runInTransaction((txApp) => {
        const orderInTx = txApp.findRecordById('orders', orderId)
        if (orderInTx.getString('commercial_status') === 'cancelado') {
          return // já cancelado
        }

        // Liberar reservas em products.reserved_quantity
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const productId = item.getString('product_id')
          const reservedInItem = Number(item.get('quantity_reserved') || 0)

          if (productId && reservedInItem > 0) {
            try {
              const prodRec = txApp.findRecordById('products', productId)
              const currentReserved = Number(prodRec.get('reserved_quantity') || 0)

              // NUNCA deixar reserved_quantity negativo
              const newReserved = Math.max(0, currentReserved - reservedInItem)
              prodRec.set('reserved_quantity', newReserved)
              // NOTA: NUNCA toca em stock_quantity!
              txApp.save(prodRec)
            } catch (pErr) {
              console.log('[ORDERS-CANCEL-PROD-ERR]', 'Produto ' + productId + ': ' + String(pErr))
            }
          }

          // Zerar a quantidade reservada no item
          item.set('quantity_reserved', 0)
          txApp.save(item)
        }

        // Atualizar status comercial do pedido para cancelado
        orderInTx.set('commercial_status', 'cancelado')
        txApp.save(orderInTx)
        order = orderInTx
      })
    } catch (txErr) {
      console.log('[ORDERS-CANCEL-TX-ERROR]', String(txErr))
      return e.json(500, {
        success: false,
        error: 'Erro na transação de cancelamento: ' + (txErr.message || String(txErr)),
      })
    }

    return e.json(200, {
      success: true,
      order: order,
      message: 'Pedido cancelado e reservas de estoque liberadas com sucesso.',
    })
  },
  $apis.requireAuth(),
)
