// Hook para converter orçamento em pedido (Slice 1A - PCP)
// Rota: POST /backend/v1/orders/convert
// Requisitos atendidos:
// - Apenas para orçamentos com status 'aprovado' ou 'pago'
// - Idempotente: duplo clique não cria pedido duplicado
// - ADIÇÃO C Camada 1: Guard antes de criar — verificar se já existe order NÃO cancelada com mesmo quote_id
// - ADIÇÃO F: Transação atômica via $app.runInTransaction (leitura de disponibilidade + gravação de quantity_reserved + atualização de products.reserved_quantity)
// - Numeração PED-XXXX sequencial e segura em transação
// - Snapshots de SKU, nome, preço unitário, total do orçamento e line_total preservados
// - ADIÇÃO D: financial_status do pedido: aprovado -> pendente; pago -> pago
// - commercial_status: aberto
// - order_items com quantity_ordered, quantity_reserved (0..quantity_ordered conforme disponível)

routerAdd(
  'POST',
  '/backend/v1/orders/convert',
  (e) => {
    let reqData = {}
    try {
      reqData = e.requestInfo().body || {}
    } catch (_) {
      reqData = {}
    }

    const quoteId = String(reqData.quote_id || '').trim()
    const promisedDeliveryDate = String(reqData.promised_delivery_date || '').trim()
    let responsibleUserId = String(reqData.responsible || '').trim()

    if (!quoteId) {
      return e.json(400, { success: false, error: 'quote_id é obrigatório' })
    }

    // Se responsibleUserId não veio, usar o usuário autenticado na requisição
    const authRecord = e.get('authRecord')
    if (!responsibleUserId && authRecord) {
      responsibleUserId = authRecord.id
    }

    // 1. Obter e validar o orçamento fora da transação
    let quote = null
    try {
      quote = $app.findRecordById('quotes', quoteId)
    } catch (err) {
      return e.json(404, { success: false, error: 'Orçamento não encontrado: ' + String(err) })
    }

    const quoteStatus = String(quote.getString('status') || '')
      .toLowerCase()
      .trim()
    if (quoteStatus !== 'aprovado' && quoteStatus !== 'pago') {
      return e.json(400, {
        success: false,
        error: "Apenas orçamentos com status 'aprovado' ou 'pago' podem ser convertidos em pedido.",
        current_status: quoteStatus,
      })
    }

    // ADIÇÃO C Camada 1: Verificar se já existe pedido NÃO cancelado para este orçamento
    try {
      const existingActiveOrders = $app.findRecordsByFilter(
        'orders',
        "quote_id = {:qid} && commercial_status != 'cancelado'",
        '-created',
        1,
        0,
        { qid: quoteId },
      )
      if (existingActiveOrders && existingActiveOrders.length > 0) {
        const existingOrder = existingActiveOrders[0]
        return e.json(200, {
          success: true,
          order: existingOrder,
          idempotent: true,
          message:
            'Pedido já existente para este orçamento (' + existingOrder.getString('code') + ').',
        })
      }
    } catch (findErr) {
      console.log('[ORDERS-CONVERT-FIND-EXISTING-ERR]', String(findErr))
    }

    // Obter dados do cliente snapshot
    let clientName = 'Cliente'
    const customerId = quote.getString('customer')
    if (customerId) {
      try {
        const custRec = $app.findRecordById('customers', customerId)
        clientName = custRec.getString('name') || custRec.getString('company') || 'Cliente'
      } catch (_) {}
    }

    // Obter itens do orçamento
    let quoteItems = []
    try {
      quoteItems = $app.findRecordsByFilter('quote_items', 'quote = {:qid}', 'created', 200, 0, {
        qid: quoteId,
      })
    } catch (qiErr) {
      return e.json(400, {
        success: false,
        error: 'Falha ao buscar itens do orçamento: ' + String(qiErr),
      })
    }

    if (!quoteItems || quoteItems.length === 0) {
      return e.json(400, {
        success: false,
        error: 'O orçamento não possui itens para converter em pedido.',
      })
    }

    // ADIÇÃO D: Mapear status financeiro: aprovado -> pendente; pago -> pago
    const orderFinancialStatus = quoteStatus === 'pago' ? 'pago' : 'pendente'
    const orderTotal = Number(quote.get('total') || 0)

    let createdOrder = null

    // TRANSAÇÃO ATÔMICA via $app.runInTransaction (ADIÇÃO F)
    // Garante que a leitura de disponibilidade + reserva + criação de pedido ocorram sem colisão
    try {
      $app.runInTransaction((txApp) => {
        // Double check dentro da transação para idempotência estrita
        const checkInside = txApp.findRecordsByFilter(
          'orders',
          "quote_id = {:qid} && commercial_status != 'cancelado'",
          '-created',
          1,
          0,
          { qid: quoteId },
        )
        if (checkInside && checkInside.length > 0) {
          createdOrder = checkInside[0]
          return
        }

        // Gerar código PED-XXXX sequencial sem colisão
        let nextNumber = 1
        try {
          const lastOrderList = txApp.findRecordsByFilter('orders', "code != ''", '-created', 1, 0)
          if (lastOrderList && lastOrderList.length > 0) {
            const lastCode = lastOrderList[0].getString('code') // ex: PED-0005
            const match = lastCode.match(/PED-(\d+)/i)
            if (match && match[1]) {
              nextNumber = parseInt(match[1], 10) + 1
            }
          }
        } catch (_) {}

        // Formatar com 4 dígitos (ex: PED-0001)
        const paddedNum = ('0000' + nextNumber).slice(-4)
        const orderCode = 'PED-' + paddedNum

        // Criar registro da order
        const ordersCol = txApp.findCollectionByNameOrId('orders')
        const orderRec = new Record(ordersCol)
        orderRec.set('code', orderCode)
        orderRec.set('quote_id', quoteId)
        orderRec.set('client_name', clientName)
        orderRec.set('total', orderTotal)
        orderRec.set('financial_status', orderFinancialStatus)
        orderRec.set('commercial_status', 'aberto')
        if (promisedDeliveryDate) {
          orderRec.set('promised_delivery_date', promisedDeliveryDate)
        }
        if (responsibleUserId) {
          orderRec.set('responsible', responsibleUserId)
        }
        txApp.save(orderRec)

        // Criar itens do pedido e realizar a reserva de estoque de forma atômica
        const orderItemsCol = txApp.findCollectionByNameOrId('order_items')

        for (let i = 0; i < quoteItems.length; i++) {
          const qi = quoteItems[i]
          const productId = qi.getString('product')
          const qtyOrdered = Number(qi.get('quantity') || 1)
          const unitPrice = Number(qi.get('unit_price') || 0)
          const lineTotal = Number(qi.get('total') || qtyOrdered * unitPrice)

          let sku = ''
          let name = 'Produto'
          let qtyReserved = 0

          if (productId) {
            try {
              const prodRec = txApp.findRecordById('products', productId)
              sku = prodRec.getString('sku') || ''
              name = prodRec.getString('name') || 'Produto'

              const stockQuantity = Number(prodRec.get('stock_quantity') || 0)
              const reservedQuantity = Number(prodRec.get('reserved_quantity') || 0)

              // Cálculo de disponibilidade: disponível = stock_quantity - reserved_quantity
              const available = Math.max(0, stockQuantity - reservedQuantity)

              // Reserva até o disponível (integral, parcial ou 0)
              qtyReserved = Math.min(qtyOrdered, available)

              if (qtyReserved > 0) {
                const newReserved = reservedQuantity + qtyReserved
                prodRec.set('reserved_quantity', newReserved)
                txApp.save(prodRec)
              }
            } catch (pErr) {
              console.log('[ORDERS-CONVERT-PROD-ERR]', 'Produto ' + productId + ': ' + String(pErr))
            }
          }

          // Criar order_item com snapshots
          const oiRec = new Record(orderItemsCol)
          oiRec.set('order_id', orderRec.id)
          oiRec.set('product_id', productId)
          oiRec.set('sku', sku)
          oiRec.set('name', name)
          oiRec.set('unit_price', unitPrice)
          oiRec.set('quantity_ordered', qtyOrdered)
          oiRec.set('quantity_reserved', qtyReserved)
          oiRec.set('line_total', lineTotal)
          txApp.save(oiRec)
        }

        createdOrder = orderRec
      })
    } catch (txErr) {
      console.log('[ORDERS-CONVERT-TX-ERROR]', String(txErr))
      return e.json(500, {
        success: false,
        error: 'Erro na transação de conversão do pedido: ' + (txErr.message || String(txErr)),
      })
    }

    return e.json(200, {
      success: true,
      order: createdOrder,
      message:
        'Orçamento convertido em pedido com sucesso (' +
        (createdOrder ? createdOrder.getString('code') : '') +
        ').',
    })
  },
  $apis.requireAuth(),
)
