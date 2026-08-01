routerAdd('POST', '/backend/v1/payments/confirm', (e) => {
  const body = e.requestInfo().body || {}
  const quoteId = body.quote_id
  const token = body.token
  const method = body.method || 'pix'

  if (!quoteId || !token) {
    return e.badRequestError('quote_id e token são obrigatórios')
  }

  let quote
  try {
    quote = $app.findRecordById('quotes', quoteId)
  } catch (_) {
    return e.notFoundError('Orçamento não encontrado')
  }

  const storedToken = quote.getString('payment_token')
  if (storedToken && storedToken !== token) {
    return e.badRequestError('Token de pagamento inválido')
  }

  if (quote.getString('status') === 'pago') {
    return e.json(200, { message: 'Orçamento já foi pago anteriormente', status: 'pago' })
  }

  quote.set('status', 'pago')
  $app.save(quote)

  const paymentsCol = $app.findCollectionByNameOrId('payments')
  const payment = new Record(paymentsCol)
  payment.set('quote', quote.id)
  payment.set('amount', quote.getFloat('total'))
  payment.set('method', method)
  payment.set('status', 'aprovado')
  payment.set('paid_at', new Date().toISOString())
  $app.save(payment)

  return e.json(200, {
    success: true,
    message: 'Pagamento confirmado com sucesso!',
    payment_id: payment.id,
    quote_number: quote.getString('number'),
  })
})
