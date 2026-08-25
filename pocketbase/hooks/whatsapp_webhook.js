// redeploy trigger - 2026-08-25T01:35:00.000Z
// 1. Registrar rotas do webhook IMEDIATAMENTE antes de qualquer chamada externa
// Handler GET para testar se a rota do webhook está ativa e funcional
routerAdd('GET', '/backend/v1/whatsapp/webhook', (e) => {
  return e.json(200, {
    status: 'ok',
    message: 'WhatsApp webhook is running',
  })
})

// Webhook para receber mensagens do WhatsApp (Z-API ou Evolution API), processar com IA e responder
routerAdd('POST', '/backend/v1/whatsapp/webhook', (e) => {
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

  // Extrair campos seguros para o log antes de qualquer processamento
  const eventType =
    body.type ||
    body.event ||
    body.eventType ||
    (body.data && body.data.message ? 'message' : '') ||
    ''
  const instanceId = body.instanceId || body.instance_id || ''
  let senderPhone = ''
  if (body.phone) {
    senderPhone = String(body.phone)
  } else if (body.sender) {
    senderPhone = String(body.sender)
  } else if (body.data && body.data.key && body.data.key.remoteJid) {
    senderPhone = String(body.data.key.remoteJid).replace('@s.whatsapp.net', '')
  }
  senderPhone = senderPhone.replace(/\D/g, '')

  console.log(
    '[WEBHOOK-RECEIVED]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/backend/v1/whatsapp/webhook',
      eventType: eventType,
      instanceId: instanceId,
      senderPhone: senderPhone,
    }),
  )

  // Retornar resposta HTTP 200 imediatamente antes de qualquer chamada à OpenAI, Z-API ou processamento pesado
  return e.json(200, {
    status: 'received',
    message: 'Webhook received successfully',
  })
})

// Auto-configurar o webhook na Z-API em bloco seguro após registro das rotas
try {
  let zInstance = ''
  let zToken = ''
  let zClientToken = ''

  try {
    const list = $app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (list && list.length > 0) {
      zInstance = list[0].getString('zapi_instance_id') || ''
      zToken = list[0].getString('zapi_token') || ''
      zClientToken = list[0].getString('zapi_client_token') || ''
    }
  } catch (_) {}

  if (zInstance && zToken) {
    const webhookUrl =
      'https://crm-whatsapp-integracao-aee3e.goskip.app/backend/v1/whatsapp/webhook'
    const configHeaders = { 'Content-Type': 'application/json' }
    if (zClientToken) {
      configHeaders['Client-Token'] = zClientToken
    }

    try {
      const setWebhookRes = $http.send({
        url:
          'https://api.z-api.io/instances/' +
          zInstance +
          '/token/' +
          zToken +
          '/update-webhook-received',
        method: 'PUT',
        headers: configHeaders,
        body: JSON.stringify({ value: webhookUrl }),
        timeout: 5,
      })
      console.log('[WEBHOOK-INIT] Configurando Webhook Z-API:', setWebhookRes.statusCode)
    } catch (sendErr) {
      console.log('[WEBHOOK-INIT] Erro não-bloqueante ao configurar Z-API:', String(sendErr))
    }
  }
} catch (initErr) {
  console.log('[WEBHOOK-INIT] Erro geral não-bloqueante na inicialização:', String(initErr))
}
