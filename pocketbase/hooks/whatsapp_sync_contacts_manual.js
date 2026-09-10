// Endpoint autenticado para sincronização manual de contatos do WhatsApp (Z-API) no CRM
// Rota: POST /backend/v1/whatsapp/sync-contacts
// Regras:
// - Paginar GET /contacts?pageSize=100&page=N até trazer todos os contatos
// - Ignorar grupos (@g.us ou hífen no chatId), números LID (@lid / IDs numéricos gigantes) e números vazios/inválidos
// - Cliente novo: criar com nome (name > short > vname > notify > telefone), telefone e origem 'WhatsApp', nota 'Contato importado do WhatsApp'
// - Cliente existente: atualizar apenas o nome se estiver com nome provisório igual ao número (nunca duplicar)
// - Exibir resumo com importados, atualizados e ignorados

routerAdd(
  'POST',
  '/backend/v1/whatsapp/sync-contacts',
  (e) => {
    console.log('[SYNC-CONTACTS-MANUAL-START]', new Date().toISOString())

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

    if (configError || !validConfigRec) {
      return e.json(400, {
        ok: false,
        error: configError || 'Credenciais Z-API não configuradas',
        imported: 0,
        updated: 0,
        ignored: 0,
        totalFetched: 0,
      })
    }

    const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
    const zapiToken = String(validConfigRec.get('zapi_token') || '')
    const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

    const zapiHeaders = {
      'Content-Type': 'application/json',
      'Client-Token': zapiClientToken,
    }

    // 2. Carregar todos os clientes existentes para deduplicação em memória rápida
    const custCol = $app.findCollectionByNameOrId('customers')
    let existingCustomers = []
    try {
      existingCustomers = $app.findRecordsByFilter('customers', '', '-created', 10000, 0)
    } catch (custErr) {
      console.log('[SYNC-CONTACTS-FETCH-CUSTOMERS-ERR]', custErr.message || String(custErr))
    }

    // Mapa de telefone normalizado (com 55) -> Record
    const customerByPhone = {}
    for (let c = 0; c < existingCustomers.length; c++) {
      const custRec = existingCustomers[c]
      const pRaw = String(custRec.getString('phone') || '')
      let pDigits = pRaw.replace(/\D/g, '')
      if (pDigits) {
        if (pDigits.length === 10 || pDigits.length === 11) {
          pDigits = '55' + pDigits
        }
        if (!customerByPhone[pDigits]) {
          customerByPhone[pDigits] = custRec
        }
      }
    }

    // 3. Paginando contatos da Z-API via GET /contacts?pageSize=X&page=N
    const pageSize = 100
    let page = 1
    let totalFetched = 0
    let importedCount = 0
    let updatedCount = 0
    let ignoredCount = 0
    let hasMore = true
    const maxPages = 200

    // Processados nesta execução para evitar duplicados caso a Z-API traga repetidos entre páginas
    const processedPhonesInRun = {}

    while (hasMore && page <= maxPages) {
      const url =
        'https://api.z-api.io/instances/' +
        encodeURIComponent(zapiInstance) +
        '/token/' +
        encodeURIComponent(zapiToken) +
        '/contacts?pageSize=' +
        pageSize +
        '&page=' +
        page

      let contactsBatch = null
      try {
        const res = $http.send({
          url: url,
          method: 'GET',
          headers: zapiHeaders,
          timeout: 30,
        })

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const bodyData = res.json || []
          if (Array.isArray(bodyData)) {
            contactsBatch = bodyData
          } else if (bodyData && Array.isArray(bodyData.data)) {
            contactsBatch = bodyData.data
          } else if (bodyData && Array.isArray(bodyData.contacts)) {
            contactsBatch = bodyData.contacts
          } else {
            contactsBatch = []
          }
        } else {
          console.log(
            '[SYNC-CONTACTS-PAGE-ERROR]',
            JSON.stringify({
              page: page,
              statusCode: res.statusCode,
              body: String(res.body || '').slice(0, 150),
            }),
          )
          break
        }
      } catch (httpEx) {
        console.log(
          '[SYNC-CONTACTS-HTTP-EX]',
          JSON.stringify({ page: page, error: httpEx.message || String(httpEx) }),
        )
        break
      }

      if (!contactsBatch || contactsBatch.length === 0) {
        hasMore = false
        break
      }

      totalFetched += contactsBatch.length

      for (let i = 0; i < contactsBatch.length; i++) {
        const item = contactsBatch[i]
        if (!item) {
          ignoredCount++
          continue
        }

        // Extração e verificação de grupos e LIDs
        const rawPhone = String(item.phone || item.id || item.chatId || '').trim()
        const rawName = String(item.name || '').trim()
        const rawShort = String(item.short || '').trim()
        const rawVname = String(item.vname || '').trim()
        const rawNotify = String(item.notify || '').trim()

        const lowerPhone = rawPhone.toLowerCase()

        // Ignorar grupos (@g.us ou hífen no chatId como 1203630...-group)
        if (
          lowerPhone.includes('@g.us') ||
          lowerPhone.includes('-group') ||
          lowerPhone.includes('-')
        ) {
          ignoredCount++
          continue
        }

        // Ignorar @lid ou IDs gigantes não-telefônicos
        if (lowerPhone.includes('@lid')) {
          ignoredCount++
          continue
        }

        // Extrair dígitos puros do telefone
        let cleanCandidate = rawPhone
        if (cleanCandidate.includes('@')) {
          cleanCandidate = cleanCandidate.split('@')[0]
        }
        const digits = cleanCandidate.replace(/\D/g, '')

        // Números com 14 ou mais dígitos são LIDs/inválidos no WhatsApp; menos de 10 dígitos não têm DDD
        if (digits.length >= 14 || digits.length < 10) {
          ignoredCount++
          continue
        }

        // Normalizar para padrão nacional 55 + DDD + número (12 ou 13 dígitos)
        let normalizedPhone = digits
        if (normalizedPhone.length === 10 || normalizedPhone.length === 11) {
          normalizedPhone = '55' + normalizedPhone
        }

        if (normalizedPhone.length < 12 || normalizedPhone.length > 13) {
          ignoredCount++
          continue
        }

        // Evitar duplicar processamento caso a Z-API retorne o mesmo telefone em páginas subsequentes
        if (processedPhonesInRun[normalizedPhone]) {
          ignoredCount++
          continue
        }
        processedPhonesInRun[normalizedPhone] = true

        // Resolver melhor nome: prioridade name > short > vname > notify > telefone
        let resolvedName = rawName || rawShort || rawVname || rawNotify || normalizedPhone
        resolvedName = resolvedName.trim()
        if (!resolvedName) {
          resolvedName = normalizedPhone
        }

        const existingRec = customerByPhone[normalizedPhone]

        if (!existingRec) {
          // Criar novo cliente
          try {
            const newCust = new Record(custCol)
            newCust.set('name', resolvedName)
            newCust.set('phone', normalizedPhone)
            newCust.set('type', 'PF')
            newCust.set('lead_source', 'whatsapp')
            newCust.set('notes', 'Contato importado do WhatsApp')
            newCust.set('pipeline_status', 'novo_lead')
            $app.save(newCust)

            customerByPhone[normalizedPhone] = newCust
            importedCount++
          } catch (createErr) {
            console.log(
              '[SYNC-CONTACTS-CREATE-ERR]',
              JSON.stringify({
                phone: normalizedPhone,
                error: createErr.message || String(createErr),
              }),
            )
            ignoredCount++
          }
        } else {
          // Cliente já existe: atualizar apenas o nome se estiver com nome provisório igual ao número
          const currentName = String(existingRec.getString('name') || '').trim()
          const currentPhoneDigits = String(existingRec.getString('phone') || '').replace(/\D/g, '')

          const isProvisional =
            !currentName ||
            currentName === normalizedPhone ||
            currentName === currentPhoneDigits ||
            currentName.replace(/\D/g, '') === currentPhoneDigits ||
            /^[0-9+\s()-]+$/.test(currentName)

          const hasBetterName =
            resolvedName && resolvedName !== normalizedPhone && resolvedName !== currentPhoneDigits

          if (isProvisional && hasBetterName) {
            try {
              existingRec.set('name', resolvedName)
              $app.save(existingRec)
              updatedCount++
            } catch (updateErr) {
              console.log(
                '[SYNC-CONTACTS-UPDATE-ERR]',
                JSON.stringify({
                  phone: normalizedPhone,
                  error: updateErr.message || String(updateErr),
                }),
              )
              ignoredCount++
            }
          } else {
            ignoredCount++
          }
        }
      }

      if (contactsBatch.length < pageSize) {
        hasMore = false
      } else {
        page++
      }
    }

    console.log(
      '[SYNC-CONTACTS-MANUAL-RESULT]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        imported: importedCount,
        updated: updatedCount,
        ignored: ignoredCount,
        totalFetched: totalFetched,
      }),
    )

    return e.json(200, {
      ok: true,
      imported: importedCount,
      updated: updatedCount,
      ignored: ignoredCount,
      totalFetched: totalFetched,
    })
  },
  $apis.requireAuth(),
)
