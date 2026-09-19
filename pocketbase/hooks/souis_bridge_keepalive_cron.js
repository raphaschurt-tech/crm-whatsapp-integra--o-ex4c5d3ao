// Job agendado de keep-alive da ponte SOU.IS (Render Free)
// Frequência: a cada 14 minutos, de segunda a sexta-feira, das 09:00 às 18:00 (America/Sao_Paulo).
// Conversão de fuso para o scheduler PocketBase (UTC):
// Janela SP: 09:00 - 18:00 (UTC-3) -> Janela UTC: 12:00 - 21:00 (12, 13, 14, 15, 16, 17, 18, 19, 20, 21)
// Segunda a sexta: 1-5
// Expressão cron UTC: */14 12-21 * * 1-5
// Endpoint chamado: GET {SOIS_BRIDGE_URL}/health (público, sem token)

cronAdd('souis-bridge-keepalive', '*/14 12-21 * * 1-5', () => {
  let bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
  let bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''
  try {
    const setting = $app.findFirstRecordByFilter('settings', "id != ''")
    if (setting) {
      if (!bridgeUrl) {
        const rawUrl = setting.getString('stock_api_url')
        if (
          rawUrl &&
          !rawUrl.trim().startsWith('{') &&
          (rawUrl.indexOf('sou.is') !== -1 || rawUrl.indexOf('bridge') !== -1)
        ) {
          bridgeUrl = rawUrl
        }
      }
      if (!bridgeToken) {
        const rawToken = setting.getString('stock_api_token')
        if (rawToken) {
          bridgeToken = rawToken
        }
      }
    }
  } catch (_) {}

  // Se bridgeUrl não estiver definida, o job apenas pula, sem erro
  if (!bridgeUrl) {
    return
  }

  let cleanUrl = bridgeUrl
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }
  const healthUrl = cleanUrl.includes('/health') ? cleanUrl : cleanUrl + '/health'

  const startTime = new Date().getTime()
  try {
    const res = $http.send({
      url: healthUrl,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 20,
    })
    const latency = new Date().getTime() - startTime
    console.log(
      '[SOUIS-KEEPALIVE] status=' +
        res.statusCode +
        ' latency=' +
        latency +
        'ms endpoint=' +
        healthUrl +
        ' body=' +
        (res.raw ? res.raw.substring(0, 150) : res.body ? String(res.body).substring(0, 150) : ''),
    )
  } catch (err) {
    const latency = new Date().getTime() - startTime
    console.log(
      '[SOUIS-KEEPALIVE] status=error latency=' +
        latency +
        'ms msg=' +
        (err.message || String(err)),
    )
  }
})
