routerAdd('GET', '/backend/v1/debug-env', (e) => {
  const envVars = {
    PB_INSTANCE_URL: $os.getenv('PB_INSTANCE_URL'),
    SITE_URL: $os.getenv('SITE_URL'),
  }

  // Também tenta fazer um POST interno para a própria collection via localhost / internal se aplicável
  let localTest = null
  try {
    const res = $http.send({
      url: 'http://127.0.0.1:8080/api/collections/webhook_received/records',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ReceivedCallback',
        phone: { phone: '5511999999999', ddd: '11', number: '999999999' },
        fromMe: false,
        text: { message: 'teste-colecao-local' },
        chat: { chatId: '5511999999999@c.us', name: 'Teste' },
        sender: { phone: '5511999999999', name: 'Teste' },
        status: 'RECEIVED',
        messageId: 'TEST-MSG-001',
        instanceId: '3F82053E374BF28959D38ADBF15570D8',
        moment: 1693000000,
      }),
      timeout: 5,
    })
    localTest = {
      statusCode: res.statusCode,
      body: res.json || res.body,
    }
  } catch (err) {
    localTest = {
      error: err.message || String(err),
    }
  }

  return e.json(200, {
    env: envVars,
    localTest: localTest,
  })
})
