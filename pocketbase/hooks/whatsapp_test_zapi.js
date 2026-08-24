routerAdd('GET', '/backend/v1/whatsapp/test-zapi', (e) => {
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
    console.log('[TEST-ZAPI] Erro ao ler settings:', String(err))
  }

  // Fallback para variáveis de ambiente se não estiver no banco
  if (!zInstance) zInstance = $os.getenv('ZAPI_INSTANCE_ID') || ''
  if (!zToken) zToken = $os.getenv('ZAPI_TOKEN') || ''
  if (!zClientToken) zClientToken = $os.getenv('ZAPI_CLIENT_TOKEN') || ''

  if (!zInstance || !zToken) {
    return e.json(200, {
      ok: false,
      error: 'ID da Instância ou Token da Z-API não foram configurados.',
    })
  }

  const headers = { 'Content-Type': 'application/json' }
  if (zClientToken) {
    headers['Client-Token'] = zClientToken
  }

  try {
    const statusUrl = 'https://api.z-api.io/instances/' + zInstance + '/token/' + zToken + '/status'
    console.log('[TEST-ZAPI] Consultando status Z-API em:', statusUrl)

    const res = $http.send({
      url: statusUrl,
      method: 'GET',
      headers: headers,
      timeout: 10,
    })

    console.log(
      '[TEST-ZAPI] Status code recebido:',
      res.statusCode,
      'body:',
      JSON.stringify(res.json || res.body),
    )

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const data = res.json || {}
      const connected = !!data.connected
      const phone = data.phone || data.connectedPhone || ''

      return e.json(200, {
        ok: true,
        connected: connected,
        phone: phone,
      })
    } else {
      const errMsg =
        (res.json && (res.json.message || res.json.error)) ||
        'Resposta inválida da Z-API (Status: ' + res.statusCode + ')'
      return e.json(200, {
        ok: false,
        error: errMsg,
      })
    }
  } catch (httpErr) {
    console.log('[TEST-ZAPI] Erro ao conectar com Z-API:', String(httpErr))
    return e.json(200, {
      ok: false,
      error: 'Falha ao conectar com o servidor da Z-API: ' + String(httpErr),
    })
  }
})
