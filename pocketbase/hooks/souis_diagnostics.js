// Diagnostics endpoint for SOU.IS integration
// Returns egress IP of the server and connectivity test to db2.sou.is:1433

routerAdd('GET', '/backend/v1/souis/diagnostics', (e) => {
  let egressIp = null
  let egressError = null

  // 1. Fetch public egress IP using ipify and httpbin as fallback
  try {
    const ipRes = $http.send({
      url: 'https://api.ipify.org?format=json',
      method: 'GET',
      timeout: 10,
    })
    if (ipRes.statusCode === 200 && ipRes.json && ipRes.json.ip) {
      egressIp = ipRes.json.ip
    }
  } catch (err1) {
    try {
      const fallbackRes = $http.send({
        url: 'https://httpbin.org/get',
        method: 'GET',
        timeout: 10,
      })
      if (fallbackRes.statusCode === 200 && fallbackRes.json && fallbackRes.json.origin) {
        egressIp = fallbackRes.json.origin
      }
    } catch (err2) {
      egressError = 'ipify error: ' + String(err1) + ' | httpbin error: ' + String(err2)
    }
  }

  // 2. Connectivity test to db2.sou.is:1433
  const host = 'db2.sou.is'
  const port = 1433
  let sqlResult = 'unknown'
  let latencyMs = 0
  let rawError = null
  const startTime = new Date().getTime()

  try {
    $http.send({
      url: 'http://' + host + ':' + port,
      method: 'GET',
      timeout: 5,
    })
    latencyMs = new Date().getTime() - startTime
    sqlResult = 'ok'
  } catch (err) {
    latencyMs = new Date().getTime() - startTime
    const errStr = String(err).toLowerCase()
    rawError = String(err)
    if (
      errStr.indexOf('timeout') !== -1 ||
      errStr.indexOf('deadline') !== -1 ||
      latencyMs >= 4800
    ) {
      sqlResult = 'timeout'
    } else if (errStr.indexOf('refused') !== -1) {
      sqlResult = 'refused'
    } else if (errStr.indexOf('reset') !== -1 || errStr.indexOf('eof') !== -1) {
      // Server responded at TCP level and reset/closed non-HTTP handshake (port is open and reachable)
      sqlResult = 'open'
    } else {
      sqlResult = 'failed'
    }
  }

  console.log(
    '[SOU.IS Diagnostics] Egress IP: ' +
      egressIp +
      ' | Result: ' +
      sqlResult +
      ' | Latency: ' +
      latencyMs +
      'ms | Error: ' +
      rawError,
  )

  // 3. Teste da Bridge HTTP SOU.IS (se configurada via SOIS_BRIDGE_URL ou settings)
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  const bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  if (!bridgeUrl) {
    try {
      const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
      if (setting) {
        const rawUrl = setting.getString('stock_api_url')
        if (rawUrl && (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)) {
          bridgeUrl = rawUrl
        }
      }
    } catch (_) {}
  }

  let bridgeTest = {
    configured: false,
    url: null,
    status: 'bridge_not_configured',
    message:
      'Defina a variável SOIS_BRIDGE_URL (e opcionalmente SOIS_BRIDGE_TOKEN) para ativar o teste da ponte.',
  }

  if (bridgeUrl) {
    let cleanUrl = bridgeUrl
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1)
    }
    const healthUrl = cleanUrl.includes('/health') ? cleanUrl : cleanUrl + '/health'

    const bStartTime = new Date().getTime()
    try {
      const bHeaders = { 'Content-Type': 'application/json' }
      if (bridgeToken) {
        bHeaders['X-Bridge-Token'] = bridgeToken
      }

      const bRes = $http.send({
        url: healthUrl,
        method: 'GET',
        headers: bHeaders,
        timeout: 10,
      })

      const bLatency = new Date().getTime() - bStartTime
      bridgeTest = {
        configured: true,
        url: cleanUrl,
        health_endpoint: healthUrl,
        http_status: bRes.statusCode,
        status: bRes.statusCode === 200 ? 'online' : 'error',
        latency_ms: bLatency,
        response: bRes.json || bRes.body,
        token_configured: Boolean(bridgeToken),
      }
    } catch (bErr) {
      const bLatency = new Date().getTime() - bStartTime
      bridgeTest = {
        configured: true,
        url: cleanUrl,
        health_endpoint: healthUrl,
        status: 'unreachable',
        latency_ms: bLatency,
        error: String(bErr),
        token_configured: Boolean(bridgeToken),
      }
    }
  }

  return e.json(200, {
    egress_ip: egressIp,
    egress_error: egressError,
    sql_server_test: {
      host: host,
      port: port,
      status: sqlResult === 'open' ? 'porta_aberta' : sqlResult,
      result: sqlResult,
      latency_ms: latencyMs,
      error_detail: rawError,
      firewall_status: sqlResult === 'open' ? 'liberado' : 'bloqueado',
    },
    bridge_test: bridgeTest,
    tds_runtime_capability: {
      sandbox: 'PocketBase Goja (JS/ES5 runtime)',
      has_native_tds_driver: false,
      available_external_io: ['$http.send'],
      supports_direct_tds_socket: false,
      recommended_architecture:
        'Bridge / Middleware HTTP (ex: Node.js/Cloudflare Worker/microservico com mssql/tedious exposto em rota protegida que chama a View e entrega JSON para $http.send)',
    },
  })
})
