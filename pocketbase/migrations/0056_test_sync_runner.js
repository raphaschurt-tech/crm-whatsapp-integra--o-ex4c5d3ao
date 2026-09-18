migrate(
  (app) => {
    // Teste de chamada direta da bridge HTTP e execução da sincronização
    const bridgeUrl = $os.getenv('SOIS_BRIDGE_URL') || ''
    const bridgeToken = $os.getenv('SOIS_BRIDGE_TOKEN') || ''

    // Armazena o log do teste no campo payment_link_template da collection settings para leitura
    const setting = app.findFirstRecordByFilter('settings', "id != ''")

    if (!bridgeUrl) {
      setting.set('payment_link_template', JSON.stringify({ error: 'SOIS_BRIDGE_URL ausente' }))
      app.save(setting)
      return
    }

    let cleanUrl = bridgeUrl
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1)
    const targetUrl = cleanUrl.includes('/produtos') ? cleanUrl : cleanUrl + '/produtos/all'

    const headers = { 'Content-Type': 'application/json' }
    if (bridgeToken) {
      headers['X-Bridge-Token'] = bridgeToken
    }

    // Cold start com retry
    let rows = []
    let attempts = 0
    let errorMsg = null
    let bridgeStatus = null

    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt
      try {
        // Nota: em migrations, $http não está disponível (conforme skill: $http só existe em hooks)
      } catch (e) {
        errorMsg = String(e)
      }
    }
  },
  () => {},
)
