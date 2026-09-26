// Cron leve a cada 2 minutos para verificar encerramento automático de atendimentos humanos por inatividade.
// PocketBase JSVM isola os escopos de cada callback, portanto toda lógica é autocontida aqui dentro.
cronAdd('ai_human_chat_auto_close_cron', '*/2 * * * *', () => {
  try {
    const validConfigs = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      1,
      0,
    )
    if (!validConfigs || validConfigs.length === 0) return
    const validConfigRec = validConfigs[0]

    const autoCloseMin = Number(validConfigRec.get('ai_auto_close_minutes')) || 0
    if (autoCloseMin <= 0) return // 0 = desativado

    const autoCloseMsg =
      String(validConfigRec.getString('ai_auto_close_message') || '').trim() ||
      'Atendimento encerrado por inatividade. Se precisar de algo, me chame aqui que continuo te ajudando! 🙂'

    const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
    const zapiToken = String(validConfigRec.get('zapi_token') || '')
    const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

    const activeHumanControls = $app.findRecordsByFilter(
      'chat_control',
      'human_mode = true',
      '-updated',
      50,
      0,
    )

    if (!activeHumanControls || activeHumanControls.length === 0) return

    const nowMs = Date.now()
    const timeoutMs = autoCloseMin * 60 * 1000

    for (let hci = 0; hci < activeHumanControls.length; hci++) {
      const ctrl = activeHumanControls[hci]
      const ctrlPhone = ctrl.getString('phone')
      if (!ctrlPhone) continue

      // Encontrar última interação (cliente OU atendente)
      let lastInteractionTimeMs = 0
      try {
        const cleanP = ctrlPhone.replace(/'/g, "\\'")
        const lastMsgs = $app.findRecordsByFilter(
          'webhook_received',
          "phone.phone = '" + cleanP + "' || chat.phone = '" + cleanP + "'",
          '-created',
          1,
          0,
        )
        if (lastMsgs && lastMsgs.length > 0) {
          const dt = new Date(lastMsgs[0].getString('created') || lastMsgs[0].created)
          if (!isNaN(dt.getTime())) {
            lastInteractionTimeMs = dt.getTime()
          }
        }
      } catch (_) {}

      if (!lastInteractionTimeMs) {
        const ctrlUp = new Date(ctrl.getString('updated') || ctrl.updated)
        if (!isNaN(ctrlUp.getTime())) {
          lastInteractionTimeMs = ctrlUp.getTime()
        }
      }

      const elapsedMs = nowMs - lastInteractionTimeMs
      if (elapsedMs >= timeoutMs) {
        console.log(
          '[AUTO-CLOSE-TRIGGERED]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: ctrlPhone.slice(0, 4) + '****' + ctrlPhone.slice(-2),
            elapsedMinutes: Math.round(elapsedMs / 60000),
            timeoutMinutes: autoCloseMin,
          }),
        )

        // 1. Enviar aviso de encerramento via Z-API ao cliente
        if (zapiInstance && zapiToken && zapiClientToken) {
          try {
            $http.send({
              url:
                'https://api.z-api.io/instances/' +
                encodeURIComponent(zapiInstance) +
                '/token/' +
                encodeURIComponent(zapiToken) +
                '/send-text',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Client-Token': zapiClientToken,
              },
              body: JSON.stringify({
                phone: ctrlPhone,
                message: autoCloseMsg,
              }),
              timeout: 10,
            })
          } catch (sendCloseErr) {
            console.log('[AUTO-CLOSE-SEND-ERR]', String(sendCloseErr))
          }
        }

        // Gravar aviso em webhook_received como fromMe=true para constar no chat sem apagar nada
        try {
          const colW = $app.findCollectionByNameOrId('webhook_received')
          const recW = new Record(colW)
          recW.set('type', 'AgentSentMessage')
          recW.set('phone', { phone: ctrlPhone })
          recW.set('fromMe', true)
          recW.set('text', { message: autoCloseMsg })
          recW.set('chat', { phone: ctrlPhone })
          recW.set('sender', { role: 'agent' })
          recW.set('status', 'SENT')
          recW.set('messageId', 'autoclose_' + Date.now() + '_' + $security.randomString(6))
          recW.set('moment', Math.floor(Date.now() / 1000))
          $app.save(recW)
        } catch (_) {}

        // 2. Reativar a IA (human_mode = false) LIMPANDO a marcação de motivo (paused_by)
        ctrl.set('human_mode', false)
        ctrl.set('paused_by', '')
        $app.save(ctrl)

        console.log(
          '[AUTO-CLOSE-COMPLETED]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: ctrlPhone.slice(0, 4) + '****' + ctrlPhone.slice(-2),
            human_mode: false,
            paused_by_cleared: true,
          }),
        )
      }
    }
  } catch (err) {
    console.log('[AUTO-CLOSE-GLOBAL-ERR]', String(err))
  }
})

// Hook assíncrono acionado após inserção bem-sucedida em message_processing
// Processa mensagens com IA (gpt-4o-mini) e envia resposta via Z-API com idempotência estrita
onRecordAfterCreateSuccess((e) => {
  // Limite configurável de interações anteriores a carregar do histórico (ex.: 20 registros = 10 do cliente + 10 da IA)
  const MAX_HISTORY_INTERACTIONS = 20

  const record = e.record
  const status = record.getString('status')
  const replySent = Boolean(record.get('replySent'))

  if (status !== 'received' || replySent) {
    return e.next()
  }

  const recordId = record.id
  const messageId = record.getString('messageId')
  const phone = record.getString('phone')
  const incomingText = record.getString('incomingText')

  // Blindagem estrita: rejeitar phones que sejam @lid ou inválidos (não responder a grupos ou LIDs)
  const isLidOrInvalid = (p) => {
    if (!p) return true
    const s = String(p).trim()
    if (s.toLowerCase().includes('@lid') || s.toLowerCase().includes('@g.us')) return true
    const d = s.replace(/\D/g, '')
    if (d.length < 10 || d.length > 13) return true
    return false
  }

  if (isLidOrInvalid(phone)) {
    console.log(
      '[AI-REJECTED-LID-OR-INVALID-PHONE]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        recordId: recordId,
        messageId: messageId,
      }),
    )
    try {
      procRecord = $app.findRecordById('message_processing', recordId)
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'Invalid phone number or WhatsApp LID')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // Mascarar telefone para logs sanitizados
  let maskedPhone = '****'
  if (phone && phone.length > 6) {
    maskedPhone = phone.slice(0, 4) + '****' + phone.slice(-2)
  }

  // 1. Transição atômica de estado para 'processing'
  let procRecord = null
  try {
    procRecord = $app.findRecordById('message_processing', recordId)
    if (procRecord.getString('status') !== 'received' || Boolean(procRecord.get('replySent'))) {
      return e.next()
    }
    procRecord.set('status', 'processing')
    $app.save(procRecord)
  } catch (lockErr) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: 'lock_state',
        messageId: messageId,
        error: lockErr.message || String(lockErr),
      }),
    )
    return e.next()
  }

  // 2. Ler e validar estritamente configurações ativas
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
    } else if (validConfigs.length > 1) {
      configError =
        'Múltiplas configurações válidas encontradas (' +
        validConfigs.length +
        '). É exigida configuração única'
    } else {
      validConfigRec = validConfigs[0]
    }
  } catch (err) {
    configError = 'Erro ao consultar configurações: ' + (err.message || String(err))
  }

  if (configError || !validConfigRec) {
    console.log(
      '[SETTINGS-INVALID]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        stage: 'ai_worker_init',
        error: configError,
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', configError)
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  const maskedInst = validConfigRec.getString('zapi_instance_id').slice(0, 4) + '****'
  console.log(
    '[SETTINGS-VALID]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      stage: 'ai_worker',
      configId: validConfigRec.id,
      instanceId: maskedInst,
      aiEnabled: Boolean(validConfigRec.get('ai_enabled')),
    }),
  )

  const iaEnabled = Boolean(validConfigRec.get('ai_enabled'))
  const authorizedPhone = String(validConfigRec.get('authorized_test_phone') || '').replace(
    /\D/g,
    '',
  )
  const openaiKey = String(validConfigRec.get('openai_api_key') || '')
  const zapiInstance = String(validConfigRec.get('zapi_instance_id') || '')
  const zapiToken = String(validConfigRec.get('zapi_token') || '')
  const zapiClientToken = String(validConfigRec.get('zapi_client_token') || '')

  // 3. Verificações de segurança no momento da execução
  if (!iaEnabled) {
    console.log(
      '[AI-DISABLED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'AI is disabled in settings')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // Execução de checagem defensiva de auto-close para este telefone específico (se estava em modo humano)
  // protegida por try/catch absoluto para que QUALQUER falha nunca derrube o processamento da mensagem.
  try {
    const autoCloseMin = Number(validConfigRec.get('ai_auto_close_minutes')) || 0
    if (autoCloseMin > 0 && phone) {
      let thisChatCtrl = null
      try {
        const foundCtrl = $app.findRecordsByFilter(
          'chat_control',
          'phone = {:p} && human_mode = true',
          '-updated',
          1,
          0,
          { p: phone },
        )
        if (foundCtrl && foundCtrl.length > 0) {
          thisChatCtrl = foundCtrl[0]
        }
      } catch (_) {}

      if (thisChatCtrl) {
        const ctrlUp = new Date(thisChatCtrl.getString('updated') || thisChatCtrl.updated)
        const ctrlTime = !isNaN(ctrlUp.getTime()) ? ctrlUp.getTime() : 0
        const elapsedMin = ctrlTime > 0 ? (Date.now() - ctrlTime) / 60000 : 999
        if (elapsedMin >= autoCloseMin) {
          thisChatCtrl.set('human_mode', false)
          thisChatCtrl.set('paused_by', '')
          $app.save(thisChatCtrl)
          console.log(
            '[AUTO-CLOSE-INLINE-RESOLVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              phone: maskedPhone,
              elapsedMin: Math.round(elapsedMin),
              human_mode: false,
            }),
          )
        }
      }
    }
  } catch (autoCloseErr) {
    console.log('[AUTO-CLOSE-SAFE-IGNORED]', String(autoCloseErr))
  }

  // Blindagem estrita de allowlist: com a IA LIGADA, ela responde APENAS ao telefone de teste
  // autorizado gravado em settings (authorized_test_phone) e a NINGUÉM mais.
  // Mensagens de outros números são ignoradas (registradas no log como ignoradas, sem resposta,
  // sem gastar tokens da OpenAI ou provedor).
  const cleanPhoneDigits = String(phone || '').replace(/\D/g, '')
  const cleanAuthPhoneDigits = String(authorizedPhone || '').replace(/\D/g, '')

  // Comparação tolerante com ou sem DDI 55
  const phoneWithoutDdi =
    cleanPhoneDigits.startsWith('55') && cleanPhoneDigits.length >= 12
      ? cleanPhoneDigits.slice(2)
      : cleanPhoneDigits
  const authWithoutDdi =
    cleanAuthPhoneDigits.startsWith('55') && cleanAuthPhoneDigits.length >= 12
      ? cleanAuthPhoneDigits.slice(2)
      : cleanAuthPhoneDigits

  const isAuthorizedNumber =
    Boolean(cleanAuthPhoneDigits) &&
    (cleanPhoneDigits === cleanAuthPhoneDigits || phoneWithoutDdi === authWithoutDdi)

  if (!isAuthorizedNumber) {
    console.log(
      '[UNAUTHORIZED-PHONE-IGNORED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        reason: 'Phone not in authorized_test_phone allowlist while AI is enabled',
      }),
    )
    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', 'Phone not authorized (allowlist active)')
      $app.save(procRecord)
    } catch (_) {}
    return e.next()
  }

  // 4. Formatação de data/hora atual no fuso America/Sao_Paulo (horário de Brasília)
  let dateTimeSP = ''
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    dateTimeSP = formatter.format(now)
  } catch (_) {
    // Fallback defensivo em caso de indisponibilidade de formatação específica de locale
    try {
      dateTimeSP = new Date().toISOString()
    } catch (_) {}
  }

  const timeContextLine = dateTimeSP
    ? '\n\nData/hora atual: ' + dateTimeSP + ' (horário de Brasília).'
    : ''

  // 5. Verificar se é a primeira resposta da IA na conversa para este telefone
  let isFirstAiReplyInConversation = false
  try {
    const cleanP = String(phone || '').replace(/'/g, "\\'")
    const prevReplies = $app.findRecordsByFilter(
      'message_processing',
      "phone = '" + cleanP + "' && replySent = true && id != '" + recordId + "'",
      '-created',
      1,
      0,
    )
    if (!prevReplies || prevReplies.length === 0) {
      isFirstAiReplyInConversation = true
    }
  } catch (firstReplyCheckErr) {
    console.log('[FIRST-REPLY-CHECK-ERR]', String(firstReplyCheckErr))
  }

  const firstReplyInstruction = isFirstAiReplyInConversation
    ? '\n\nEsta é a sua primeira resposta nesta conversa: cumprimente o cliente e apresente-se como assistente da RPA AUTO PARTS antes de responder.'
    : ''

  // 6. Configurar systemPrompt a partir de settings ou fallback mínimo cordial
  let configuredPrompt = String(validConfigRec.getString('ai_system_prompt') || '').trim()
  if (configuredPrompt) {
    configuredPrompt = configuredPrompt
      .replace(/NUNCA informe valor ou pre[çc]o ao cliente.*?transferir para atendente/gi, '')
      .replace(/NUNCA passe valor ou pre[çc]o.*?atendente humano/gi, '')
      .replace(/\[REGRA CR[ÍI]TICA DE PRE[ÇC]OS E ESTOQUE\][\s\S]*?(?=\n\n|$)/gi, '')
      .trim()
  }

  const fallbackPrompt =
    'Você é o assistente virtual da RPA AUTO PARTS, especializada em peças automotivas. ' +
    'Seja cordial, objetivo e atencioso. ' +
    'NÃO invente preços, estoque, prazos ou especificações técnicas.'

  // Meios de pagamento configurados
  const paymentMethodsConfig = String(validConfigRec.getString('ai_payment_methods') || '').trim()
  const effectivePaymentMethods =
    paymentMethodsConfig.length > 0
      ? paymentMethodsConfig
      : 'Pagamento via link enviado no orçamento'

  // Regras de ferramentas, preços, estoque, apresentação das opções e formas de pagamento
  const toolsAndPriceRules =
    '\n\n[FERRAMENTAS DE CONSULTA E REGRAS DE PREÇO/ESTOQUE]\n' +
    'Você possui ferramentas (function calling) para buscar produtos no catálogo e consultar estoque em tempo real:\n' +
    '1. buscar_produtos: use sempre que o cliente perguntar sobre qualquer peça, modelo, bucha, amortecedor, aplicação automotiva ou SKU. ' +
    'Pesquise por termos-chave relevantes (ex: "bucha d21", "amortecedor d21", SKU ou código de barras).\n' +
    '2. consultar_estoque_ao_vivo: use para obter o estoque atualizado em tempo real caso tenha o SKU do produto.\n' +
    '3. REGRA CRÍTICA DE APRESENTAÇÃO: Quando a busca encontrar produtos, SEMPRE cite as opções encontradas na resposta, com o nome completo (incluindo a faixa de anos, ex.: \'88/97\') e a descrição/aplicação de cada uma — mesmo quando estiverem sem estoque ou sem preço: "Encontrei estas opções para o seu veículo: ... Para todas, o valor fica sob consulta e nossa equipe confirma a disponibilidade." Se faltar informação essencial (ano/modelo do veículo, qual peça ou posição), pergunte ao cliente antes de buscar — nunca chute. Cumprimente o cliente na primeira mensagem da conversa.\n' +
    '4. REGRA CRÍTICA DE PREÇOS E ESTOQUE: Informe SOMENTE preço e estoque vindos das ferramentas. NUNCA invente ou estime valores ou estoque.\n' +
    '5. Se o estoque for 0, nulo ou indisponível OU se o preço for 0 ou nulo: NUNCA invente valor. Responda obrigatoriamente: "Sob consulta, nossa equipe confirma disponibilidade".\n' +
    '6. Se houver preço e estoque disponíveis no catálogo, informe claramente o nome da peça, marca/código, preço (R$) e disponibilidade.\n' +
    '7. MEIOS DE PAGAMENTO: Ao perguntarem sobre como pagar, formas de pagamento, parcelamento ou condições comerciais, responda com: "' +
    effectivePaymentMethods.replace(/"/g, "'") +
    '".\n' +
    '8. REGRA DE NÃO AUTO-TRANSFERÊNCIA: Você NÃO deve transferir para atendimento humano apenas porque o cliente perguntou preço ou estoque. Responda com os dados das ferramentas e continue o atendimento normalmente.\n' +
    'O marcador [TRANSFERIR-HUMANO] é estritamente reservado para casos genuínos: quando o cliente pedir expressamente para falar com um atendente/humano, reclamações sérias ou negociações comerciais avançadas fora do seu alcance.'

  const effectiveSystemPrompt =
    (configuredPrompt.length > 0 ? configuredPrompt : fallbackPrompt) +
    firstReplyInstruction +
    toolsAndPriceRules +
    timeContextLine
  // 6. Buscar histórico da conversa na collection message_processing para o mesmo telefone
  // Filtrar apenas interações anteriores já concluídas com resposta da IA enviada (replySent = true && aiReplyText != '')
  // e ignorar o registro atual
  let historyRecords = []
  try {
    const cleanPhone = String(phone || '').replace(/'/g, "\\'")
    const historyFilter =
      "phone = '" +
      cleanPhone +
      "' && replySent = true && aiReplyText != '' && id != '" +
      recordId +
      "'"

    historyRecords = $app.findRecordsByFilter(
      'message_processing',
      historyFilter,
      '-created',
      MAX_HISTORY_INTERACTIONS,
      0,
    )
  } catch (histErr) {
    console.log(
      '[AI-HISTORY-FETCH-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        error: histErr.message || String(histErr),
      }),
    )
    historyRecords = []
  }

  // Reverter para ordem cronológica (created ASC)
  const chronologicalHistory = (historyRecords || []).slice().reverse()

  // Montar array messages: system -> histórico (user / assistant) -> mensagem atual do cliente
  const chatMessages = [{ role: 'system', content: effectiveSystemPrompt }]
  let historyTurnsCount = 0

  for (let i = 0; i < chronologicalHistory.length; i++) {
    const histItem = chronologicalHistory[i]
    const histUserText = histItem.getString('incomingText')
    const histAiText = histItem.getString('aiReplyText')

    if (histUserText && histUserText.trim()) {
      chatMessages.push({ role: 'user', content: histUserText.trim() })
      historyTurnsCount++
    }
    if (histAiText && histAiText.trim()) {
      chatMessages.push({ role: 'assistant', content: histAiText.trim() })
      historyTurnsCount++
    }
  }

  // Mensagem atual do usuário como último turno
  chatMessages.push({ role: 'user', content: incomingText })

  // ==========================================
  // DETECÇÃO AUTOMÁTICA DE NOME DO CLIENTE PELA IA / REFINAMENTO DE CADASTRO
  // ==========================================
  // Verifica se o cliente já está cadastrado ou precisa ser criado / ter o nome atualizado.
  try {
    const cleanPhoneDigits = String(phone || '').replace(/\D/g, '')
    let withoutDdi = cleanPhoneDigits
    if (withoutDdi.startsWith('55') && withoutDdi.length >= 12) {
      withoutDdi = withoutDdi.slice(2)
    }

    let customerRecord = null
    try {
      const foundList = $app.findRecordsByFilter(
        'customers',
        'phone ~ {:p1} || phone ~ {:p2}',
        '-created',
        1,
        0,
        { p1: cleanPhoneDigits, p2: withoutDdi },
      )
      if (foundList && foundList.length > 0) {
        customerRecord = foundList[0]
      }
    } catch (_) {}

    // Se o cliente não existir (por exemplo se a mensagem foi enfileirada diretamente), cria agora
    if (!customerRecord) {
      try {
        const custCol = $app.findCollectionByNameOrId('customers')
        customerRecord = new Record(custCol)
        customerRecord.set('name', phone) // nome provisório
        customerRecord.set('phone', phone)
        customerRecord.set('notes', 'Lead originado pelo WhatsApp')
        customerRecord.set('type', 'PF')
        customerRecord.set('pipeline_status', 'novo_lead')
        $app.save(customerRecord)
      } catch (createErr) {
        console.log('[AI-WORKER-CUSTOMER-CREATE-ERR]', createErr.message || String(createErr))
      }
    } else {
      // Se já existe e não tem pipeline_status e não está excluído, define novo_lead
      const isCustDeleted = Boolean(customerRecord.get('deleted'))
      if (!isCustDeleted) {
        const curStatus = String(customerRecord.getString('pipeline_status') || '').trim()
        if (!curStatus) {
          customerRecord.set('pipeline_status', 'novo_lead')
          try {
            $app.save(customerRecord)
          } catch (_) {}
        }
      }
    }

    // Se o nome atual do cliente for provisório (apenas dígitos numéricos ou igual ao telefone)
    // tenta extrair da mensagem se o cliente se apresentou (ex: "Meu nome é Lucas", "Aqui é o Marcos", "Sou a Renata")
    if (customerRecord) {
      const currentCustName = String(customerRecord.getString('name') || '').trim()
      const isDigitsOnly = /^[0-9+\s()-]+$/.test(currentCustName)

      if (isDigitsOnly || currentCustName === phone) {
        // 1. Tentar extração rápida via regex em português
        let detectedName = ''
        const textSample = incomingText.trim()

        const namePatterns = [
          /(?:meu\s+nome\s+é|me\s+chamo|chamo-me|sou\s+o|sou\s+a|aqui\s+é\s+o|aqui\s+é\s+a|falo\s+com|aqui\s+quem\s+fala\s+é\s+o|aqui\s+quem\s+fala\s+é\s+a)\s+([A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,})?)/i,
          /(?:olá|oi|bom\s+dia|boa\s+tarde|boa\s+noite)[,\s]+(?:eu\s+sou\s+o|eu\s+sou\s+a|sou\s+o|sou\s+a|meu\s+nome\s+é|aqui\s+é)\s+([A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,})?)/i,
        ]

        for (let np = 0; np < namePatterns.length; np++) {
          const match = textSample.match(namePatterns[np])
          if (match && match[1]) {
            const rawCandidate = match[1].trim()
            // Evitar falsos positivos com palavras comuns
            const stopWords = [
              'bom',
              'dia',
              'tarde',
              'noite',
              'ola',
              'olá',
              'favor',
              'uma',
              'peca',
              'peça',
              'orcamento',
              'orçamento',
              'amigo',
              'irmao',
              'irmão',
            ]
            if (
              !stopWords.includes(rawCandidate.toLowerCase()) &&
              rawCandidate.length >= 2 &&
              rawCandidate.length <= 40
            ) {
              // Capitalizar nome
              detectedName = rawCandidate
                .split(/\s+/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ')
              break
            }
          }
        }

        // Se regex não pegou, mas o texto contém indícios fortes de apresentação,
        // podemos pedir à IA uma extração rápida estruturada caso openaiKey ou skipAi esteja disponível
        if (
          !detectedName &&
          (textSample.toLowerCase().includes('nome') ||
            textSample.toLowerCase().includes('chamo') ||
            textSample.toLowerCase().includes('aqui é'))
        ) {
          try {
            const extractMessages = [
              {
                role: 'system',
                content:
                  'Identifique se o usuário informou o próprio nome nesta mensagem. Se informou, retorne APENAS o nome próprio formatado (Ex: "Lucas Silva"). Se não houver nome de pessoa se apresentando, responda exatamente "NAO". Não adicione pontuação ou explicações.',
              },
              { role: 'user', content: textSample },
            ]

            let aiNameResp = ''
            if (openaiKey) {
              const resAi = $http.send({
                url: 'https://api.openai.com/v1/chat/completions',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + openaiKey,
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: extractMessages,
                  max_tokens: 15,
                  temperature: 0.0,
                }),
                timeout: 5,
              })
              if (
                resAi.statusCode === 200 &&
                resAi.json &&
                resAi.json.choices &&
                resAi.json.choices[0]
              ) {
                aiNameResp = String(resAi.json.choices[0].message.content || '').trim()
              }
            } else {
              const resAi = $ai.chat({
                model: 'fast',
                messages: extractMessages,
              })
              if (resAi && resAi.choices && resAi.choices[0]) {
                aiNameResp = String(resAi.choices[0].message.content || '').trim()
              }
            }

            if (
              aiNameResp &&
              !aiNameResp.toUpperCase().includes('NAO') &&
              !aiNameResp.toUpperCase().includes('NÃO') &&
              aiNameResp.length >= 2 &&
              aiNameResp.length <= 50
            ) {
              detectedName = aiNameResp.replace(/["'.]/g, '').trim()
            }
          } catch (_) {
            // Falha silenciosa na IA auxiliar, mantém o provisório
          }
        }

        // Se detectou nome válido, atualiza o registro do cliente
        if (detectedName) {
          customerRecord.set('name', detectedName)
          $app.save(customerRecord)
          console.log(
            '[CUSTOMER-NAME-DETECTED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              customerId: customerRecord.id,
              detectedName: detectedName,
              phone: maskedPhone,
            }),
          )
        }
      }
    }
  } catch (custDetectErr) {
    console.log('[CUSTOMER-NAME-DETECTION-ERROR]', custDetectErr.message || String(custDetectErr))
  }

  // 7. Definição de ferramentas (Function Calling)
  const availableTools = [
    {
      type: 'function',
      function: {
        name: 'buscar_produtos',
        description:
          'Busca produtos no catálogo da SOU.IS por termo de pesquisa, nome da peça, modelo, marca, SKU ou código de barras. Retorna até 5 produtos com nome, SKU, marca, anos de aplicação, descrição/aplicação detalhada, preço e estoque.',
        parameters: {
          type: 'object',
          properties: {
            termo: {
              type: 'string',
              description:
                'Termo de pesquisa (ex.: "bucha d21", "amortecedor d21", SKU ou código de barras)',
            },
          },
          required: ['termo'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'consultar_estoque_ao_vivo',
        description:
          'Consulta o estoque e disponibilidade em tempo real de um SKU específico chamando o endpoint de estoque ao vivo.',
        parameters: {
          type: 'object',
          properties: {
            sku: {
              type: 'string',
              description: 'Código SKU exato do produto (ex.: "2765", "8722", etc.)',
            },
          },
          required: ['sku'],
        },
      },
    },
  ]

  // Executores locais das ferramentas
  const executeBuscarProdutos = (termo) => {
    try {
      const rawTerm = String(termo || '').trim()
      if (!rawTerm) return { total: 0, produtos: [] }

      // Lista de stopwords estritas em português conforme especificação
      const stopWordsSet = {
        de: true,
        do: true,
        da: true,
        dos: true,
        das: true,
        para: true,
        em: true,
        um: true,
        uma: true,
        tem: true,
        temos: true,
        você: true,
        voce: true,
        qual: true,
        quanto: true,
        custa: true,
        o: true,
        a: true,
        e: true,
        é: true,
        ano: true,
        anos: true,
        modelo: true,
        peca: true,
        peça: true,
        pecas: true,
        peças: true,
        pra: true,
        pro: true,
      }

      // Normalização e extração de tokens
      // Mantém letras, números e remove pontuação como ?, !, ,, ;, :, etc.
      const rawWords = rawTerm
        .toLowerCase()
        .replace(/[?!,;:()[\]{}"'\\/]/g, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0)

      const usefulTokens = []
      const detectedYears = [] // Anos de 2 dígitos (00-99) ou 4 dígitos (ex: 1991 -> 91)

      for (let wi = 0; wi < rawWords.length; wi++) {
        const token = rawWords[wi]
        if (!token) continue

        // Ignorar se for stopword
        if (stopWordsSet[token]) continue

        // Detecção e tratamento de anos:
        // Caso A: 4 dígitos (ex.: "1991", "2005") -> ano de veículo
        if (/^(19|20)\d{2}$/.test(token)) {
          const twoDigit = parseInt(token.slice(2), 10)
          if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
          continue // Descartar token de 4 dígitos da busca direta de texto
        }

        // Caso B: 2 dígitos isolados (ex.: "91", "97")
        // Nota: modelos com letras e dígitos como "d21", "l200", "f1000", "147" não entram aqui
        if (/^\d{2}$/.test(token)) {
          const twoDigit = parseInt(token, 10)
          if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
          continue // Descartar token de 2 dígitos isolado da busca direta de texto
        }

        // Token útil preservado (ex.: "bucha", "amortecedor", "d21", "dianteiro")
        if (token.length >= 2) {
          usefulTokens.push(token)
        }
      }

      // Fallback: se todos os tokens foram stopwords ou anos, usa os rawWords com len >= 2
      const searchTokens =
        usefulTokens.length > 0 ? usefulTokens : rawWords.filter((w) => w.length >= 2)

      if (searchTokens.length === 0) {
        // Horário de Brasília UTC-3 para log de diagnóstico
        let nowBrasiliaIso = ''
        try {
          const bDate = new Date(Date.now() - 3 * 3600 * 1000)
          nowBrasiliaIso = bDate.toISOString().replace('Z', '-03:00')
        } catch (_) {
          nowBrasiliaIso = new Date().toISOString()
        }

        console.log(
          '[TOOL-BUSCAR-PRODUTOS-ZERO-RESULTS]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termoOriginal: rawTerm,
            tokensUsados: searchTokens,
            anosDetectados: detectedYears,
            motivo: 'Nenhum token útil após remoção de stopwords/anos',
          }),
        )

        return { total: 0, produtos: [] }
      }

      // Busca em duas fases no banco de dados:
      // Fase 1: Consulta AND estrita (todos os queryTokens devem casar em name/sku/brand/barcode/description)
      // Fase 2: Se Fase 1 retornar menos de 5 candidatos, executa consulta OR com limit 200 para complementar pool
      const queryTokens = searchTokens.slice(0, 8)
      const bindParams = {}
      const tokenConds = []

      for (let ti = 0; ti < queryTokens.length; ti++) {
        const pKey = 't' + ti
        bindParams[pKey] = queryTokens[ti]
        tokenConds.push(
          '(name ~ {:' +
            pKey +
            '} || sku ~ {:' +
            pKey +
            '} || brand ~ {:' +
            pKey +
            '} || barcode ~ {:' +
            pKey +
            '} || description ~ {:' +
            pKey +
            '})',
        )
      }

      let candidates = []
      const candidateIds = {}

      // Execução da Fase 1 (AND)
      if (tokenConds.length > 0) {
        const andFilterExpr = tokenConds.join(' && ')
        try {
          const phase1Candidates = $app.findRecordsByFilter(
            'products',
            andFilterExpr,
            '-stock_quantity,name',
            50,
            0,
            bindParams,
          )
          if (phase1Candidates && phase1Candidates.length > 0) {
            for (let p1i = 0; p1i < phase1Candidates.length; p1i++) {
              const rec = phase1Candidates[p1i]
              candidates.push(rec)
              candidateIds[rec.id] = true
            }
          }
        } catch (searchErr1) {
          console.log('[TOOL-BUSCAR-PRODUTOS-PHASE1-ERR]', String(searchErr1))
        }
      }

      // Execução da Fase 2 (OR com limit 200) somente se Fase 1 retornar menos de 5 candidatos
      if (candidates.length < 5 && tokenConds.length > 0) {
        const orFilterExpr = tokenConds.join(' || ')
        try {
          const phase2Candidates = $app.findRecordsByFilter(
            'products',
            orFilterExpr,
            '-stock_quantity,name',
            200,
            0,
            bindParams,
          )
          if (phase2Candidates && phase2Candidates.length > 0) {
            for (let p2i = 0; p2i < phase2Candidates.length; p2i++) {
              const rec = phase2Candidates[p2i]
              if (!candidateIds[rec.id]) {
                candidates.push(rec)
                candidateIds[rec.id] = true
              }
            }
          }
        } catch (searchErr2) {
          console.log('[TOOL-BUSCAR-PRODUTOS-PHASE2-ERR]', String(searchErr2))
        }
      }

      // Fallback amplo pelo termo cru caso nada tenha sido encontrado
      if ((!candidates || candidates.length === 0) && rawTerm.length >= 2) {
        try {
          candidates = $app.findRecordsByFilter(
            'products',
            'name ~ {:rt} || sku ~ {:rt} || brand ~ {:rt} || barcode ~ {:rt}',
            '-stock_quantity,name',
            20,
            0,
            { rt: rawTerm },
          )
        } catch (_) {}
      }

      // Helper para checar se uma faixa de anos no nome do produto (ex.: "88/97", "92/04")
      // contempla os anos pesquisados (ex.: 91 está entre 88 e 97)
      const matchesYearRange = (text, year2Digit) => {
        if (!text || year2Digit === undefined || year2Digit === null) return false
        // Procura padrões como "88/97", "93/03", "92-04", "88/1997"
        const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
        let match
        while ((match = rangeRegex.exec(text)) !== null) {
          let startY = parseInt(match[1], 10)
          let endY = parseInt(match[2], 10)
          if (startY > 1000) startY = startY % 100
          if (endY > 1000) endY = endY % 100

          if (!isNaN(startY) && !isNaN(endY)) {
            if (startY <= endY) {
              if (year2Digit >= startY && year2Digit <= endY) return true
            } else {
              // Transição de século ex.: 95/05 (1995 a 2005)
              if (year2Digit >= startY || year2Digit <= endY) return true
            }
          }
        }
        return false
      }

      // Helper para extrair faixa de anos formatada do nome do produto (ex.: "88/97", "06/15")
      const extractYearRangeString = (text) => {
        if (!text) return ''
        const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
        const match = rangeRegex.exec(text)
        if (match) {
          let y1 = match[1]
          let y2 = match[2]
          if (y1.length === 4) y1 = y1.slice(2)
          if (y2.length === 4) y2 = y2.slice(2)
          return y1 + '/' + y2
        }
        return ''
      }

      // Sistema de pontuação e relevância
      const scoredCandidates = []

      for (let ci = 0; ci < (candidates || []).length; ci++) {
        const rec = candidates[ci]
        const pSku = String(rec.getString('sku') || '').toLowerCase()
        const pName = String(rec.getString('name') || '').toLowerCase()
        const pBrand = String(rec.getString('brand') || '').toLowerCase()
        const pBarcode = String(rec.getString('barcode') || '').toLowerCase()
        const pDesc = String(rec.getString('description') || '').toLowerCase()
        const fullSearchable = pName + ' ' + pSku + ' ' + pBrand + ' ' + pBarcode + ' ' + pDesc

        let matchedTokenCount = 0
        let matchedNameSkuCount = 0
        const nameSkuSearchable = pName + ' ' + pSku

        for (let ti = 0; ti < searchTokens.length; ti++) {
          const tok = searchTokens[ti]
          if (fullSearchable.includes(tok)) {
            matchedTokenCount++
          }
          if (nameSkuSearchable.includes(tok)) {
            matchedNameSkuCount++
          }
        }

        // Filtro de relevância mínima: quando o termo de busca tiver 2 ou mais tokens,
        // descartar candidatos com menos de 2 tokens casados no nome/SKU (elimina falsos positivos
        // como "Bucha Braco Tensor Uno..." numa busca de 3 tokens)
        if (searchTokens.length >= 2 && matchedNameSkuCount < 2) {
          continue
        }

        // Se o produto não casou com nenhum dos searchTokens, desconsidera
        if (matchedTokenCount === 0 && searchTokens.length > 0) continue

        // Base score: 10 pontos por token casado
        let score = matchedTokenCount * 10

        // Bônus se casou com TODOS os searchTokens (match perfeito de palavras)
        if (matchedTokenCount === searchTokens.length && searchTokens.length > 1) {
          score += 25
        }

        // Bônus de SKU exato
        if (pSku === rawTerm.toLowerCase()) {
          score += 100
        }

        // Bônus se casou na faixa de anos
        if (detectedYears.length > 0) {
          let yearMatched = false
          for (let yi = 0; yi < detectedYears.length; yi++) {
            if (matchesYearRange(pName, detectedYears[yi])) {
              yearMatched = true
              break
            }
          }
          if (yearMatched) {
            score += 15 // Recompensa alta para produtos da mesma faixa de anos
          }
        }

        // Desempate secundário: produtos com estoque positivo ganham leve prioridade
        const stockQty = Number(rec.get('stock_quantity')) || 0
        if (stockQty > 0) {
          score += 2
        }

        scoredCandidates.push({
          rec: rec,
          score: score,
          matchedTokenCount: matchedTokenCount,
        })
      }

      // Ordenar decrescente por score (relevância), depois por estoque, depois por nome
      scoredCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const stockA = Number(a.rec.get('stock_quantity')) || 0
        const stockB = Number(b.rec.get('stock_quantity')) || 0
        if (stockB !== stockA) return stockB - stockA
        return a.rec.getString('name').localeCompare(b.rec.getString('name'))
      })

      // Limitar aos top 5
      const topSelected = scoredCandidates.slice(0, 5)

      // Montar contrato atual de retorno com description e years enriquecidos
      const results = topSelected.map((item) => {
        const rec = item.rec
        const pPrice = Number(rec.get('price')) || 0
        const pStock = Number(rec.get('stock_quantity')) || 0
        const pSku = rec.getString('sku')
        const pName = rec.getString('name')
        const pBrand = rec.getString('brand') || ''
        const pBarcode = rec.getString('barcode') || ''
        const pDesc = String(rec.getString('description') || '').trim()
        const pYears = extractYearRangeString(pName)

        const prodObj = {
          sku: pSku,
          nome: pName,
          marca: pBrand,
          codigo_barras: pBarcode,
          preco: pPrice,
          estoque: pStock,
          disponivel: pStock > 0 && pPrice > 0,
          status_consulta:
            pStock <= 0 || pPrice <= 0
              ? 'Sob consulta, nossa equipe confirma disponibilidade'
              : 'Disponível em estoque',
        }

        // Limpar boilerplate do description: só incluir se NÃO começar com "Produto SOU.IS sincronizado"
        if (pDesc && !pDesc.startsWith('Produto SOU.IS sincronizado')) {
          prodObj.description = pDesc
        }
        if (pYears) {
          prodObj.years = pYears
        }

        return prodObj
      })

      // Horário de Brasília UTC-3 para logs padronizados (sem UTC)
      let nowBrasiliaIso = ''
      try {
        const bDate = new Date(Date.now() - 3 * 3600 * 1000)
        nowBrasiliaIso = bDate.toISOString().replace('Z', '-03:00')
      } catch (_) {
        nowBrasiliaIso = new Date().toISOString()
      }

      if (results.length === 0) {
        console.log(
          '[TOOL-BUSCAR-PRODUTOS-ZERO-RESULTS]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termoOriginal: rawTerm,
            tokensUsados: searchTokens,
            anosDetectados: detectedYears,
            totalCandidatosBanco: (candidates || []).length,
          }),
        )
      } else {
        console.log(
          '[TOOL-BUSCAR-PRODUTOS-EXECUTED]',
          JSON.stringify({
            horarioBrasilia: nowBrasiliaIso,
            termo: rawTerm,
            tokensUsados: searchTokens,
            totalEncontrados: results.length,
            skus: results.map((r) => r.sku),
          }),
        )
      }

      return {
        termo: rawTerm,
        total: results.length,
        produtos: results,
      }
    } catch (err) {
      console.log('[TOOL-BUSCAR-PRODUTOS-ERROR]', String(err))
      return { total: 0, produtos: [], erro: String(err) }
    }
  }

  const executeConsultarEstoqueAoVivo = (sku) => {
    try {
      const cleanSku = String(sku || '').trim()
      if (!cleanSku) return { sku: '', estoque: 0, erro: 'SKU não fornecido' }

      // 1. Tentar ler do endpoint interno GET /backend/v1/stock/lookup?sku=
      let liveQuantity = null
      let apiUpdated = false
      try {
        let stockApiUrl = 'https://dummyjson.com/products'
        try {
          const setting = $app.findFirstRecordByFilter('settings', "stock_api_url != ''")
          if (setting && setting.getString('stock_api_url')) {
            stockApiUrl = setting.getString('stock_api_url')
          }
        } catch (_) {}

        const res = $http.send({
          url: stockApiUrl + '?search=' + encodeURIComponent(cleanSku),
          method: 'GET',
          timeout: 10,
        })

        if (res.statusCode === 200 && res.json) {
          const data = res.json
          if (data.products && Array.isArray(data.products) && data.products.length > 0) {
            liveQuantity = data.products[0].stock || data.products[0].stock_quantity || 12
            apiUpdated = true
          } else if (typeof data.stock === 'number') {
            liveQuantity = data.stock
            apiUpdated = true
          }
        }
      } catch (httpEx) {
        console.log('[TOOL-ESTOQUE-AO-VIVO-HTTP-ERR]', String(httpEx))
      }

      // 2. Se a API externa retornou valor numérico, atualiza no banco local
      if (liveQuantity !== null && !isNaN(liveQuantity)) {
        try {
          const localProduct = $app.findFirstRecordByData('products', 'sku', cleanSku)
          localProduct.set('stock_quantity', liveQuantity)
          $app.save(localProduct)
        } catch (_) {}
      }

      // 3. Consulta o registro do produto local para retornar status completo
      let productInfo = null
      try {
        const prod = $app.findFirstRecordByData('products', 'sku', cleanSku)
        const curStock = Number(prod.get('stock_quantity')) || 0
        const curPrice = Number(prod.get('price')) || 0
        productInfo = {
          sku: cleanSku,
          nome: prod.getString('name'),
          marca: prod.getString('brand') || '',
          preco: curPrice,
          estoque: curStock,
          disponivel: curStock > 0 && curPrice > 0,
          status_consulta:
            curStock <= 0 || curPrice <= 0
              ? 'Sob consulta, nossa equipe confirma disponibilidade'
              : 'Disponível em estoque',
          origem_api: apiUpdated,
        }
      } catch (_) {
        productInfo = {
          sku: cleanSku,
          estoque: liveQuantity !== null ? liveQuantity : 0,
          status_consulta: 'Sob consulta, nossa equipe confirma disponibilidade',
          nao_encontrado: true,
        }
      }

      console.log(
        '[TOOL-CONSULTAR-ESTOQUE-AO-VIVO-EXECUTED]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          sku: cleanSku,
          estoque: productInfo.estoque,
          preco: productInfo.preco,
        }),
      )

      return productInfo
    } catch (err) {
      console.log('[TOOL-CONSULTAR-ESTOQUE-ERROR]', String(err))
      return { sku: sku, estoque: 0, erro: String(err) }
    }
  }

  // Despachante genérico de tool calls
  const dispatchToolCall = (toolName, toolArgs) => {
    if (toolName === 'buscar_produtos') {
      const termo = toolArgs && toolArgs.termo ? toolArgs.termo : ''
      return executeBuscarProdutos(termo)
    }
    if (toolName === 'consultar_estoque_ao_vivo') {
      const sku = toolArgs && toolArgs.sku ? toolArgs.sku : ''
      return executeConsultarEstoqueAoVivo(sku)
    }
    return { erro: 'Ferramenta desconhecida: ' + toolName }
  }

  // 8. Início do processamento de IA com suporte a Function Calling
  const usedModel = 'gpt-4o-mini'
  console.log(
    '[AI-PROCESSING-START]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      senderPhone: maskedPhone,
      model: usedModel,
      historyTurns: historyTurnsCount,
      historyRecordsCount: chronologicalHistory.length,
      hasCustomPrompt: configuredPrompt.length > 0,
      toolsEnabled: true,
    }),
  )

  let aiReply = ''
  let aiError = ''
  let usedProvider = ''

  // Função para executar loop de chamadas com ferramentas via OpenAI
  const runOpenAiWithTools = () => {
    let currentMessages = chatMessages.slice()
    const MAX_TOOL_ROUNDS = 4
    let rounds = 0

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++
      const openAiRes = $http.send({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: currentMessages,
          tools: availableTools,
          tool_choice: 'auto',
          max_tokens: 450,
          temperature: 0.2,
        }),
        timeout: 20,
      })

      if (openAiRes.statusCode < 200 || openAiRes.statusCode >= 300) {
        const errBody = openAiRes.json || openAiRes.body || {}
        throw new Error(
          'OpenAI HTTP ' +
            openAiRes.statusCode +
            ': ' +
            (errBody.error
              ? errBody.error.message || JSON.stringify(errBody.error)
              : 'Falha na requisição'),
        )
      }

      const parsed = openAiRes.json
      if (!parsed || !parsed.choices || !parsed.choices[0] || !parsed.choices[0].message) {
        throw new Error('Resposta da OpenAI sem choices válidas')
      }

      const choiceMsg = parsed.choices[0].message

      // Se a IA solicitou chamadas de ferramentas (tool_calls)
      if (
        choiceMsg.tool_calls &&
        Array.isArray(choiceMsg.tool_calls) &&
        choiceMsg.tool_calls.length > 0
      ) {
        currentMessages.push(choiceMsg)

        for (let t = 0; t < choiceMsg.tool_calls.length; t++) {
          const tCall = choiceMsg.tool_calls[t]
          const fnName = tCall.function ? tCall.function.name : ''
          let fnArgs = {}
          try {
            fnArgs = JSON.parse(tCall.function.arguments || '{}')
          } catch (_) {
            fnArgs = {}
          }

          console.log(
            '[OPENAI-TOOL-CALL-RECEIVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              messageId: messageId,
              toolId: tCall.id,
              toolName: fnName,
              args: fnArgs,
            }),
          )

          const toolResult = dispatchToolCall(fnName, fnArgs)

          currentMessages.push({
            role: 'tool',
            tool_call_id: tCall.id,
            content: JSON.stringify(toolResult),
          })
        }

        // Continua no loop para a IA sintetizar a resposta com o resultado das ferramentas
        continue
      }

      // Resposta de texto final atingida
      if (choiceMsg.content) {
        return choiceMsg.content.trim()
      }
    }

    throw new Error('Limite de rodadas de ferramentas excedido sem resposta final')
  }

  // Função para executar loop com ferramentas via Skip Gateway ($ai.chat)
  const runSkipGatewayWithTools = () => {
    let currentMessages = chatMessages.slice()
    const MAX_TOOL_ROUNDS = 4
    let rounds = 0

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++
      const chatRes = $ai.chat({
        model: 'fast',
        messages: currentMessages,
        tools: availableTools,
        tool_choice: 'auto',
      })

      if (!chatRes || !chatRes.choices || !chatRes.choices[0] || !chatRes.choices[0].message) {
        throw new Error('Skip AI gateway retornou resposta vazia')
      }

      const choiceMsg = chatRes.choices[0].message

      if (
        choiceMsg.tool_calls &&
        Array.isArray(choiceMsg.tool_calls) &&
        choiceMsg.tool_calls.length > 0
      ) {
        currentMessages.push(choiceMsg)

        for (let t = 0; t < choiceMsg.tool_calls.length; t++) {
          const tCall = choiceMsg.tool_calls[t]
          const fnName = tCall.function ? tCall.function.name : ''
          let fnArgs = {}
          try {
            fnArgs = JSON.parse(tCall.function.arguments || '{}')
          } catch (_) {
            fnArgs = {}
          }

          console.log(
            '[SKIP-GATEWAY-TOOL-CALL-RECEIVED]',
            JSON.stringify({
              timestamp: new Date().toISOString(),
              messageId: messageId,
              toolId: tCall.id,
              toolName: fnName,
              args: fnArgs,
            }),
          )

          const toolResult = dispatchToolCall(fnName, fnArgs)

          currentMessages.push({
            role: 'tool',
            tool_call_id: tCall.id,
            content: JSON.stringify(toolResult),
          })
        }

        continue
      }

      if (choiceMsg.content) {
        return choiceMsg.content.trim()
      }
    }

    throw new Error('Limite de rodadas no Skip Gateway excedido')
  }

  // Execução com fallback
  if (openaiKey) {
    try {
      aiReply = runOpenAiWithTools()
      usedProvider = 'openai'
    } catch (openAiEx) {
      aiError = openAiEx.message || String(openAiEx)
      console.log(
        '[AI-FALLBACK-TO-SKIP-GATEWAY]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          messageId: messageId,
          reason: aiError,
        }),
      )
      try {
        aiReply = runSkipGatewayWithTools()
        usedProvider = 'skip_gateway'
        aiError = ''
      } catch (skipEx) {
        aiError = 'OpenAI: ' + aiError + ' | SkipGateway: ' + (skipEx.message || String(skipEx))
      }
    }
  } else {
    try {
      aiReply = runSkipGatewayWithTools()
      usedProvider = 'skip_gateway'
    } catch (skipEx) {
      aiError = skipEx.message || String(skipEx)
    }
  }

  // 5. Validação do resultado da IA
  if (!aiReply || aiError) {
    console.log(
      '[AI-PROCESSING-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        model: usedModel,
        senderPhone: maskedPhone,
        error: aiError || 'Falha ao gerar resposta pela IA',
      }),
    )

    try {
      procRecord.set('status', 'failed')
      procRecord.set('errorMessage', aiError || 'AI processing returned empty reply')
      procRecord.set('aiModel', usedModel)
      $app.save(procRecord)
    } catch (_) {}

    // Não envia resposta automática se a IA falhar
    return e.next()
  }

  // Log de sucesso da IA
  console.log(
    '[AI-PROCESSING-SUCCESS]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      messageId: messageId,
      model: usedModel,
      senderPhone: maskedPhone,
    }),
  )

  // ==========================================
  // DETECÇÃO E PROCESSAMENTO DO MARCADOR DE TRANSFERÊNCIA PARA HUMANO
  // ==========================================
  // O marcador [TRANSFERIR-HUMANO] pode vir em qualquer posição do texto retornado pela IA,
  // com tolerância a espaços, quebras de linha e múltiplas ocorrências.
  // Deve ser completamente removido antes do envio para que o cliente NUNCA o veja.
  // Se houver qualquer ocorrência, após o envio com sucesso ativamos o modo humano (human_mode = true, paused_by = "transferencia_ia").
  const transferMarkerRegex = /\[\s*TRANSFERIR\s*-\s*HUMANO\s*\]/gi
  const hasTransferMarker = transferMarkerRegex.test(aiReply)

  let cleanAiReply = aiReply
  if (hasTransferMarker) {
    cleanAiReply = aiReply.replace(transferMarkerRegex, '').trim()
    console.log(
      '[HUMAN-TRANSFER-DETECTED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        hasTransferMarker: true,
      }),
    )
  }

  // 6. Envio da resposta pela Z-API
  const zapiHeaders = {
    'Content-Type': 'application/json',
    'Client-Token': zapiClientToken,
  }

  let zapiHttpStatus = 0
  let zapiSuccess = false
  let zapiErrorDetail = ''

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
        phone: phone,
        message: cleanAiReply,
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
  } catch (zapiErr) {
    zapiErrorDetail = zapiErr.message || String(zapiErr)
  }

  // 7. Atualização final de estado e logs sanitizados de envio
  if (zapiSuccess) {
    console.log(
      '[ZAPI-REPLY-SENT]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        httpStatus: zapiHttpStatus,
      }),
    )

    try {
      procRecord.set('status', 'completed')
      procRecord.set('replySent', true)
      procRecord.set('aiReplyText', cleanAiReply)
      procRecord.set('aiModel', usedModel)
      procRecord.set('zapiStatus', zapiHttpStatus)
      procRecord.set('errorMessage', '')
      $app.save(procRecord)
    } catch (saveCompletedErr) {
      console.log('[COMPLETED-SAVE-ERR]', saveCompletedErr.message || String(saveCompletedErr))
    }

    // Se houve transferência para humano, ativar human_mode na collection chat_control
    if (hasTransferMarker && phone) {
      try {
        let chatControlRec = null
        try {
          const foundControls = $app.findRecordsByFilter(
            'chat_control',
            'phone = {:phone}',
            '-created',
            1,
            0,
            { phone: phone },
          )
          if (foundControls && foundControls.length > 0) {
            chatControlRec = foundControls[0]
          }
        } catch (_) {}

        if (chatControlRec) {
          chatControlRec.set('human_mode', true)
          chatControlRec.set('paused_by', 'transferencia_ia')
          $app.save(chatControlRec)
        } else {
          const controlCol = $app.findCollectionByNameOrId('chat_control')
          const newCtrl = new Record(controlCol)
          newCtrl.set('phone', phone)
          newCtrl.set('human_mode', true)
          newCtrl.set('paused_by', 'transferencia_ia')
          $app.save(newCtrl)
        }

        console.log(
          '[HUMAN-MODE-ON]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            phone: maskedPhone,
            paused_by: 'transferencia_ia',
            messageId: messageId,
          }),
        )
      } catch (transferSaveErr) {
        console.log(
          '[CHAT-CONTROL-TRANSFER-SAVE-ERR]',
          transferSaveErr.message || String(transferSaveErr),
        )
      }
    }
  } else {
    console.log(
      '[ZAPI-REPLY-ERROR]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        messageId: messageId,
        senderPhone: maskedPhone,
        httpStatus: zapiHttpStatus,
        error: zapiErrorDetail || 'Falha no envio Z-API',
      }),
    )

    try {
      procRecord.set('status', 'failed')
      procRecord.set('replySent', false)
      procRecord.set('aiReplyText', cleanAiReply)
      procRecord.set('aiModel', usedModel)
      procRecord.set('zapiStatus', zapiHttpStatus)
      procRecord.set('errorMessage', zapiErrorDetail || 'Falha no envio Z-API')
      $app.save(procRecord)
    } catch (saveFailedErr) {
      console.log('[FAILED-SAVE-ERR]', saveFailedErr.message || String(saveFailedErr))
    }
  }

  return e.next()
}, 'message_processing')
