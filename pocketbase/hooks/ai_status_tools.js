// ============================================
// TOOLS DE STATUS — Fase 7 · Rodada 1
// 3 tools novas para a IA do atendimento com dado REAL lido do banco:
//   status_pedido      → último orçamento + pedido do cliente (quotes + orders)
//   status_nfe         → última NF-e do CNPJ (nfe_processed), com aviso de cancelada
//   segunda_via_danfe  → enfileira comando busca_por_chave na dfe_command_queue
// Regras permanentes respeitadas:
//   - resposta SOMENTE com dado lido — nada inventado;
//   - segunda_via_danfe NUNCA inventa chave de 44 dígitos — sem chave → escala ao humano;
//   - horários em Brasília (UTC-3);
//   - aplicações de peça NUNCA são confirmadas pela IA (só humano).
// Pendurado em globalThis para o ai_message_worker chamar via globalThis.__aiStatusTools.
// ============================================
;(function () {
  // Telefone canônico: mesma regra de chat_summaries (sem @lid, sem DDI 55, 8+ dígitos)
  const canonicalPhoneOf = (p) => {
    if (!p) return ''
    const str = String(p).trim()
    if (str.toLowerCase().includes('@lid')) return ''
    const digits = str.replace(/\D/g, '')
    if (!digits || digits.length >= 14) return ''
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      return digits.slice(2)
    }
    return digits
  }

  const onlyDigits = (s) => String(s || '').replace(/\D/g, '')

  // Formata valor em reais — dado lido, nunca formatado a partir de estimativa
  const formatBRL = (v) => {
    const n = Number(v)
    if (!isFinite(n)) return ''
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  // Data em Brasília (UTC-3) a partir de timestamp/ISO do banco
  const formatBrasilia = (raw) => {
    if (!raw) return ''
    try {
      const d = new Date(raw)
      if (isNaN(d.getTime())) return String(raw)
      const b = new Date(d.getTime() - 3 * 60 * 60 * 1000)
      return (
        b.toISOString().slice(8, 10) +
        '/' +
        b.toISOString().slice(5, 7) +
        '/' +
        b.toISOString().slice(0, 4) +
        ' ' +
        b.toISOString().slice(11, 16)
      )
    } catch (_) {
      return String(raw)
    }
  }

  const STATUS_LABELS = {
    rascunho: 'em elaboração',
    enviado: 'enviado — aguardando sua resposta',
    aprovado: 'aprovado por você',
    rejeitado: 'não fechado',
    pago: 'pago',
    aberto: 'em produção/separação',
    cancelado: 'cancelado',
    pendente: 'pendente',
    processada: 'processada',
    erro: 'com erro de processamento',
    cancelada: 'CANCELADA',
  }
  const labelFor = (s) => STATUS_LABELS[String(s || '')] || String(s || '')

  // Busca cliente pelo telefone canônico (colunas cnpj/cpf reais do customers)
  const findCustomerByPhone = ($app, phone) => {
    const canon = canonicalPhoneOf(phone)
    if (!canon) return null
    // Tenta primeiro clientes ativos, depois qualquer registro se não houver ativo
    const variants = [canon, '55' + canon, '+' + canon, '+55' + canon]
    for (let i = 0; i < variants.length; i++) {
      try {
        const found = $app.findRecordsByFilter(
          'customers',
          'phone ~ {:p} && deleted != true',
          '-created',
          1,
          0,
          { p: variants[i] },
        )
        if (found && found.length > 0) return found[0]
      } catch (_) {}
    }
    // Fallback: mesmo que deleted = true (ex: contatos históricos ou de teste)
    for (let i = 0; i < variants.length; i++) {
      try {
        const found = $app.findRecordsByFilter('customers', 'phone ~ {:p}', '-created', 1, 0, {
          p: variants[i],
        })
        if (found && found.length > 0) return found[0]
      } catch (_) {}
    }
    return null
  }

  // ----------------------------------------
  // TOOL 1 — status_pedido
  // ----------------------------------------
  const executeStatusPedido = ($app, ctx) => {
    const phone = (ctx && ctx.phone) || ''
    const customer = findCustomerByPhone($app, phone)
    if (!customer) {
      return {
        reply:
          'Não encontrei pedidos para esse número aqui. Me confirma seu telefone com DDD, ou fala com o Raphael que ele resolve na hora.',
        data: null,
      }
    }

    const name = String(customer.getString('name') || '')
    const quotes = $app.findRecordsByFilter('quotes', 'customer = {:cid}', '-created', 3, 0, {
      cid: customer.id,
    })

    if (!quotes || quotes.length === 0) {
      return {
        reply:
          'Oi, ' +
          (name.split(' ')[0] || 'tudo bem') +
          '! Não achei orçamento ou pedido em aberto para esse número. Quer que eu já veja alguma peça?',
        data: { customer: name },
      }
    }

    const q = quotes[0]
    const qNumber = String(q.getString('number') || '')
    const qStatus = String(q.getString('status') || '')
    const qTotal = q.get('total')

    // Pedido ligado a QUALQUER orçamento do cliente (coluna real: quote_id)
    let order = null
    for (let i = 0; i < quotes.length && !order; i++) {
      try {
        const os = $app.findRecordsByFilter('orders', 'quote_id = {:qid}', '-created', 1, 0, {
          qid: quotes[i].id,
        })
        if (os && os.length > 0) order = os[0]
      } catch (_) {}
    }

    let reply = ''
    if (order) {
      const oCode = String(order.getString('code') || '')
      const oComm = String(order.getString('commercial_status') || '')
      const oFin = String(order.getString('financial_status') || '')
      reply =
        'Oi, ' +
        (name.split(' ')[0] || '') +
        '! Seu pedido ' +
        oCode +
        ' está ' +
        labelFor(oComm) +
        (oFin === 'pago' ? ' e o pagamento já caiu.' : ' — pagamento ' + labelFor(oFin) + '.')
      if (oComm === 'cancelado') {
        reply += ' Sobre isso preciso te passar pro Raphael — me dá um instante.'
        ctx && ctx.escalate && (ctx.escalate = true)
      }
      reply += ' Mais alguma coisa?'
    } else {
      reply =
        'Oi, ' +
        (name.split(' ')[0] || '') +
        '! Seu orçamento ' +
        qNumber +
        ' está ' +
        labelFor(qStatus) +
        (qTotal ? ' (total ' + formatBRL(qTotal) + ')' : '') +
        '.'
      if (qStatus === 'enviado') {
        reply += ' Quando aprovar, fecho o pedido na hora.'
      }
      reply += ' Quer que eu te mande o link de novo?'
    }

    return {
      reply: reply,
      data: {
        customer: name,
        quote: { number: qNumber, status: qStatus, total: qTotal },
        order: order
          ? {
              code: String(order.getString('code') || ''),
              commercial_status: String(order.getString('commercial_status') || ''),
              financial_status: String(order.getString('financial_status') || ''),
            }
          : null,
      },
    }
  }

  // ----------------------------------------
  // TOOL 2 — status_nfe
  // ----------------------------------------
  const executeStatusNfe = ($app, ctx) => {
    const phone = (ctx && ctx.phone) || ''
    const customer = findCustomerByPhone($app, phone)
    if (!customer) {
      return {
        reply:
          'Não achei nota para esse número. Me manda o CNPJ ou a chave da nota que eu verifico aqui.',
        data: null,
      }
    }

    const name = String(customer.getString('name') || '')
    // Colunas reais: cnpj e cpf (não existe "document")
    const docDigits =
      onlyDigits(customer.getString('cnpj') || '') || onlyDigits(customer.getString('cpf') || '')

    if (!docDigits || docDigits.length < 11) {
      return {
        reply:
          'Não tenho o CNPJ/cpf desse cadastro linkado ao número. Me manda o CNPJ que eu verifico a nota na hora.',
        data: null,
      }
    }

    // Colunas reais: supplier_cnpj (emitente) e dest_cnpj (destinatário)
    let nfe = null
    try {
      const nfes = $app.findRecordsByFilter(
        'nfe_processed',
        'dest_cnpj ~ {:doc} || supplier_cnpj ~ {:doc}',
        '-created',
        1,
        0,
        { doc: docDigits },
      )
      if (nfes && nfes.length > 0) nfe = nfes[0]
    } catch (_) {}

    if (!nfe) {
      return {
        reply:
          'Não achei NF-e para o CNPJ ' +
          docDigits +
          ' nos últimos lançamentos. Se foi emitida agora, pode levar alguns minutos — me chama de novo em seguida.',
        data: null,
      }
    }

    const nNumber = String(nfe.getString('nfe_number') || '')
    const nStatus = String(nfe.getString('status') || '')
    const nKey = String(nfe.getString('access_key') || '')
    const nTotal = nfe.get('total_amount')

    // REGRA PERMANENTE: nota cancelada → alerta de NÃO PAGAR
    if (nStatus === 'cancelada') {
      return {
        reply:
          'ATENÇÃO: a NF-e ' +
          nNumber +
          ' está CANCELADA — NÃO PAGA, por favor. Se já pagou, me fala que eu te passo pro Raphael resolver.',
        data: {
          customer: name,
          nfe: { number: nNumber, status: nStatus, access_key: nKey, total: nTotal },
          alert: 'cancelada',
        },
      }
    }

    let extra = ''
    if (nStatus === 'pendente_reconciliacao') {
      extra = ' Está em conferência interna de itens — nada muda pra você.'
    } else if (nStatus === 'erro') {
      extra =
        ' Tivemos um erro no processamento interno — já estou chamando o Raphael pra conferir.'
      ctx && ctx.escalate && (ctx.escalate = true)
    }

    return {
      reply:
        'Oi, ' +
        (name.split(' ')[0] || '') +
        '! A NF-e ' +
        nNumber +
        (nTotal ? ' no valor de ' + formatBRL(nTotal) : '') +
        ' está ' +
        labelFor(nStatus) +
        '.' +
        extra +
        ' Posso te mandar o DANFE?',
      data: {
        customer: name,
        nfe: { number: nNumber, status: nStatus, access_key: nKey, total: nTotal },
      },
    }
  }

  // ----------------------------------------
  // TOOL 3 — segunda_via_danfe
  // ----------------------------------------
  const executeSegundaViaDanfe = ($app, ctx) => {
    const phone = (ctx && ctx.phone) || ''
    const args = (ctx && ctx.args) || {}
    const enqueueDfeCommand = (ctx && ctx.enqueueDfeCommand) || null
    const rawKey = onlyDigits(args.access_key || args.chave || '')

    if (!rawKey) {
      // Sem chave → tenta achar a última NF-e do cliente pelo cadastro
      const customer = findCustomerByPhone($app, phone)
      if (customer) {
        const docDigits =
          onlyDigits(customer.getString('cnpj') || '') ||
          onlyDigits(customer.getString('cpf') || '')
        if (docDigits && docDigits.length >= 11) {
          try {
            const nfes = $app.findRecordsByFilter(
              'nfe_processed',
              'dest_cnpj ~ {:doc} || supplier_cnpj ~ {:doc}',
              '-created',
              1,
              0,
              { doc: docDigits },
            )
            if (nfes && nfes.length > 0) {
              const k = String(nfes[0].getString('access_key') || '')
              if (k && k.length === 44) {
                return enqueueDanfeForKey($app, ctx, enqueueDfeCommand, k, phone, true)
              }
            }
          } catch (_) {}
        }
      }
      // NÃO inventa chave de 44 dígitos — escala ao humano
      return {
        reply:
          'Pra te mandar a segunda via do DANFE, me manda a chave de 44 dígitos da nota (tem no seu painel da NF-e, campo "chave de acesso") ou me diz a data aproximada que eu caço aqui com o Raphael.',
        data: null,
        escalated: true,
      }
    }

    if (rawKey.length !== 44) {
      return {
        reply:
          'Essa chave que você mandou não tem 44 dígitos — confere pra mim se copiou inteira? Ou me diz a data aproximada da nota que eu vejo aqui com o Raphael.',
        data: null,
        escalated: true,
      }
    }

    return enqueueDanfeForKey($app, ctx, enqueueDfeCommand, rawKey, phone, false)
  }

  // Enfileira o comando busca_por_chave (enum confirmado na dfe_command_queue)
  const enqueueDanfeForKey = ($app, ctx, enqueueDfeCommand, key44, phone, foundByCustomer) => {
    const params = { access_key: key44, origem: 'ia_whatsapp' }
    if (phone) params.phone = String(phone)
    let queued = false
    let queueErr = ''

    if (typeof enqueueDfeCommand === 'function') {
      try {
        const r = enqueueDfeCommand('busca_por_chave', params)
        queued = !!(r && r.success)
        if (!queued) queueErr = (r && r.error) || ''
      } catch (eQ) {
        queueErr = eQ.message || String(eQ)
      }
    }

    if (!queued) {
      // fallback direto na coleção (mesma regra da rota /backend/v1/dfe/command)
      try {
        const col = $app.findCollectionByNameOrId('dfe_command_queue')
        const cmdRec = new Record(col)
        cmdRec.set('command', 'busca_por_chave')
        cmdRec.set('params', params)
        cmdRec.set('status', 'pendente')
        $app.save(cmdRec)
        queued = true
      } catch (eF) {
        queueErr = queueErr || eF.message || String(eF)
      }
    }

    if (!queued) {
      return {
        reply:
          'Não consegui enfileirar a busca do DANFE agora — vou te passar pro Raphael pra garantir que chegue. Me dá um instante.',
        data: { error: queueErr },
        escalated: true,
      }
    }

    return {
      reply:
        'Fechei o pedido da segunda via do DANFE aqui — a chave ' +
        (foundByCustomer ? 'da sua última nota' : 'que você me passou') +
        ' já está na fila de busca na SEFAZ. Assim que baixar, te mando o PDF por aqui. 👍',
      data: { command: 'busca_por_chave', access_key: key44, queued: true },
      queued: true,
    }
  }

  globalThis.__aiStatusTools = {
    executeStatusPedido: ($app, ctx) => executeStatusPedido($app, ctx),
    executeStatusNfe: ($app, ctx) => executeStatusNfe($app, ctx),
    executeSegundaViaDanfe: ($app, ctx) => executeSegundaViaDanfe($app, ctx),
    findCustomerByPhone: ($app, phone) => findCustomerByPhone($app, phone),
    canonicalPhoneOf: canonicalPhoneOf,
  }
})()
