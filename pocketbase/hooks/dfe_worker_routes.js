// pocketbase/hooks/dfe_worker_routes.js
// Rotas Customizadas dedicadas ao Worker DFe (Fase 2 - CF-1b, CF-1c, CF-2, CF-3, D1-D12)
// O worker Node.js externo acessa o CRM APENAS por estas rotas customizadas autenticadas por Token DFe dedicado.
// Todas as funções são estritamente auto-contidas dentro de cada callback (Goja JSVM isolation).

// 0. Rota: POST /backend/v1/dfe/ingest (Worker empurra XML capturado no DFe para o MESMO pipeline de ingestão - D1, CF-3b)
routerAdd('POST', '/backend/v1/dfe/ingest', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    let body = {}
    try {
      body = e.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    const xmlContent = body.xml || body.xml_content || ''
    if (!xmlContent || typeof xmlContent !== 'string') {
      return e.json(400, { success: false, error: 'Campo xml obrigatório.' })
    }

    // Encaminhar para o pipeline de NF-e via chamada HTTP interna (porta 8090)
    // CF-3b: Aceita XML bruto no MESMO formato do upload manual, marcando origem "dfe"
    const appUrl = $os.getenv('APP_URL') || 'http://127.0.0.1:8090'
    const res = $http.send({
      url: appUrl + '/backend/v1/nfe/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        xml: xmlContent,
        source_channel: 'dfe',
      }),
      timeout: 30,
    })

    let respData = {}
    try {
      respData = JSON.parse(res.rawText)
    } catch (_) {
      respData = { status: res.statusCode, raw: res.rawText }
    }

    return e.json(res.statusCode, respData)
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 1. Rota: GET /backend/v1/dfe/status (Worker lê estado do ponteiro e configurações DFe)
routerAdd('GET', '/backend/v1/dfe/status', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, {
      success: false,
      error: 'Token DFe não fornecido (header X-DFe-Token obrigatório).',
    })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    const dfeEnabled = settingsRec.getBool('dfe_enabled')
    const pollInterval = Number(settingsRec.get('dfe_poll_interval_hours')) || 1
    const companyCnpj = String(settingsRec.getString('company_cnpj') || '').replace(/\D/g, '')

    let pointerRec = null
    try {
      pointerRec = $app.findFirstRecordByFilter('dfe_pointer_state', "id != ''")
    } catch (_) {}

    return e.json(200, {
      success: true,
      dfe_enabled: dfeEnabled,
      poll_interval_hours: pollInterval,
      company_cnpj: companyCnpj,
      pointer: pointerRec
        ? {
            id: pointerRec.id,
            ult_nsu: pointerRec.getString('ult_nsu') || '0',
            max_nsu: pointerRec.getString('max_nsu') || '0',
            is_initialized: pointerRec.getBool('is_initialized'),
            last_poll_at: pointerRec.getString('last_poll_at'),
            last_success_at: pointerRec.getString('last_success_at'),
            last_error: pointerRec.getString('last_error'),
            consecutive_failures: Number(pointerRec.get('consecutive_failures')) || 0,
            cert_cnpj: pointerRec.getString('cert_cnpj'),
            cert_valid_until: pointerRec.getString('cert_valid_until'),
            cert_days_remaining: Number(pointerRec.get('cert_days_remaining')) || 0,
            worker_status: pointerRec.getString('worker_status') || 'offline',
            cstat_last: pointerRec.getString('cstat_last'),
            is_running: pointerRec.getBool('is_running'),
          }
        : null,
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 2. Rota: POST /backend/v1/dfe/pointer (Worker atualiza ponteiro e status)
routerAdd('POST', '/backend/v1/dfe/pointer', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    let body = {}
    try {
      body = e.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    let pointerRec = null
    try {
      pointerRec = $app.findFirstRecordByFilter('dfe_pointer_state', "id != ''")
    } catch (_) {}

    if (!pointerRec) {
      const col = $app.findCollectionByNameOrId('dfe_pointer_state')
      pointerRec = new Record(col)
    }

    // Helper fuso Brasília inline
    let bIso = ''
    try {
      bIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
    } catch (_) {
      bIso = new Date().toISOString()
    }

    if (body.ult_nsu !== undefined) pointerRec.set('ult_nsu', String(body.ult_nsu))
    if (body.max_nsu !== undefined) pointerRec.set('max_nsu', String(body.max_nsu))
    if (body.is_initialized !== undefined)
      pointerRec.set('is_initialized', Boolean(body.is_initialized))
    if (body.is_running !== undefined) pointerRec.set('is_running', Boolean(body.is_running))
    if (body.cstat_last !== undefined) pointerRec.set('cstat_last', String(body.cstat_last))

    if (body.success) {
      pointerRec.set('last_success_at', bIso)
      pointerRec.set('consecutive_failures', 0)
      pointerRec.set('last_error', '')
      pointerRec.set('worker_status', 'online')
    } else if (body.error) {
      pointerRec.set('last_error', String(body.error))
      const currentFails = Number(pointerRec.get('consecutive_failures')) || 0
      pointerRec.set('consecutive_failures', currentFails + 1)
      if (currentFails + 1 >= 3) {
        pointerRec.set('worker_status', 'error')
      }
    }

    pointerRec.set('last_poll_at', bIso)

    if (body.cert_cnpj !== undefined) pointerRec.set('cert_cnpj', String(body.cert_cnpj))
    if (body.cert_valid_until !== undefined)
      pointerRec.set('cert_valid_until', String(body.cert_valid_until))
    if (body.cert_days_remaining !== undefined)
      pointerRec.set('cert_days_remaining', Number(body.cert_days_remaining))

    $app.save(pointerRec)

    return e.json(200, {
      success: true,
      ult_nsu: pointerRec.getString('ult_nsu'),
      max_nsu: pointerRec.getString('max_nsu'),
      is_initialized: pointerRec.getBool('is_initialized'),
      consecutive_failures: Number(pointerRec.get('consecutive_failures')) || 0,
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 3. Rota: GET /backend/v1/dfe/commands (Worker lê comandos pendentes - CF-1b)
routerAdd('GET', '/backend/v1/dfe/commands', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    const pendingCmds = $app.findRecordsByFilter(
      'dfe_command_queue',
      "status = 'pendente'",
      'created',
      5,
      0,
    )

    const list = []
    for (let i = 0; i < pendingCmds.length; i++) {
      const c = pendingCmds[i]
      list.push({
        id: c.id,
        command: c.getString('command'),
        params: c.get('params') || {},
        created: c.getString('created'),
      })
    }

    return e.json(200, { success: true, commands: list })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 4. Rota: POST /backend/v1/dfe/commands/{id}/ack (Worker atualiza status de comando)
routerAdd('POST', '/backend/v1/dfe/commands/{id}/ack', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    const cmdId = e.request.pathValue('id')
    let body = {}
    try {
      body = e.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    const cmdRec = $app.findRecordById('dfe_command_queue', cmdId)
    if (body.status) {
      cmdRec.set('status', body.status)
    }
    if (body.result_summary) {
      cmdRec.set('result_summary', String(body.result_summary))
    }

    let bIso = ''
    try {
      bIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
    } catch (_) {
      bIso = new Date().toISOString()
    }

    cmdRec.set('executed_at', bIso)
    $app.save(cmdRec)

    return e.json(200, { success: true, id: cmdRec.id, status: cmdRec.getString('status') })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 5. Rota: POST /backend/v1/dfe/history (Registrar backlog zero-impacto ou histórico DFe - D2)
routerAdd('POST', '/backend/v1/dfe/history', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    let body = {}
    try {
      body = e.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    const accessKey = String(body.access_key || '').replace(/\D/g, '')
    if (!accessKey || accessKey.length !== 44) {
      return e.json(400, { success: false, error: 'access_key (44 dígitos) obrigatória.' })
    }

    let existingHist = null
    try {
      existingHist = $app.findFirstRecordByFilter('dfe_history', 'access_key = {:key}', {
        key: accessKey,
      })
    } catch (_) {}

    const col = $app.findCollectionByNameOrId('dfe_history')
    const histRec = existingHist || new Record(col)

    histRec.set('access_key', accessKey)
    if (body.nsu) histRec.set('nsu', String(body.nsu))
    if (body.schema) histRec.set('schema', String(body.schema))
    if (body.model) histRec.set('model', String(body.model))
    if (body.emitter_cnpj) histRec.set('emitter_cnpj', String(body.emitter_cnpj).replace(/\D/g, ''))
    if (body.emitter_name) histRec.set('emitter_name', String(body.emitter_name))
    if (body.issue_date) histRec.set('issue_date', String(body.issue_date))
    if (body.total_amount !== undefined) histRec.set('total_amount', Number(body.total_amount) || 0)
    if (body.nfe_number) histRec.set('nfe_number', String(body.nfe_number))
    if (body.document_type) histRec.set('document_type', String(body.document_type))
    if (body.is_backlog !== undefined) histRec.set('is_backlog', Boolean(body.is_backlog))
    if (body.raw_xml) histRec.set('raw_xml', String(body.raw_xml))

    $app.save(histRec)

    return e.json(200, { success: true, id: histRec.id, access_key: accessKey })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 6. Rota: POST /backend/v1/dfe/event (Worker empurra eventos da SEFAZ: cancelamento, CC-e - D5)
routerAdd('POST', '/backend/v1/dfe/event', (e) => {
  const authHeader =
    e.requestInfo().headers['x-dfe-token'] ||
    e.requestInfo().headers['authorization'] ||
    e.requestInfo().headers['x-api-key'] ||
    ''

  let token = String(authHeader).trim()
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return e.json(401, { success: false, error: 'Token DFe não fornecido.' })
  }

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações do sistema não encontradas.' })
    }

    const dfeToken = String(settingsRec.getString('dfe_worker_token') || '').trim()
    const tokenActive = settingsRec.getBool('dfe_token_active')

    if (!dfeToken || !tokenActive || token !== dfeToken) {
      return e.json(403, { success: false, error: 'Token DFe inválido, inativo ou revogado.' })
    }

    let body = {}
    try {
      body = e.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    const accessKey = String(body.access_key || '').replace(/\D/g, '')
    const eventType = String(body.event_type || '').trim() // '110111' = Cancelamento, '110110' = CC-e

    if (!accessKey || accessKey.length !== 44 || !eventType) {
      return e.json(400, {
        success: false,
        error: 'access_key (44 dígitos) e event_type são obrigatórios.',
      })
    }

    let bIso = ''
    try {
      bIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
    } catch (_) {
      bIso = new Date().toISOString()
    }

    // 1. Gravar registro em dfe_events
    const eventCol = $app.findCollectionByNameOrId('dfe_events')
    const eventRec = new Record(eventCol)
    eventRec.set('access_key', accessKey)
    if (body.nsu) eventRec.set('nsu', String(body.nsu))
    eventRec.set('event_type', eventType)
    eventRec.set(
      'event_desc',
      String(
        body.event_desc || (eventType === '110111' ? 'Cancelamento de NF-e' : 'Carta de Correção'),
      ),
    )
    if (body.event_seq) eventRec.set('event_seq', Number(body.event_seq) || 1)
    eventRec.set('event_date', String(body.event_date || bIso))
    if (body.protocol) eventRec.set('protocol', String(body.protocol))
    if (body.justification) eventRec.set('justification', String(body.justification))
    if (body.correction_text) eventRec.set('correction_text', String(body.correction_text))
    if (body.raw_xml) eventRec.set('raw_xml', String(body.raw_xml))

    // 2. Verificar se a NF-e já foi processada no CRM (D5)
    let processedNfe = null
    try {
      processedNfe = $app.findFirstRecordByFilter('nfe_processed', 'access_key = {:key}', {
        key: accessKey,
      })
    } catch (_) {}

    eventRec.set('nfe_found_in_crm', Boolean(processedNfe))

    let apMarked = false
    let actionSummary = ''

    if (processedNfe) {
      if (eventType === '110111') {
        // D5 — EVENTO-CANCEL: NF-e já processada cancelada!
        // Marcar contas a pagar correspondente como "cancelado" com observação explícita
        // NUNCA apagar o lançamento; NUNCA tocar estoque!
        processedNfe.set('status', 'cancelada')
        processedNfe.set(
          'exception_reason',
          'NF-e CANCELADA NA SEFAZ (Evento 110111 recebido via DFe). Protocolo: ' +
            (body.protocol || 'N/A') +
            '. Justificativa: ' +
            (body.justification || 'Não informada'),
        )
        $app.save(processedNfe)

        // Buscar e marcar contas a pagar vinculadas a esta chave
        try {
          const payables = $app.findRecordsByFilter(
            'accounts_payable',
            'nfe_access_key = {:key}',
            'created',
            50,
            0,
            { key: accessKey },
          )
          for (let p = 0; p < payables.length; p++) {
            const ap = payables[p]
            ap.set('status', 'cancelado')
            const existingNotes = ap.getString('notes') || ''
            ap.set(
              'notes',
              existingNotes +
                ' [D5: NF cancelada na SEFAZ — NÃO PAGAR. Evento DFe em ' +
                bIso +
                ']',
            )
            $app.save(ap)
            apMarked = true
          }
        } catch (apErr) {
          console.log('[DFE-EVENT-AP-ERR]', String(apErr))
        }

        // Criar registro de alerta no painel de exceções (nfe_price_queue) para destaque visual (D5)
        try {
          const queueCol = $app.findCollectionByNameOrId('nfe_price_queue')
          const alertRec = new Record(queueCol)
          alertRec.set('nfe', processedNfe.id)
          alertRec.set('access_key', accessKey)
          alertRec.set(
            'description',
            'ALERTA: NF-e CANCELADA NA SEFAZ — Contas a pagar bloqueadas (NÃO PAGAR)',
          )
          alertRec.set('status', 'pendente')
          alertRec.set('item_type', 'excecao')
          alertRec.set(
            'resolution_notes',
            'Cancelamento oficial SEFAZ via DFe. Justificativa: ' + (body.justification || 'N/A'),
          )
          $app.save(alertRec)
        } catch (_) {}

        actionSummary =
          'Cancelamento aplicado: NF marcada como cancelada e contas a pagar bloqueadas (não pagar).'
        console.log(
          '[DFE-EVENT-CANCEL]',
          JSON.stringify({
            accessKey: accessKey,
            action: 'contas_a_pagar_canceladas_nao_pagar',
            horarioBrasilia: bIso,
          }),
        )
      } else if (eventType === '110110') {
        // CC-e: Carta de correção anexada às notas da NF
        const currentNotes = processedNfe.getString('notes') || ''
        processedNfe.set(
          'notes',
          currentNotes +
            '\n[CC-e ' +
            bIso +
            ']: ' +
            (body.correction_text || 'Carta de correção registrada via DFe'),
        )
        $app.save(processedNfe)
        actionSummary = 'CC-e anexada às notas da NF-e com sucesso.'
      } else {
        actionSummary = 'Evento recebido e anexado à NF-e processada.'
      }
    } else {
      actionSummary =
        'Evento de NF-e nunca processada no CRM. Gravado apenas no log/dfe_events (D5).'
      console.log(
        '[DFE-EVENT-UNMATCHED-LOG]',
        JSON.stringify({ accessKey: accessKey, eventType: eventType, action: 'log_only' }),
      )
    }

    eventRec.set('accounts_payable_marked', apMarked)
    $app.save(eventRec)

    return e.json(200, {
      success: true,
      event_id: eventRec.id,
      nfe_found: Boolean(processedNfe),
      accounts_payable_marked: apMarked,
      action: actionSummary,
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 7. Rota Administrativa: Gerar / Revogar Token DFe Dedicado (Frontend / Settings)
routerAdd('POST', '/backend/v1/dfe/token/manage', (e) => {
  const authUser = e.auth
  if (!authUser || authUser.getString('role') !== 'admin') {
    return e.json(403, { success: false, error: 'Acesso restrito a administradores.' })
  }

  let body = {}
  try {
    body = e.requestInfo().body || {}
  } catch (_) {
    body = {}
  }

  const action = body.action || 'generate' // 'generate' | 'revoke'

  try {
    const settingsRec = $app.findFirstRecordByFilter('settings', "id != ''")
    if (!settingsRec) {
      return e.json(500, { success: false, error: 'Configurações não encontradas.' })
    }

    if (action === 'generate') {
      const newToken = $security.randomString(48)
      settingsRec.set('dfe_worker_token', newToken)
      settingsRec.set('dfe_token_active', true)
      $app.save(settingsRec)

      return e.json(200, {
        success: true,
        action: 'generate',
        token: newToken,
        message: 'Novo Token DFe gerado com sucesso. Copie e configure no worker Node.js.',
      })
    } else if (action === 'revoke') {
      settingsRec.set('dfe_token_active', false)
      $app.save(settingsRec)

      return e.json(200, {
        success: true,
        action: 'revoke',
        message: 'Token DFe revogado com sucesso. O worker perderá o acesso no próximo ciclo.',
      })
    } else {
      return e.json(400, { success: false, error: 'Ação inválida. Use generate ou revoke.' })
    }
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})

// 8. Rota Administrativa: Enfileirar Comando "Consultar Agora" ou "Importação Retroativa" (CF-1b)
routerAdd('POST', '/backend/v1/dfe/commands/enqueue', (e) => {
  const authUser = e.auth
  if (!authUser || authUser.getString('role') !== 'admin') {
    return e.json(403, { success: false, error: 'Acesso restrito a administradores.' })
  }

  let body = {}
  try {
    body = e.requestInfo().body || {}
  } catch (_) {
    body = {}
  }

  const command = body.command || 'consultar_agora'
  const params = body.params || {}

  try {
    const col = $app.findCollectionByNameOrId('dfe_command_queue')
    const cmdRec = new Record(col)
    cmdRec.set('command', command)
    cmdRec.set('params', params)
    cmdRec.set('status', 'pendente')
    cmdRec.set('created_by', authUser.id)
    $app.save(cmdRec)

    return e.json(200, {
      success: true,
      id: cmdRec.id,
      command: command,
      message: 'comando enfileirado — executa no próximo ciclo do worker',
    })
  } catch (err) {
    return e.json(500, { success: false, error: err.message || String(err) })
  }
})
