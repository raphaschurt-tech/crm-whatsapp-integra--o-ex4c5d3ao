routerAdd('GET', '/backend/v1/whatsapp/test-zapi', function (e) {
  // 1. Ler as credenciais da Z-API da coleção settings com validação estrita
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
    return e.json(200, {
      ok: false,
      error: configError || 'Credenciais Z-API não configuradas',
    })
  }

  const zapiInstance = validConfigRec.getString('zapi_instance_id')
  const zapiToken = validConfigRec.getString('zapi_token')
  const zapiClientToken = validConfigRec.getString('zapi_client_token')

  // 2. Chamar a API real da Z-API: GET https://api.z-api.io/instances/{instanceId}/token/{token}/status
  const headers = {
    'Content-Type': 'application/json',
    'Client-Token': zapiClientToken,
  }

  const url =
    'https://api.z-api.io/instances/' +
    encodeURIComponent(zapiInstance) +
    '/token/' +
    encodeURIComponent(zapiToken) +
    '/status'

  try {
    const res = $http.send({
      url: url,
      method: 'GET',
      headers: headers,
      timeout: 15,
    })

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const data = res.json || {}
      const connected = Boolean(data.connected)
      const phone = data.phone ? String(data.phone) : ''

      return e.json(200, {
        ok: true,
        connected: connected,
        phone: phone,
      })
    } else {
      let errorDetail = ''
      if (res.json && (res.json.message || res.json.error)) {
        errorDetail = res.json.message || res.json.error
      } else if (res.body) {
        errorDetail = String(res.body)
      } else {
        errorDetail = 'HTTP ' + res.statusCode
      }

      return e.json(200, {
        ok: false,
        error: 'Erro ao consultar Z-API: ' + errorDetail,
      })
    }
  } catch (httpErr) {
    console.log('[TEST-ZAPI-ERR] Erro na requisição:', String(httpErr))
    return e.json(200, {
      ok: false,
      error: 'Erro ao consultar Z-API: ' + String(httpErr),
    })
  }
})
