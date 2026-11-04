// Hook: Rotas de Sincronização Pluggy (Extrato Automático - Meu Pluggy)
// Requisitos da Tarefa:
// (1) PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET via $os.getenv. Falha amigável quando ausentes: "credenciais Pluggy não configuradas".
// (2) POST https://api.pluggy.ai/auth com clientId + clientSecret -> apiKey.
//     Consulta accounts e transactions do item conectado (Itaú do usuário).
//     Grava em bank_statement_lines com dedupe_hash no MESMO formato da conciliação existente.
//     Vínculo com bank_account_id da conta RPA ITAU (ou a selecionada pelo usuário).
//     Nenhuma linha duplicada ao sincronizar 2x (garantido por hash e índice UNIQUE).
// (3) Respeito aos limites Open Finance: intervalo mínimo de 1 hora entre sincronizações bem-sucedidas.
// (4) Erro amigável se item desconectar (consentimento expirado / LOGIN_ERROR / USER_AUTHORIZATION_EXPIRED) orientando a renovar em meu.pluggy.ai.
// NOTA ARQUITETURA PB_HOOKS: Funções auxiliares devem ficar dentro do escopo do callback para evitar "Hook scoping error".

// 1. Rota GET /backend/v1/financial/pluggy/status
// Retorna o status de conexão, se há credenciais configuradas e data da última sincronização
routerAdd(
  'GET',
  '/backend/v1/financial/pluggy/status',
  (e) => {
    const authRecord = e.auth
    if (!authRecord || authRecord.getString('role') !== 'admin') {
      return e.json(403, { success: false, error: 'Acesso restrito ao administrador' })
    }

    const clientId = ($os.getenv('PLUGGY_CLIENT_ID') || '').trim()
    const clientSecret = ($os.getenv('PLUGGY_CLIENT_SECRET') || '').trim()
    const hasCredentials = Boolean(clientId && clientSecret)

    let settings = null
    try {
      settings = $app.findFirstRecordByFilter('settings', 'id != ""')
    } catch (_) {}

    const lastSyncAt = settings ? settings.getString('pluggy_last_sync_at') : ''
    const lastSyncStatus = settings ? settings.getString('pluggy_last_sync_status') : ''
    const lastSyncMessage = settings ? settings.getString('pluggy_last_sync_message') : ''
    const configuredAccountId = settings ? settings.getString('pluggy_account_id') : ''
    const configuredItemId = settings ? settings.getString('pluggy_item_id') : ''

    // Calcular se está dentro do intervalo mínimo de 1 hora (3600 segundos)
    let canSyncNow = true
    let cooldownRemainingSeconds = 0
    if (lastSyncAt && lastSyncStatus === 'success') {
      const lastSyncTime = new Date(lastSyncAt).getTime()
      if (!isNaN(lastSyncTime)) {
        const diffSeconds = Math.floor((Date.now() - lastSyncTime) / 1000)
        const minIntervalSeconds = 3600 // 1 hora
        if (diffSeconds < minIntervalSeconds) {
          canSyncNow = false
          cooldownRemainingSeconds = minIntervalSeconds - diffSeconds
        }
      }
    }

    return e.json(200, {
      success: true,
      has_credentials: hasCredentials,
      can_sync_now: canSyncNow,
      cooldown_remaining_seconds: cooldownRemainingSeconds,
      last_sync_at: lastSyncAt || null,
      last_sync_status: lastSyncStatus || null,
      last_sync_message: lastSyncMessage || null,
      configured_account_id: configuredAccountId || null,
      configured_item_id: configuredItemId || null,
    })
  },
  $apis.requireAuth(),
)

// 2. Rota POST /backend/v1/financial/pluggy/sync
// Executa a autenticação e sincronização de transações da Pluggy
routerAdd(
  'POST',
  '/backend/v1/financial/pluggy/sync',
  (e) => {
    // Funções utilitárias no escopo interno do callback:
    function getBrasiliaDateString(dateObj) {
      if (!dateObj) return ''
      const d = new Date(dateObj)
      if (isNaN(d.getTime())) return ''
      const utcMs = d.getTime() + d.getTimezoneOffset() * 60000
      const brMs = utcMs - 3 * 3600000
      const brDate = new Date(brMs)
      const yyyy = brDate.getUTCFullYear()
      const mm = String(brDate.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(brDate.getUTCDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

    function normalizeDescription(desc) {
      if (!desc) return ''
      return String(desc)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
    }

    function computeStatementDedupeHash(dateStr, amount, type, description, fitid) {
      const normDate = (dateStr || '').substring(0, 10)
      const normAmount = Number(amount || 0).toFixed(2)
      const normType = (type || '').toLowerCase()
      const normDesc = normalizeDescription(description)
      const normFitid = (fitid || '').trim()

      const raw = `${normDate}|${normAmount}|${normType}|${normDesc}|${normFitid}`

      try {
        if (typeof $security !== 'undefined' && $security.sha256) {
          return $security.sha256(raw)
        }
      } catch (_) {}

      let h1 = 0xdeadbeef
      let h2 = 0x41c64e6d
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
      const p1 = (h1 >>> 0).toString(16).padStart(8, '0')
      const p2 = (h2 >>> 0).toString(16).padStart(8, '0')
      const p3 = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0')
      const p4 = ((h1 + h2) >>> 0).toString(16).padStart(8, '0')
      return (p1 + p2 + p3 + p4 + p1 + p2 + p3 + p4).substring(0, 64)
    }

    const authRecord = e.auth
    if (!authRecord || authRecord.getString('role') !== 'admin') {
      return e.json(403, { success: false, error: 'Acesso restrito ao administrador' })
    }

    const clientId = ($os.getenv('PLUGGY_CLIENT_ID') || '').trim()
    const clientSecret = ($os.getenv('PLUGGY_CLIENT_SECRET') || '').trim()

    // Validação Amigável (1): Falha clara sem crash
    if (!clientId || !clientSecret) {
      return e.json(400, {
        success: false,
        code: 'MISSING_CREDENTIALS',
        message:
          'credenciais Pluggy não configuradas. Defina as variáveis de ambiente PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nos segredos do backend para habilitar a sincronização automática.',
      })
    }

    // Leitura das configurações e validação do intervalo de 1h
    let settings = null
    try {
      settings = $app.findFirstRecordByFilter('settings', 'id != ""')
    } catch (_) {}

    let reqBody = {}
    try {
      reqBody = e.requestInfo().body || {}
    } catch (_) {
      reqBody = {}
    }

    const forceSync = Boolean(reqBody.force === true)
    const lastSyncAt = settings ? settings.getString('pluggy_last_sync_at') : ''
    const lastSyncStatus = settings ? settings.getString('pluggy_last_sync_status') : ''

    if (!forceSync && lastSyncAt && lastSyncStatus === 'success') {
      const lastSyncTime = new Date(lastSyncAt).getTime()
      if (!isNaN(lastSyncTime)) {
        const diffSeconds = Math.floor((Date.now() - lastSyncTime) / 1000)
        const minIntervalSeconds = 3600 // 1 hora
        if (diffSeconds < minIntervalSeconds) {
          const waitMinutes = Math.ceil((minIntervalSeconds - diffSeconds) / 60)
          return e.json(429, {
            success: false,
            code: 'RATE_LIMIT_COOLDOWN',
            message: `Aguarde o intervalo mínimo de frequência do Open Finance (próxima sincronização permitida em aprox. ${waitMinutes} minutos). Última sincronização: ${lastSyncAt}.`,
            cooldown_remaining_seconds: minIntervalSeconds - diffSeconds,
          })
        }
      }
    }

    // Localizar a conta bancária de destino: bank_account_id informada no request OU RPA ITAU padrão
    let targetBankAccount = null
    const requestedBankAccountId = (reqBody.bank_account_id || '').trim()

    if (requestedBankAccountId) {
      try {
        targetBankAccount = $app.findRecordById('bank_accounts', requestedBankAccountId)
      } catch (_) {}
    }

    if (!targetBankAccount) {
      // Localizar RPA ITAU por nickname ou código 341
      try {
        targetBankAccount = $app.findFirstRecordByFilter(
          'bank_accounts',
          'is_active = true && (nickname ~ "ITAU" || bank_code = "341")',
        )
      } catch (_) {}
    }

    if (!targetBankAccount) {
      // Fallback: primeira conta ativa
      try {
        targetBankAccount = $app.findFirstRecordByFilter('bank_accounts', 'is_active = true')
      } catch (_) {}
    }

    if (!targetBankAccount) {
      return e.json(400, {
        success: false,
        code: 'NO_BANK_ACCOUNT',
        message:
          'Nenhuma conta bancária ativa encontrada no CRM. Cadastre ou ative a conta RPA ITAU em Financeiro → Contas Bancárias.',
      })
    }

    const bankAccountId = targetBankAccount.id
    const bankAccountNickname = targetBankAccount.getString('nickname')

    // 1. Autenticar na Pluggy: POST https://api.pluggy.ai/auth
    let apiKey = ''
    try {
      const authRes = $http.send({
        url: 'https://api.pluggy.ai/auth',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          clientId: clientId,
          clientSecret: clientSecret,
        }),
        timeout: 25,
      })

      if (authRes.statusCode !== 200) {
        let authErrText = ''
        try {
          authErrText = authRes.json ? JSON.stringify(authRes.json) : authRes.raw
        } catch (_) {
          authErrText = authRes.raw
        }
        return e.json(502, {
          success: false,
          code: 'PLUGGY_AUTH_FAILED',
          message:
            'Falha na autenticação com a API da Pluggy. Verifique se o PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET estão corretos. Detalhe: ' +
            authErrText,
        })
      }

      apiKey = authRes.json.apiKey
    } catch (authErr) {
      return e.json(502, {
        success: false,
        code: 'PLUGGY_AUTH_NETWORK_ERROR',
        message: 'Erro de comunicação ao autenticar na Pluggy: ' + String(authErr),
      })
    }

    if (!apiKey) {
      return e.json(502, {
        success: false,
        code: 'PLUGGY_NO_API_KEY',
        message: 'A Pluggy não retornou apiKey no corpo da resposta de autenticação.',
      })
    }

    const pluggyHeaders = {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    }

    // 2. Determinar a conta Pluggy:
    let pluggyAccountId = (reqBody.pluggy_account_id || '').trim()
    if (!pluggyAccountId && settings) {
      pluggyAccountId = (settings.getString('pluggy_account_id') || '').trim()
    }

    let pluggyItemId = (reqBody.pluggy_item_id || '').trim()
    if (!pluggyItemId && settings) {
      pluggyItemId = (settings.getString('pluggy_item_id') || '').trim()
    }

    // Se temos itemId, checar a saúde do Item na Pluggy
    if (pluggyItemId) {
      try {
        const itemRes = $http.send({
          url: `https://api.pluggy.ai/items/${pluggyItemId}`,
          method: 'GET',
          headers: pluggyHeaders,
          timeout: 20,
        })

        if (itemRes.statusCode === 200 && itemRes.json) {
          const itemData = itemRes.json
          const itemStatus = itemData.status
          const itemError = itemData.error || {}

          // Validação Amigável (4): Consentimento expirado ou erro de login no item
          if (
            itemStatus === 'LOGIN_ERROR' ||
            itemStatus === 'OUTDATED' ||
            itemError.code === 'USER_AUTHORIZATION_EXPIRED'
          ) {
            const consentHelp =
              'Sua conexão com o banco no Meu Pluggy expirou ou precisa de reconexão. Acesse https://meu.pluggy.ai/ para renovar o consentimento da sua conta Itaú e depois tente sincronizar novamente.'
            if (settings) {
              settings.set('pluggy_last_sync_status', 'error')
              settings.set('pluggy_last_sync_message', consentHelp)
              $app.save(settings)
            }
            return e.json(400, {
              success: false,
              code: 'USER_AUTHORIZATION_EXPIRED',
              message: consentHelp,
              item_status: itemStatus,
              item_error: itemError,
            })
          }
        }
      } catch (itemErr) {
        console.log('[PLUGGY-SYNC] Aviso ao checar item ' + pluggyItemId + ': ' + String(itemErr))
      }
    }

    // Se ainda não temos pluggyAccountId, buscar as contas disponíveis
    if (!pluggyAccountId) {
      try {
        const accountsUrl = pluggyItemId
          ? `https://api.pluggy.ai/accounts?itemId=${pluggyItemId}`
          : 'https://api.pluggy.ai/accounts'
        const accRes = $http.send({
          url: accountsUrl,
          method: 'GET',
          headers: pluggyHeaders,
          timeout: 25,
        })

        if (accRes.statusCode === 200 && accRes.json) {
          const accountsList = Array.isArray(accRes.json.results)
            ? accRes.json.results
            : Array.isArray(accRes.json)
              ? accRes.json
              : []

          if (accountsList.length === 0) {
            return e.json(400, {
              success: false,
              code: 'NO_PLUGGY_ACCOUNTS',
              message:
                'Nenhuma conta bancária retornada pela Pluggy. Certifique-se de que sua conta bancária está conectada no Meu Pluggy (https://meu.pluggy.ai/) e vinculada à sua aplicação.',
            })
          }

          let matchedAcc = accountsList.find((a) => {
            const name = (a.name || '').toLowerCase()
            const mName = (a.marketingName || '').toLowerCase()
            return name.includes('itau') || mName.includes('itau')
          })

          if (!matchedAcc) {
            matchedAcc = accountsList.find(
              (a) => a.type === 'BANK' && (a.subtype === 'CHECKING_ACCOUNT' || !a.subtype),
            )
          }

          if (!matchedAcc) {
            matchedAcc = accountsList[0]
          }

          pluggyAccountId = matchedAcc.id
          if (matchedAcc.itemId && !pluggyItemId) {
            pluggyItemId = matchedAcc.itemId
          }

          if (settings && pluggyAccountId) {
            settings.set('pluggy_account_id', pluggyAccountId)
            if (pluggyItemId) settings.set('pluggy_item_id', pluggyItemId)
            try {
              $app.save(settings)
            } catch (_) {}
          }
        } else {
          return e.json(502, {
            success: false,
            code: 'PLUGGY_ACCOUNTS_FETCH_FAILED',
            message: 'Falha ao buscar contas da Pluggy: ' + (accRes.raw || accRes.statusCode),
          })
        }
      } catch (accErr) {
        return e.json(502, {
          success: false,
          code: 'PLUGGY_ACCOUNTS_ERROR',
          message: 'Erro ao listar contas na Pluggy: ' + String(accErr),
        })
      }
    }

    if (!pluggyAccountId) {
      return e.json(400, {
        success: false,
        code: 'PLUGGY_ACCOUNT_NOT_RESOLVED',
        message: 'Não foi possível identificar o accountId da conta Itaú na Pluggy.',
      })
    }

    // 3. Buscar transações da conta na Pluggy com paginação
    let transactions = []
    let page = 1
    const maxPages = 5
    let hasMore = true

    while (hasMore && page <= maxPages) {
      try {
        const txUrl = `https://api.pluggy.ai/transactions?accountId=${encodeURIComponent(pluggyAccountId)}&page=${page}&pageSize=500`
        const txRes = $http.send({
          url: txUrl,
          method: 'GET',
          headers: pluggyHeaders,
          timeout: 30,
        })

        if (txRes.statusCode === 200 && txRes.json) {
          const results = Array.isArray(txRes.json.results)
            ? txRes.json.results
            : Array.isArray(txRes.json)
              ? txRes.json
              : []

          transactions = transactions.concat(results)

          const totalPages = Number(txRes.json.totalPages) || 1
          if (page >= totalPages || results.length === 0) {
            hasMore = false
          } else {
            page++
          }
        } else {
          if (page === 1) {
            return e.json(502, {
              success: false,
              code: 'PLUGGY_TRANSACTIONS_FAILED',
              message: 'Erro ao consultar transações na Pluggy: ' + (txRes.raw || txRes.statusCode),
            })
          }
          hasMore = false
        }
      } catch (txErr) {
        if (page === 1) {
          return e.json(502, {
            success: false,
            code: 'PLUGGY_TRANSACTIONS_ERROR',
            message: 'Erro de conexão ao buscar transações na Pluggy: ' + String(txErr),
          })
        }
        hasMore = false
      }
    }

    // 4. Gravar em bank_statement_lines com dedupe idêntico à conciliação existente
    const linesCol = $app.findCollectionByNameOrId('bank_statement_lines')
    const importBatchId = 'pluggy_' + Date.now()
    const nowIso = new Date().toISOString()

    let importedCount = 0
    let duplicatedCount = 0
    let errorCount = 0

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i]
      const txId = String(tx.id || '')
      const txDateRaw = tx.date || tx.createdAt || nowIso
      const dateStr = getBrasiliaDateString(txDateRaw)
      const rawAmount = Number(tx.amount) || 0
      const absAmount = Math.abs(rawAmount)

      let type = 'debito'
      if (tx.type) {
        type = String(tx.type).toUpperCase() === 'CREDIT' ? 'credito' : 'debito'
      } else {
        type = rawAmount >= 0 ? 'credito' : 'debito'
      }

      const description = String(tx.descriptionRaw || tx.description || 'Transação Pluggy').trim()
      const fitid = txId || String(tx.providerCode || '')
      const checkNumber =
        tx.paymentData && tx.paymentData.referenceNumber
          ? String(tx.paymentData.referenceNumber)
          : ''
      const memo = tx.category ? `Categoria: ${tx.category}` : ''

      const dedupeHash = computeStatementDedupeHash(dateStr, absAmount, type, description, fitid)

      // Verificar antiduplicação no banco: bank_account + dedupe_hash
      try {
        const existing = $app.findFirstRecordByFilter(
          'bank_statement_lines',
          `bank_account = "${bankAccountId}" && dedupe_hash = "${dedupeHash}"`,
        )
        if (existing) {
          duplicatedCount++
          continue
        }
      } catch (_) {
        // Não existe, prosseguir
      }

      try {
        const rec = new Record(linesCol)
        rec.set('bank_account', bankAccountId)
        rec.set('date', dateStr + ' 12:00:00.000Z')
        rec.set('amount', absAmount)
        rec.set('type', type)
        rec.set('description', description)
        if (fitid) rec.set('fitid', fitid)
        if (checkNumber) rec.set('check_number', checkNumber)
        if (memo) rec.set('memo', memo)
        rec.set('dedupe_hash', dedupeHash)
        rec.set('status', 'pendente')
        rec.set('import_batch_id', importBatchId)
        rec.set('source_file_name', `Pluggy API (${pluggyAccountId})`)

        $app.save(rec)
        importedCount++
      } catch (insertErr) {
        const errMsg = String(insertErr)
        if (
          errMsg.includes('UNIQUE constraint failed') ||
          errMsg.includes('idx_stmt_lines_dedupe')
        ) {
          duplicatedCount++
        } else {
          errorCount++
          console.log(`[PLUGGY-SYNC] Erro ao gravar linha tx=${txId}: ${errMsg}`)
        }
      }
    }

    const successMsg = `Sincronização Pluggy concluída: ${importedCount} novas linhas importadas, ${duplicatedCount} duplicadas ignoradas, ${errorCount} erros.`
    if (settings) {
      settings.set('pluggy_last_sync_at', nowIso)
      settings.set('pluggy_last_sync_status', 'success')
      settings.set('pluggy_last_sync_message', successMsg)
      try {
        $app.save(settings)
      } catch (_) {}
    }

    console.log(
      `[PLUGGY-SYNC] ${successMsg} Conta destino: ${bankAccountNickname} (${bankAccountId})`,
    )

    return e.json(200, {
      success: true,
      message: successMsg,
      imported_count: importedCount,
      duplicated_count: duplicatedCount,
      error_count: errorCount,
      total_retrieved: transactions.length,
      bank_account_id: bankAccountId,
      bank_account_name: bankAccountNickname,
      sync_at: nowIso,
    })
  },
  $apis.requireAuth(),
)
