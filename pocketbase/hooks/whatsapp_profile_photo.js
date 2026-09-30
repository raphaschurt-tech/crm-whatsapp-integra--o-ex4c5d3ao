// Endpoint autenticado para buscar foto de perfil do contato via Z-API
// Rota: GET /backend/v1/whatsapp/profile-photo?phone=...
// Retorno esperado: { photoUrl: string | null } (nunca retorna 500, erros/timeouts viram photoUrl: null)

routerAdd(
  'GET',
  '/backend/v1/whatsapp/profile-photo',
  (e) => {
    const rawPhone = String((e.requestInfo().query && e.requestInfo().query['phone']) || '').trim()

    if (!rawPhone) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    // Ignorar grupos ou LIDs
    const lowerPhone = rawPhone.toLowerCase()
    if (
      lowerPhone.includes('@g.us') ||
      lowerPhone.includes('-group') ||
      lowerPhone.includes('@lid')
    ) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    // Normalizar telefone (apenas números, DDI 55 + DDD + número)
    let cleanPhone = rawPhone.replace(/\D/g, '')
    if (cleanPhone.length >= 14 || cleanPhone.length < 10) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = '55' + cleanPhone
    }

    if (cleanPhone.length < 12 || cleanPhone.length > 13) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    // 1. Obter credenciais Z-API em settings
    let validConfigRec = null
    try {
      const validConfigs = $app.findRecordsByFilter(
        'settings',
        "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
        '-created',
        10,
        0,
      )
      if (validConfigs && validConfigs.length > 0) {
        validConfigRec = validConfigs[0]
      }
    } catch (err) {
      console.log('[PROFILE-PHOTO-SETTINGS-ERR]', err.message || String(err))
    }

    if (!validConfigRec) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
    const zapiToken = String(validConfigRec.get('zapi_token') || '')
    const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

    if (!zapiInstance || !zapiToken || !zapiClientToken) {
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }

    // 2. Chamar Z-API GET /instances/{id}/token/{token}/profile-picture?phone=...
    const url =
      'https://api.z-api.io/instances/' +
      encodeURIComponent(zapiInstance) +
      '/token/' +
      encodeURIComponent(zapiToken) +
      '/profile-picture?phone=' +
      encodeURIComponent(cleanPhone)

    const zapiHeaders = {
      'Content-Type': 'application/json',
      'Client-Token': zapiClientToken,
    }

    try {
      const res = $http.send({
        url: url,
        method: 'GET',
        headers: zapiHeaders,
        timeout: 10,
      })

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = res.json || {}
        const rawLink =
          data.link ||
          data.photoUrl ||
          data.pictureUrl ||
          data.url ||
          data.profilePictureUrl ||
          null

        const photoUrl = typeof rawLink === 'string' && rawLink.startsWith('http') ? rawLink : null

        return e.json(200, {
          ok: true,
          photoUrl: photoUrl,
        })
      } else {
        // Z-API pode retornar 400/404 se o contato não tem foto ou privacidade ativada
        return e.json(200, {
          ok: true,
          photoUrl: null,
        })
      }
    } catch (httpErr) {
      // Timeout ou erro de rede da Z-API -> responder null com 200 (nunca 500)
      console.log('[PROFILE-PHOTO-HTTP-ERR]', cleanPhone, httpErr.message || String(httpErr))
      return e.json(200, {
        ok: true,
        photoUrl: null,
      })
    }
  },
  $apis.requireAuth(),
)
