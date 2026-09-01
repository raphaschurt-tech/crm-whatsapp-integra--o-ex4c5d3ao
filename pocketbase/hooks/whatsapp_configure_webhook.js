// Hook de ciclo de vida do backend:
// Garante o registro inicial do Webhook na Z-API apontando para a URL interna oficial nos deploys ([WEBHOOK-INIT])
// e disponibiliza rota administrativa para reconfiguração explícita
onBootstrap((e) => {
  e.next()

  try {
    const validConfigs = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      10,
      0,
    )

    if (!validConfigs || validConfigs.length === 0) {
      console.log(
        '[WEBHOOK-INIT-SKIP] Nenhuma configuração válida com credenciais Z-API encontrada',
      )
      return
    }

    if (validConfigs.length > 1) {
      console.log(
        '[WEBHOOK-INIT-WARN] Múltiplas configurações válidas encontradas. Abortando auto-registro',
      )
      return
    }

    const validRec = validConfigs[0]
    const zapiInstance = validRec.getString('zapi_instance_id')
    const zapiToken = validRec.getString('zapi_token')
    const zapiClientToken = validRec.getString('zapi_client_token')

    const internalWebhookUrl =
      'https://crm-whatsapp-integracao-aee3e.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'

    const headers = {
      'Content-Type': 'application/json',
      'Client-Token': zapiClientToken,
    }

    const setReceivedRes = $http.send({
      url:
        'https://api.z-api.io/instances/' +
        encodeURIComponent(zapiInstance) +
        '/token/' +
        encodeURIComponent(zapiToken) +
        '/update-webhook-received',
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        value: internalWebhookUrl,
      }),
      timeout: 15,
    })

    // A Z-API mantem DOIS campos de webhook de recebimento:
    // receivedCallbackUrl (update-webhook-received) e
    // receivedAndDeliveryCallbackUrl (update-webhook-received-delivery).
    // Se apenas o primeiro for gravado, a entrega real de mensagens continua
    // pela URL antiga gravada no segundo campo (ex.: URL publica, que recebe
    // 405 do gateway). Gravar SEMPRE os dois.
    const setReceivedDeliveryRes = $http.send({
      url:
        'https://api.z-api.io/instances/' +
        encodeURIComponent(zapiInstance) +
        '/token/' +
        encodeURIComponent(zapiToken) +
        '/update-webhook-received-delivery',
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        value: internalWebhookUrl,
      }),
      timeout: 15,
    })

    const maskedUrl =
      'https://crm-whatsapp-integracao-****.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'
    console.log(
      '[WEBHOOK-INIT] Webhook Z-API configurado com sucesso. Status: ' +
        setReceivedRes.statusCode +
        ' Delivery: ' +
        setReceivedDeliveryRes.statusCode +
        ' Url: ' +
        maskedUrl,
    )
  } catch (err) {
    console.log('[WEBHOOK-INIT-ERR]', err.message || String(err))
  }
})

// Rota POST para configurar/reconfigurar manualmente o webhook na Z-API a partir do painel de Configurações
routerAdd('POST', '/backend/v1/whatsapp/configure-webhook', (e) => {
  let validConfigRec = null
  let configError = ''

  try {
    const validConfigs = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      10,
      0,
    )

    if (!validConfigs || validConfigs.length === 0) {
      configError = 'Nenhuma configuração válida encontrada (credenciais Z-API incompletas)'
    } else if (validConfigs.length > 1) {
      configError =
        'Múltiplas configurações válidas encontradas (' +
        validConfigs.length +
        '). É exigida configuração única'
    } else {
      validConfigRec = validConfigs[0]
    }
  } catch (err) {
    configError = 'Erro ao consultar configurações: ' + (err.message || String(err))
  }

  if (configError || !validConfigRec) {
    return e.json(400, {
      success: false,
      statusCode: 400,
      message: configError || 'Credenciais Z-API não configuradas',
    })
  }

  const zapiInstance = validConfigRec.getString('zapi_instance_id')
  const zapiToken = validConfigRec.getString('zapi_token')
  const zapiClientToken = validConfigRec.getString('zapi_client_token')

  const internalWebhookUrl =
    'https://crm-whatsapp-integracao-aee3e.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'

  const headers = {
    'Content-Type': 'application/json',
    'Client-Token': zapiClientToken,
  }

  try {
    const setReceivedRes = $http.send({
      url:
        'https://api.z-api.io/instances/' +
        encodeURIComponent(zapiInstance) +
        '/token/' +
        encodeURIComponent(zapiToken) +
        '/update-webhook-received',
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        value: internalWebhookUrl,
      }),
      timeout: 15,
    })

    const setReceivedDeliveryRes = $http.send({
      url:
        'https://api.z-api.io/instances/' +
        encodeURIComponent(zapiInstance) +
        '/token/' +
        encodeURIComponent(zapiToken) +
        '/update-webhook-received-delivery',
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        value: internalWebhookUrl,
      }),
      timeout: 15,
    })

    const maskedUrl =
      'https://crm-whatsapp-integracao-****.shrd00.internal.goskip.dev/backend/v1/whatsapp/webhook'
    console.log(
      '[WEBHOOK-CONFIG] Webhook Z-API configurado com sucesso. Status: ' +
        setReceivedRes.statusCode +
        ' Delivery: ' +
        setReceivedDeliveryRes.statusCode +
        ' Url: ' +
        maskedUrl,
    )

    if (setReceivedRes.statusCode >= 200 && setReceivedRes.statusCode < 300) {
      return e.json(200, {
        success: true,
        statusCode: setReceivedRes.statusCode,
        message: 'Webhook Z-API atualizado com sucesso no endereço interno',
      })
    } else {
      const respData = setReceivedRes.json || setReceivedRes.body || {}
      const msg = respData.message || respData.error || 'HTTP ' + setReceivedRes.statusCode
      return e.json(200, {
        success: false,
        statusCode: setReceivedRes.statusCode,
        message: 'Falha ao configurar Z-API: ' + msg,
      })
    }
  } catch (httpErr) {
    return e.json(500, {
      success: false,
      statusCode: 500,
      message: 'Erro na requisição Z-API: ' + String(httpErr),
    })
  }
})

// Rota GET de health check para o painel de configurações
routerAdd('GET', '/backend/v1/whatsapp/webhook/health', (e) => {
  return e.json(200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})
