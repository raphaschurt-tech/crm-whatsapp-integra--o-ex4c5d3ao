// 1. Health check do webhook em caminho separado
routerAdd('GET', '/backend/v1/whatsapp/webhook/health', (e) => {
  let testRes = null
  try {
    const res = $http.send({
      url: 'https://crm-whatsapp-integracao-aee3e.goskip.app/api/v1/whatsapp/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'ReceivedCallback',
        phone: '5511999999999',
        fromMe: false,
        status: 'RECEIVED',
        text: { message: 'teste-api' },
      }),
      timeout: 10,
    })
    testRes = {
      statusCode: res.statusCode,
      body: res.json || res.body,
    }
  } catch (err) {
    testRes = {
      error: err.message || String(err),
    }
  }

  return e.json(200, {
    status: 'ok',
    message: 'WhatsApp webhook is running',
    apiTestResult: testRes,
  })
})

// 2. Rota POST explícita no caminho principal do webhook
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

  // Extrair campos seguros para o log sanitizado (mascarando dados e omitindo tokens)
  const eventType =
    body.type ||
    body.event ||
    body.eventType ||
    (body.data && body.data.message ? 'message' : '') ||
    ''

  const rawInstanceId = String(body.instanceId || body.instance_id || '')
  let maskedInstanceId = ''
  if (rawInstanceId) {
    if (rawInstanceId.length > 8) {
      maskedInstanceId = rawInstanceId.slice(0, 4) + '****' + rawInstanceId.slice(-4)
    } else {
      maskedInstanceId = '****'
    }
  }

  let rawPhone = ''
  if (body.phone) {
    rawPhone = String(body.phone)
  } else if (body.sender) {
    rawPhone = String(body.sender)
  } else if (body.data && body.data.key && body.data.key.remoteJid) {
    rawPhone = String(body.data.key.remoteJid).replace('@s.whatsapp.net', '')
  }
  rawPhone = rawPhone.replace(/\D/g, '')

  let maskedSenderPhone = ''
  if (rawPhone) {
    if (rawPhone.length > 6) {
      maskedSenderPhone = rawPhone.slice(0, 4) + '****' + rawPhone.slice(-2)
    } else {
      maskedSenderPhone = '****'
    }
  }

  console.log(
    '[WEBHOOK-RECEIVED]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/backend/v1/whatsapp/webhook',
      eventType: eventType,
      instanceId: maskedInstanceId,
      senderPhone: maskedSenderPhone,
    }),
  )

  // Responde HTTP 200 imediatamente com { status: 'received' }
  return e.json(200, {
    status: 'received',
  })
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

  // The public gateway (*.goskip.app) returns 405 for external POSTs to
  // /backend/v1/*. The internal hostname accepts external POSTs and proxies
  // directly to PocketBase — use it as the Z-API webhook target.
  const webhookUrl =
    'https://crm-whatsapp-integracao-aee3e.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'
  const configHeaders = { 'Content-Type': 'application/json' }
  if (zClientToken) {
    configHeaders['Client-Token'] = zClientToken

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
>>>>>>>
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
    try {
      const pingRes = $http.send({
        url: 'https://crm-whatsapp-integracao-aee3e.goskip.app/api/v1/whatsapp/webhook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ReceivedCallback',
          phone: '5511999999999',
          fromMe: false,
          status: 'RECEIVED',
          text: { message: 'teste-api' },
        }),
        timeout: 10,
      })
      let str = ''
      if (pingRes.body) {
        if (typeof pingRes.body === 'string') {
          str = pingRes.body
        } else if (Array.isArray(pingRes.body)) {
          str = String.fromCharCode.apply(null, pingRes.body)
        } else {
          str = JSON.stringify(pingRes.body)
        }
      }
      console.log('[EXTERNAL-API-TEST-RESULT-STR]', pingRes.statusCode, str.slice(0, 200))
    } catch (testErr) {
      console.log('[EXTERNAL-API-TEST-RESULT] Error:', testErr.message || String(testErr))
    }

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
      // Internal hostname: the public gateway blocks external POSTs (405).
      const webhookUrl =
        'https://crm-whatsapp-integracao-aee3e.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'
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
>>>>>>>
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
