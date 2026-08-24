routerAdd('GET', '/backend/v1/whatsapp/test-zapi', function (e) {
  // 1. Ler as credenciais da Z-API da coleção settings com fallback para variáveis de ambiente
  let zapiInstance = ''
  let zapiToken = ''
  let zapiClientToken = ''

  try {
    const list = $app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (list && list.length > 0) {
      zapiInstance = list[0].getString('zapi_instance_id') || ''
      zapiToken = list[0].getString('zapi_token') || ''
      zapiClientToken = list[0].getString('zapi_client_token') || ''
    }
  } catch (err) {
    console.log('[TEST-ZAPI] Erro ao buscar configurações:', String(err))
  }

  // Fallback para variáveis de ambiente
  if (!zapiInstance) {
    zapiInstance = $os.getenv('ZAPI_INSTANCE_ID') || ''
  }
  if (!zapiToken) {
    zapiToken = $os.getenv('ZAPI_TOKEN') || ''
  }
  if (!zapiClientToken) {
    zapiClientToken = $os.getenv('ZAPI_CLIENT_TOKEN') || ''
  }

  // Se credenciais faltando: { ok: false, error: "Credenciais Z-API não configuradas" }
  if (!zapiInstance || !zapiToken) {
    return e.json(200, {
      ok: false,
      error: 'Credenciais Z-API não configuradas',
    })
  }

  // 2. Chamar a API real da Z-API: GET https://api.z-api.io/instances/{instanceId}/token/{token}/status
  const headers = {
    'Content-Type': 'application/json',
  }
  if (zapiClientToken) {
    headers['Client-Token'] = zapiClientToken
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
    console.log('[TEST-ZAPI] Erro na requisição:', String(httpErr))
    return e.json(200, {
      ok: false,
      error: 'Erro ao consultar Z-API: ' + String(httpErr),
    })
  }
})
