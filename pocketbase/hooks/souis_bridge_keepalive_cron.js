// Job agendado de keep-alive da ponte SOU.IS (Render Free)
// ATENÇÃO: TODOS os agendamentos cronAdd do PocketBase são interpretados estritamente em UTC.
//
// Frequência desejada: a cada 14 minutos, de segunda a sexta-feira, das 09:00 às 18:00 de Brasília (UTC-3).
// Conversão detalhada de fuso horário para UTC:
//   - Horário comercial de Brasília: 09:00 às 18:00 (UTC-3)
//   - Horário correspondente em UTC: 12:00 às 21:00 (UTC = Brasília + 3h)
//   - Intervalo de horas UTC: 12-21 (ou seja, 12:00, 13:00, ..., 21:00 UTC)
//   - Dias da semana: Segunda a Sexta (1-5 tanto em Brasília quanto em UTC nessa faixa diurna)
// Expressão cron UTC: '*/14 12-21 * * 1-5'
// Confirmação: A expressão atual '*/14 12-21 * * 1-5' já é 100% equivalente a 09:00 às 18:00 no horário de Brasília (UTC-3).
//
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
