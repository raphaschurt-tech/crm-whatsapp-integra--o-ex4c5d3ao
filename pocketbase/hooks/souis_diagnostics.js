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
      // Server responded at TCP level and reset/closed non-HTTP handshake
      sqlResult = 'ok'
    } else {
      sqlResult = 'failed'
    }
  }

  return e.json(200, {
    egress_ip: egressIp,
    egress_error: egressError,
    sql_server_test: {
      host: host,
      port: port,
      result: sqlResult,
      latency_ms: latencyMs,
      error_detail: rawError,
    },
  })
})
