// Endpoint autenticado para envio direto de mensagens via WhatsApp (Z-API) pelo atendente
// Rota: POST /backend/v1/whatsapp/send-message
// Body: { phone: string, message: string }
routerAdd(
  'POST',
  '/backend/v1/whatsapp/send-message',
  (e) => {
    const reqInfo = e.requestInfo()
    const rawBody = reqInfo.body || {}

    const rawPhone = String(rawBody.phone || '')
    const message = String(rawBody.message || '').trim()

    if (!rawPhone || !message) {
      return e.json(400, {
        ok: false,
        error: 'Telefone e mensagem são obrigatórios',
      })
    }

    // Verificar se é LID ou inválido
    if (rawPhone.toLowerCase().includes('@lid') || rawPhone.toLowerCase().includes('@g.us')) {
      return e.json(400, {
        ok: false,
        error: 'Não é permitido enviar mensagem direta para @lid ou grupos',
      })
    }

    // Normalizar telefone (apenas números)
    let cleanPhone = rawPhone.replace(/\D/g, '')
    if (cleanPhone.length >= 14 || cleanPhone.length < 10) {
      return e.json(400, {
        ok: false,
        error: 'Número de telefone inválido (deve ser um número de telefone real com DDD)',
      })
    }

    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = '55' + cleanPhone
    }

    let maskedPhone = '****'
    if (cleanPhone.length > 6) {
      maskedPhone = cleanPhone.slice(0, 4) + '****' + cleanPhone.slice(-2)
    }

    // 1. Obter configurações ativas da Z-API
    let validConfigRec = null
    let configError = ''

    try {
      const validConfigs = $app.findRecordsByFilter(
        'settings',
        "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
        '-created',
        10,
        0,
      )

      if (!validConfigs || validConfigs.length === 0) {
        configError = 'Nenhuma configuração válida encontrada (credenciais Z-API incompletas)'
      } else {
        validConfigRec = validConfigs[0]
      }
    } catch (err) {
      configError = 'Erro ao consultar configurações: ' + (err.message || String(err))
    }

    let zapiSuccess = false
    let zapiErrorDetail = ''
    let zapiHttpStatus = 0

    if (validConfigRec && !configError) {
      const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
      const zapiToken = String(validConfigRec.get('zapi_token') || '')
      const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

      const zapiHeaders = {
        'Content-Type': 'application/json',
        'Client-Token': zapiClientToken,
      }

      try {
        const zapiSendUrl =
          'https://api.z-api.io/instances/' +
          encodeURIComponent(zapiInstance) +
          '/token/' +
          encodeURIComponent(zapiToken) +
          '/send-text'

        const zapiRes = $http.send({
          url: zapiSendUrl,
          method: 'POST',
          headers: zapiHeaders,
          body: JSON.stringify({
            phone: cleanPhone,
            message: message,
          }),
          timeout: 15,
        })

        zapiHttpStatus = zapiRes.statusCode
        if (zapiRes.statusCode >= 200 && zapiRes.statusCode < 300) {
          zapiSuccess = true
        } else {
          const respData = zapiRes.json || zapiRes.body || {}
          zapiErrorDetail =
            'Z-API status ' +
            zapiRes.statusCode +
            ': ' +
            (respData.message || respData.error || String(zapiRes.body || ''))
        }
      } catch (httpErr) {
        zapiErrorDetail = httpErr.message || String(httpErr)
      }
    } else {
      zapiErrorDetail = configError || 'Credenciais Z-API não configuradas'
    }

    // 2. Enviar documento PDF opcional se fornecido (em base64 ou link)
    const documentBase64 = String(rawBody.document || '').trim()
    const documentFileName = String(rawBody.fileName || 'orcamento.pdf').trim()
    let zapiDocSuccess = false
    let zapiDocErrorDetail = ''

    if (documentBase64 && validConfigRec && !configError) {
      const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
      const zapiToken = String(validConfigRec.get('zapi_token') || '')
      const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

      const zapiHeaders = {
        'Content-Type': 'application/json',
        'Client-Token': zapiClientToken,
      }

      try {
        const zapiDocUrl =
          'https://api.z-api.io/instances/' +
          encodeURIComponent(zapiInstance) +
          '/token/' +
          encodeURIComponent(zapiToken) +
          '/send-document/pdf'

        const docRes = $http.send({
          url: zapiDocUrl,
          method: 'POST',
          headers: zapiHeaders,
          body: JSON.stringify({
            phone: cleanPhone,
            document: documentBase64,
            fileName: documentFileName,
          }),
          timeout: 20,
        })

        if (docRes.statusCode >= 200 && docRes.statusCode < 300) {
          zapiDocSuccess = true
        } else {
          const docRespData = docRes.json || docRes.body || {}
          zapiDocErrorDetail =
            'Z-API doc status ' +
            docRes.statusCode +
            ': ' +
            (docRespData.message || docRespData.error || String(docRes.body || ''))
        }
      } catch (docErr) {
        zapiDocErrorDetail = docErr.message || String(docErr)
      }
    }

    // 3. Gravar no webhook_received com fromMe=true para que apareça de imediato no histórico do chat
    const messageId = 'agent_' + Date.now() + '_' + $security.randomString(6)
    try {
      const colWebhook = $app.findCollectionByNameOrId('webhook_received')
      const rec = new Record(colWebhook)
      rec.set('type', 'AgentSentMessage')
      rec.set('phone', { phone: cleanPhone })
      rec.set('fromMe', true)
      rec.set('text', { message: message })
      rec.set('chat', { phone: cleanPhone })
      rec.set('sender', { role: 'agent' })
      rec.set('status', zapiSuccess ? 'SENT' : 'RECORDED_LOCAL')
      rec.set('messageId', messageId)
      rec.set('instanceId', validConfigRec ? validConfigRec.getString('zapi_instance_id') : '')
      rec.set('moment', Math.floor(Date.now() / 1000))
      $app.save(rec)
    } catch (dbErr) {
      console.log('[AGENT-SEND-PERSIST-ERR]', dbErr.message || String(dbErr))
    }

    console.log(
      '[AGENT-MESSAGE-SENT]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        phone: maskedPhone,
        zapiSuccess: zapiSuccess,
        zapiHttpStatus: zapiHttpStatus,
        docSent: zapiDocSuccess,
        error: zapiErrorDetail || null,
        docError: zapiDocErrorDetail || null,
      }),
    )

    return e.json(200, {
      ok: true,
      zapiSuccess: zapiSuccess,
      zapiHttpStatus: zapiHttpStatus,
      zapiError: zapiSuccess ? null : zapiErrorDetail,
      docSent: zapiDocSuccess,
      docError: zapiDocErrorDetail || null,
      messageId: messageId,
      phone: cleanPhone,
    })
  },
  $apis.requireAuth(),
)
