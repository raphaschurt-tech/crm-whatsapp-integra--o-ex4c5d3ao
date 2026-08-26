routerAdd('POST', '/api/v1/whatsapp/webhook', (e) => {
  let rawBody = e.requestInfo().body
  let body = {}

  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody)
    } catch (_) {
      body = {}
    }
  } else if (rawBody && typeof rawBody === 'object') {
    body = rawBody
  }

  const method = 'POST'
  const path = '/api/v1/whatsapp/webhook'
  const eventType = body.type || body.event || body.eventType || ''

  let rawPhone = ''
  if (body.phone) {
    rawPhone = String(body.phone)
  } else if (body.sender) {
    rawPhone = String(body.sender)
  } else if (body.data && body.data.key && body.data.key.remoteJid) {
    rawPhone = String(body.data.key.remoteJid).replace('@s.whatsapp.net', '')
  }
  rawPhone = rawPhone.replace(/\D/g, '')

  let maskedPhone = ''
  if (rawPhone) {
    if (rawPhone.length > 6) {
      maskedPhone = rawPhone.slice(0, 4) + '****' + rawPhone.slice(-2)
    } else {
      maskedPhone = '****'
    }
  }

  console.log(
    '[WEBHOOK-API-TEST]',
    JSON.stringify({
      method: method,
      path: path,
      type: eventType,
      phone: maskedPhone,
      status: 'processed',
    }),
  )

  return e.json(200, {
    status: 'received',
    test: true,
  })
})
