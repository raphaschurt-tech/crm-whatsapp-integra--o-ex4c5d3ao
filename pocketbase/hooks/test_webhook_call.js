// Hook temporário para disparar requisição de teste interna ao webhook
onBootstrap((e) => {
  e.next()

  try {
    const pbUrl = $os.getenv('PB_INSTANCE_URL') || 'http://127.0.0.1:8090'
    const targetUrl = pbUrl.replace(/\/+$/, '') + '/backend/v1/whatsapp/webhook'

    const testPayload = {
      type: 'ReceivedCallback',
      instanceId: '3F82053E374BF28959D38ADBF15570D8',
      phone: '5511999998888',
      text: {
        message: 'Mensagem de teste de validacao do webhook'
      }
    }

    const res = $http.send({
      url: targetUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
      timeout: 5,
    })

    console.log('[TEST-WEBHOOK-CALL] Status:', res.statusCode, 'Body:', JSON.stringify(res.json || res.raw || ''))
  } catch (err) {
    console.log('[TEST-WEBHOOK-CALL] Erro ao disparar teste:', err.message || String(err))
  }
})
