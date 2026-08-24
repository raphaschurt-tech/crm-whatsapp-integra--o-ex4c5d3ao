// 1. Registrar rotas do webhook IMEDIATAMENTE antes de qualquer chamada externa
// Handler GET para testar se a rota do webhook está ativa e funcional
routerAdd('GET', '/backend/v1/whatsapp/webhook', (e) => {
  return e.json(200, {
    status: 'ok',
    message: 'WhatsApp webhook is running',
  })
})

// Webhook para receber mensagens do WhatsApp (Z-API ou Evolution API), processar com IA e responder
routerAdd('POST', '/backend/v1/whatsapp/webhook', (e) => {
  let rawBody = e.requestInfo().body
  let body = {}

  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody)
    } catch (_) {
      body = {}
    }
  } else if (rawBody && typeof rawBody === 'object') {
    body = rawBody
  }

  console.log('[WEBHOOK] Body recebido:', JSON.stringify(body))

  // 1. Verificar configurações do sistema
  let settingsRec
  try {
    const list = $app.findRecordsByFilter('settings', '', '-created', 1, 0)
    if (list && list.length > 0) {
      settingsRec = list[0]
    }
  } catch (_) {}

  const aiEnabled = settingsRec ? settingsRec.getBool('ai_enabled') : false
  if (!aiEnabled) {
    return e.json(200, { status: 'ignored', reason: 'ai_disabled' })
  }

  // Obter credenciais (do settings ou secrets de ambiente)
  const openaiKey =
    (settingsRec ? settingsRec.getString('openai_api_key') : '') ||
    $os.getenv('OPENAI_API_KEY') ||
    ''
  const zapiInstance =
    (settingsRec ? settingsRec.getString('zapi_instance_id') : '') ||
    $os.getenv('ZAPI_INSTANCE_ID') ||
    ''
  const zapiToken =
    (settingsRec ? settingsRec.getString('zapi_token') : '') || $os.getenv('ZAPI_TOKEN') || ''
  const zapiClientToken =
    (settingsRec ? settingsRec.getString('zapi_client_token') : '') ||
    $os.getenv('ZAPI_CLIENT_TOKEN') ||
    ''
  const customPrompt = (settingsRec ? settingsRec.getString('ai_system_prompt') : '') || ''

  // 2. Extrair dados da mensagem recebida (formato padrão Z-API ou Evolution API)
  let fromPhone = ''
  let incomingText = ''
  let isFromMe = false

  // Formato Z-API
  if (body.phone) fromPhone = String(body.phone)
  if (body.text && body.text.message) incomingText = String(body.text.message)
  else if (typeof body.text === 'string') incomingText = body.text
  else if (body.message)
    incomingText =
      typeof body.message === 'string'
        ? body.message
        : body.message.conversation || body.message.text || ''
  if (body.isGroup) return e.json(200, { status: 'ignored', reason: 'group_message' })
  if (body.fromMe === true) isFromMe = true

  // Formato Evolution API
  if (!fromPhone && body.data && body.data.key) {
    fromPhone = String(body.data.key.remoteJid || '').replace('@s.whatsapp.net', '')
    isFromMe = body.data.key.fromMe === true
    if (body.data.message) {
      incomingText =
        body.data.message.extendedTextMessage?.text || body.data.message.conversation || ''
    }
  }

  // Normalizar telefone (apenas números)
  fromPhone = fromPhone.replace(/\D/g, '')

  if (!fromPhone || !incomingText || isFromMe) {
    return e.json(200, { status: 'ignored', reason: 'empty_or_from_me' })
  }

  console.log('[WEBHOOK] Mensagem recebida de:', fromPhone, 'texto:', incomingText)

  // 3. Buscar contexto no banco de dados (produtos em estoque e informações da empresa)
  let productsInfo = ''
  try {
    const products = $app.findRecordsByFilter('products', '', 'name', 50, 0)
    if (products && products.length > 0) {
      const itemsList = []
      for (let i = 0; i < products.length; i++) {
        const p = products[i]
        const name = p.getString('name')
        const sku = p.getString('sku')
        const price = p.getFloat('price')
        const stock = p.getInt('stock_quantity')
        const desc = p.getString('description')
        itemsList.push(
          '- ' +
            name +
            ' (SKU: ' +
            sku +
            '): R$ ' +
            price.toFixed(2) +
            ' | Estoque: ' +
            stock +
            ' un' +
            (desc ? ' | Detalhes: ' + desc : ''),
        )
      }
      productsInfo = itemsList.join('\n')
    }
  } catch (err) {
    console.log('Erro ao buscar produtos para prompt IA:', String(err))
  }

  // Buscar cliente se existir
  let customerName = ''
  try {
    const cust = $app.findFirstRecordByFilter('customers', "phone ~ '" + fromPhone.slice(-8) + "'")
    if (cust) {
      customerName = cust.getString('name')
    }
  } catch (_) {}

  // 4. Montar o System Prompt
  const defaultBasePrompt =
    'Você é o assistente virtual de atendimento comercial inteligente da empresa CRM Intragan.\n' +
    'Seu objetivo é atender os clientes de forma educada, prestativa, ágil e profissional via WhatsApp.\n' +
    'Você pode tirar dúvidas sobre produtos, estoque atual, preços e condições.\n' +
    'Sempre informe valores em Reais (R$).\n' +
    'Quando o cliente quiser fechar um pedido, solicitar desconto especial ou precisar de suporte avançado que não consiga resolver, informe educadamente que você irá transferir para um atendente humano da equipe.\n\n'

  const promptFinal =
    (customPrompt ? customPrompt + '\n\n' : defaultBasePrompt) +
    'PRODUTOS E ESTOQUE DISPONÍVEIS NO SISTEMA ATUALMENTE:\n' +
    (productsInfo || 'Nenhum produto cadastrado no momento.') +
    (customerName ? '\n\nCLIENTE IDENTIFICADO: ' + customerName : '')

  // 5. Processar resposta via IA (OpenAI API direta se tiver chave, ou $ai.chat Skip Gateway)
  let aiReplyText = ''
  try {
    if (openaiKey) {
      // Usar a chave da OpenAI fornecida
      const openAiRes = $http.send({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: promptFinal },
            { role: 'user', content: incomingText },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        timeout: 25,
      })

      if (
        openAiRes.statusCode === 200 &&
        openAiRes.json &&
        openAiRes.json.choices &&
        openAiRes.json.choices.length > 0
      ) {
        aiReplyText = openAiRes.json.choices[0].message.content
      } else {
        console.log(
          'OpenAI API retornou erro:',
          openAiRes.statusCode,
          JSON.stringify(openAiRes.json || openAiRes.body),
        )
      }
    }

    // Fallback para o gateway interno $ai.chat se não houver resposta ou sem chave OpenAI
    if (!aiReplyText) {
      try {
        const reply = $ai.chat({
          model: 'fast',
          messages: [
            { role: 'system', content: promptFinal },
            { role: 'user', content: incomingText },
          ],
        })
        if (reply && reply.choices && reply.choices.length > 0) {
          aiReplyText = reply.choices[0].message.content
        }
      } catch (aiErr) {
        console.log('Erro no $ai.chat gateway:', String(aiErr))
      }
    }
  } catch (err) {
    console.log('Erro no processamento da IA:', String(err))
  }

  if (!aiReplyText) {
    aiReplyText =
      'Olá! Recebemos sua mensagem, mas nosso assistente inteligente está temporariamente indisponível. Em breve um de nossos consultores humanos entrará em contato com você!'
  }

  console.log('[WEBHOOK] AI Response:', aiReplyText ? aiReplyText.substring(0, 100) : '')

  // 6. Enviar a resposta de volta pelo WhatsApp (Z-API ou Evolution API)
  let sent = false
  if (zapiInstance && zapiToken) {
    try {
      console.log('[WEBHOOK] Enviando resposta via Z-API para:', fromPhone)
      const zapiUrl =
        'https://api.z-api.io/instances/' + zapiInstance + '/token/' + zapiToken + '/send-text'
      const headers = { 'Content-Type': 'application/json' }
      if (zapiClientToken) {
        headers['Client-Token'] = zapiClientToken
      }

      const sendRes = $http.send({
        url: zapiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          phone: fromPhone,
          message: aiReplyText,
        }),
        timeout: 15,
      })

      console.log('[WEBHOOK] Resultado envio Z-API:', sendRes.statusCode)

      if (sendRes.statusCode >= 200 && sendRes.statusCode < 300) {
        sent = true
      } else {
        console.log(
          'Falha ao enviar mensagem Z-API:',
          sendRes.statusCode,
          JSON.stringify(sendRes.json || sendRes.body),
        )
      }
    } catch (zapiErr) {
      console.log('Erro de requisição Z-API:', String(zapiErr))
    }
  }

  return e.json(200, {
    status: 'success',
    sent: sent,
    phone: fromPhone,
    reply: aiReplyText,
  })
})

// Auto-configurar o webhook na Z-API em bloco seguro após registro das rotas
try {
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
  } catch (_) {}

  if (zInstance && zToken) {
    const webhookUrl =
      'https://crm-whatsapp-integracao-aee3e.goskip.app/backend/v1/whatsapp/webhook'
    const configHeaders = { 'Content-Type': 'application/json' }
    if (zClientToken) {
      configHeaders['Client-Token'] = zClientToken
    }

    try {
      const setWebhookRes = $http.send({
        url:
          'https://api.z-api.io/instances/' +
          zInstance +
          '/token/' +
          zToken +
          '/update-webhook-received',
        method: 'PUT',
        headers: configHeaders,
        body: JSON.stringify({ value: webhookUrl }),
        timeout: 5,
      })
      console.log('[WEBHOOK-INIT] Configurando Webhook Z-API:', setWebhookRes.statusCode)
    } catch (sendErr) {
      console.log('[WEBHOOK-INIT] Erro não-bloqueante ao configurar Z-API:', String(sendErr))
    }
  }
} catch (initErr) {
  console.log('[WEBHOOK-INIT] Erro geral não-bloqueante na inicialização:', String(initErr))
}
