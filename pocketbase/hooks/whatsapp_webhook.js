// 1. Registrar rota unificada do webhook IMEDIATAMENTE antes de qualquer chamada externa
routerAdd('*', '/backend/v1/whatsapp/webhook', (e) => {
  const method = e.requestInfo().method

  if (method === 'GET') {
    return e.json(200, {
      status: 'ok',
      message: 'WhatsApp webhook is running',
    })
  }

  if (method === 'POST') {
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

    // Extrair campos seguros para o log antes de qualquer processamento (sem tokens ou dados sensíveis)
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
  }

  return e.json(405, { error: 'Method Not Allowed' })
})

// Rota auxiliar para configurar o webhook na Z-API sob demanda
routerAdd('POST', '/backend/v1/whatsapp/configure-webhook', (e) => {
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
  } catch (err) {
    console.log('[WEBHOOK-INIT] Erro ao ler configurações:', err.message || String(err))
  }

  if (!zInstance || !zToken) {
    return e.json(400, {
      success: false,
      statusCode: 400,
      message: 'Instância ou Token da Z-API não configurados nas configurações.',
    })
  }

  const webhookUrl = 'https://crm-whatsapp-integracao-aee3e.goskip.app/backend/v1/whatsapp/webhook'
  const configHeaders = { 'Content-Type': 'application/json' }
  if (zClientToken) {
    configHeaders['Client-Token'] = zClientToken
  }

  let attempts = 0
  let maxAttempts = 3
  let lastStatusCode = 0
  let lastErrorMsg = ''
  let success = false

  while (attempts < maxAttempts && !success) {
    attempts++
    try {
      const res = $http.send({
        url:
          'https://api.z-api.io/instances/' +
          zInstance +
          '/token/' +
          zToken +
          '/update-webhook-received',
        method: 'PUT',
        headers: configHeaders,
        body: JSON.stringify({ value: webhookUrl }),
        timeout: 10,
      })

      lastStatusCode = res.statusCode
      if (res.statusCode >= 200 && res.statusCode < 300) {
        success = true
        console.log(
          '[WEBHOOK-CONFIG] Webhook Z-API configurado com sucesso. Status:',
          res.statusCode,
        )
        break
      } else {
        lastErrorMsg = 'Resposta inesperada da Z-API (HTTP ' + res.statusCode + ')'
        console.log('[WEBHOOK-CONFIG] Tentativa ' + attempts + ' falhou. Status: ' + res.statusCode)
      }
    } catch (err) {
      lastErrorMsg = err.message || String(err)
      console.log(
        '[WEBHOOK-CONFIG] Tentativa ' + attempts + ' erro: ' + (err.message || String(err)),
      )
    }

    if (!success && attempts < maxAttempts) {
      sleep(1000)
    }
  }

  if (success) {
    return e.json(200, {
      success: true,
      statusCode: lastStatusCode || 200,
      message: 'Webhook configurado com sucesso na Z-API.',
    })
  } else {
    return e.json(200, {
      success: false,
      statusCode: lastStatusCode || 500,
      message: 'Falha ao configurar webhook na Z-API: ' + (lastErrorMsg || 'Erro de comunicação'),
    })
  }
})

// Auto-configuração não-bloqueante no bootstrap com retry limitado (máx 3 tentativas, 1s de intervalo)
onBootstrap((e) => {
  e.next()

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
    } catch (err) {
      console.log('[WEBHOOK-INIT] Erro ao ler configurações:', err.message || String(err))
    }

    if (zInstance && zToken) {
      const webhookUrl =
        'https://crm-whatsapp-integracao-aee3e.goskip.app/backend/v1/whatsapp/webhook'
      const configHeaders = { 'Content-Type': 'application/json' }
      if (zClientToken) {
        configHeaders['Client-Token'] = zClientToken
      }

      let attempts = 0
      let maxAttempts = 3
      let success = false

      while (attempts < maxAttempts && !success) {
        attempts++
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

          if (setWebhookRes.statusCode >= 200 && setWebhookRes.statusCode < 300) {
            success = true
            console.log(
              '[WEBHOOK-INIT] Webhook Z-API configurado com sucesso. Status:',
              setWebhookRes.statusCode,
            )
            break
          } else {
            console.log(
              '[WEBHOOK-INIT] Tentativa ' +
                attempts +
                ' falhou com status: ' +
                setWebhookRes.statusCode,
            )
          }
        } catch (sendErr) {
          console.log(
            '[WEBHOOK-INIT] Tentativa ' + attempts + ' erro ao configurar Z-API:',
            sendErr.message || String(sendErr),
          )
        }

        if (!success && attempts < maxAttempts) {
          sleep(1000)
        }
      }
    }
  } catch (initErr) {
    console.log(
      '[WEBHOOK-INIT] Erro geral não-bloqueante no bootstrap:',
      initErr.message || String(initErr),
    )
  }
})
