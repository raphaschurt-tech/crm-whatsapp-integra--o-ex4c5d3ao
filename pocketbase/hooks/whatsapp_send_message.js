// Endpoint autenticado para envio direto de mensagens via WhatsApp (Z-API) pelo atendente
// Rota: POST /backend/v1/whatsapp/send-message
// Body: {
//   phone: string,
//   message?: string,
//   document?: string,       // base64 ou URL (data:application/...;base64,... ou link)
//   fileName?: string,
//   isImage?: boolean,       // quando true, usa /send-image
//   image?: string,          // base64 ou URL de imagem (se passado separadamente ou via document)
//   caption?: string         // legenda
// }
routerAdd(
  'POST',
  '/backend/v1/whatsapp/send-message',
  (e) => {
    const reqInfo = e.requestInfo()
    const rawBody = reqInfo.body || {}

    const rawPhone = String(rawBody.phone || '')
    const message = String(rawBody.message || rawBody.caption || '').trim()
    const documentBase64 = String(rawBody.document || rawBody.image || '').trim()
    const documentFileName = String(rawBody.fileName || '').trim()
    const audioBase64 = String(rawBody.audioBase64 || rawBody.audio || '').trim()
    const audioMimeType = String(rawBody.audioMimeType || '').trim()
    const isAudio = Boolean(audioBase64)
    const isImage = Boolean(
      !isAudio &&
      (rawBody.isImage ||
        documentBase64.startsWith('data:image/') ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(documentFileName)),
    )

    if (!rawPhone) {
      return e.json(400, {
        ok: false,
        error: 'Telefone é obrigatório',
      })
    }

    if (!message && !documentBase64 && !audioBase64) {
      return e.json(400, {
        ok: false,
        error: 'Mensagem ou arquivo anexo é obrigatório',
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
    let zapiDocSuccess = false
    let zapiDocErrorDetail = ''

    if (validConfigRec && !configError) {
      const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
      const zapiToken = String(validConfigRec.get('zapi_token') || '')
      const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

      const zapiHeaders = {
        'Content-Type': 'application/json',
        'Client-Token': zapiClientToken,
      }

      // Se for envio de ÁUDIO (gravação de voz)
      if (isAudio) {
        try {
          const zapiAudioUrl =
            'https://api.z-api.io/instances/' +
            encodeURIComponent(zapiInstance) +
            '/token/' +
            encodeURIComponent(zapiToken) +
            '/send-audio'

          const audioPayload = {
            phone: cleanPhone,
            audio: audioBase64,
          }

          const audioRes = $http.send({
            url: zapiAudioUrl,
            method: 'POST',
            headers: zapiHeaders,
            body: JSON.stringify(audioPayload),
            timeout: 35,
          })

          zapiHttpStatus = audioRes.statusCode
          if (audioRes.statusCode >= 200 && audioRes.statusCode < 300) {
            zapiSuccess = true
            zapiDocSuccess = true
          } else {
            const respData = audioRes.json || audioRes.body || {}
            zapiErrorDetail =
              'Z-API audio status ' +
              audioRes.statusCode +
              ': ' +
              (respData.message || respData.error || String(audioRes.body || ''))
            zapiDocErrorDetail = zapiErrorDetail
          }
        } catch (audioErr) {
          zapiErrorDetail = audioErr.message || String(audioErr)
          zapiDocErrorDetail = zapiErrorDetail
        }
      } else if (documentBase64) {
        if (isImage) {
          // ENVIO DE IMAGEM via /send-image
          try {
            const zapiImgUrl =
              'https://api.z-api.io/instances/' +
              encodeURIComponent(zapiInstance) +
              '/token/' +
              encodeURIComponent(zapiToken) +
              '/send-image'

            const imgPayload = {
              phone: cleanPhone,
              image: documentBase64,
            }
            if (message) {
              imgPayload.caption = message
            }

            const imgRes = $http.send({
              url: zapiImgUrl,
              method: 'POST',
              headers: zapiHeaders,
              body: JSON.stringify(imgPayload),
              timeout: 30,
            })

            zapiHttpStatus = imgRes.statusCode
            if (imgRes.statusCode >= 200 && imgRes.statusCode < 300) {
              zapiSuccess = true
              zapiDocSuccess = true
            } else {
              const respData = imgRes.json || imgRes.body || {}
              zapiErrorDetail =
                'Z-API image status ' +
                imgRes.statusCode +
                ': ' +
                (respData.message || respData.error || String(imgRes.body || ''))
              zapiDocErrorDetail = zapiErrorDetail
            }
          } catch (imgErr) {
            zapiErrorDetail = imgErr.message || String(imgErr)
            zapiDocErrorDetail = zapiErrorDetail
          }
        } else {
          // ENVIO DE DOCUMENTO (PDF ou outro) via /send-document/{extension}
          let ext = 'pdf'
          if (documentFileName && documentFileName.includes('.')) {
            const parts = documentFileName.split('.')
            const lastPart = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '')
            if (lastPart) {
              ext = lastPart
            }
          } else if (documentBase64.startsWith('data:')) {
            const mimeMatch = documentBase64.match(/^data:([^;]+);/)
            if (mimeMatch && mimeMatch[1]) {
              const mime = mimeMatch[1].toLowerCase()
              if (mime.includes('pdf')) ext = 'pdf'
              else if (mime.includes('word') || mime.includes('docx')) ext = 'docx'
              else if (mime.includes('excel') || mime.includes('sheet') || mime.includes('xlsx'))
                ext = 'xlsx'
              else if (mime.includes('csv')) ext = 'csv'
              else if (mime.includes('text') || mime.includes('plain')) ext = 'txt'
            }
          }

          try {
            const zapiDocUrl =
              'https://api.z-api.io/instances/' +
              encodeURIComponent(zapiInstance) +
              '/token/' +
              encodeURIComponent(zapiToken) +
              '/send-document/' +
              encodeURIComponent(ext)

            const docPayload = {
              phone: cleanPhone,
              document: documentBase64,
              fileName: documentFileName || 'documento.' + ext,
            }
            if (message) {
              docPayload.caption = message
            }

            const docRes = $http.send({
              url: zapiDocUrl,
              method: 'POST',
              headers: zapiHeaders,
              body: JSON.stringify(docPayload),
              timeout: 35,
            })

            zapiHttpStatus = docRes.statusCode
            if (docRes.statusCode >= 200 && docRes.statusCode < 300) {
              zapiSuccess = true
              zapiDocSuccess = true
            } else {
              const docRespData = docRes.json || docRes.body || {}
              zapiDocErrorDetail =
                'Z-API doc status ' +
                docRes.statusCode +
                ': ' +
                (docRespData.message || docRespData.error || String(docRes.body || ''))
              zapiErrorDetail = zapiDocErrorDetail
            }
          } catch (docErr) {
            zapiDocErrorDetail = docErr.message || String(docErr)
            zapiErrorDetail = zapiDocErrorDetail
          }

          // Se for orçamento clássico (tinha mensagem longa E documento PDF e não aceitou caption ou precisamos garantir envio do texto se falhou):
          // Se o documento falhou mas havia texto, ou se o usuário mandou texto puro separado sem caption
          // No caso de send-document da Z-API, se foi enviado com caption, o WhatsApp entrega o documento com o texto.
        }
      } else {
        // ENVIO DE MENSAGEM PURA DE TEXTO via /send-text
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
      }
    } else {
      zapiErrorDetail = configError || 'Credenciais Z-API não configuradas'
    }

    // Gravar no webhook_received com fromMe=true para que apareça de imediato no histórico do chat
    const messageId = 'agent_' + Date.now() + '_' + $security.randomString(6)
    try {
      const colWebhook = $app.findCollectionByNameOrId('webhook_received')
      const rec = new Record(colWebhook)
      rec.set('type', 'AgentSentMessage')
      rec.set('phone', { phone: cleanPhone })
      rec.set('fromMe', true)
      rec.set('text', {
        message:
          message ||
          (isAudio ? 'Mensagem de voz' : documentFileName ? 'Arquivo: ' + documentFileName : ''),
      })
      rec.set('chat', { phone: cleanPhone })
      rec.set('sender', { role: 'agent' })
      rec.set('status', zapiSuccess ? 'SENT' : 'RECORDED_LOCAL')
      rec.set('messageId', messageId)
      rec.set('instanceId', validConfigRec ? validConfigRec.getString('zapi_instance_id') : '')
      rec.set('moment', Math.floor(Date.now() / 1000))

      if (isAudio) {
        rec.set('attachment_url', audioBase64)
        rec.set('attachment_name', 'Mensagem de voz')
        rec.set('attachment_type', 'audio')
        rec.set('is_audio', true)
        rec.set('audio_url', audioBase64)
      } else if (documentBase64) {
        rec.set('attachment_url', documentBase64)
        rec.set('attachment_name', documentFileName || (isImage ? 'imagem.png' : 'documento.pdf'))
        rec.set('attachment_type', isImage ? 'image' : 'document')
      }

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
        isAudio: isAudio,
        isImage: isImage,
        fileName: isAudio ? 'Mensagem de voz' : documentFileName || null,
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
