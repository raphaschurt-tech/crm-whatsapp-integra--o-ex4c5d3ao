// ============================================
// HELPER DE PACOTE DE HANDOFF — Fase 7 · Rodada 1
// Monta o pacote de contexto que chega ao atendente quando a IA
// transfere ([TRANSFERIR-HUMANO]) ou quando o atendente digita /atendente:
//   resumo da sessão (chat_summaries) + cliente identificado (telefone canônico)
//   + itens coletados ([INTERESSE-COMPRA-RESUMO]) + último status de orçamento/pedido/NF-e.
// Objetivo: ZERO "pode repetir seu pedido?" no retorno humano.
// Somente leitura — nada aqui grava dados além do campo notes do cliente (feito pelo chamador).
// Pendurado em globalThis para reuso entre hooks (PocketBase carrega todos os pb_hooks no mesmo escopo).
// ============================================
;(function () {
  const safeGet = (rec, field, fallback) => {
    try {
      const v = rec.get(field)
      if (v === undefined || v === null) return fallback
      return v
    } catch (_) {
      return fallback
    }
  }

  const canonicalDigits = (p) => {
    const s = String(p || '').replace(/\D/g, '')
    if (s.startsWith('55') && s.length >= 12) return s.slice(2)
    return s
  }

  const buildHandoffPacket = ($app, phone, interestDetails) => {
    const packet = {
      telefone: String(phone || ''),
      cliente: null,
      resumo_sessao: null,
      itens_coletados: interestDetails || null,
      ultimo_orcamento: null,
      ultimo_pedido: null,
      ultima_nfe: null,
      gerado_em: new Date().toISOString(),
    }
    if (!phone) return packet

    // 1. Cliente identificado pelo telefone canônico (dedupe F2)
    let customer = null
    try {
      const p1 = String(phone).replace(/\D/g, '')
      const p2 = canonicalDigits(phone)
      const found = $app.findRecordsByFilter(
        'customers',
        'phone ~ {:p1} || phone ~ {:p2}',
        '-created',
        1,
        0,
        { p1: p1, p2: p2 },
      )
      if (found && found.length > 0) customer = found[0]
    } catch (_) {}

    if (customer) {
      packet.cliente = {
        id: customer.id,
        nome: String(safeGet(customer, 'name', '') || ''),
        documento: String(safeGet(customer, 'document', safeGet(customer, 'cnpj', '')) || ''),
        pipeline_status: String(safeGet(customer, 'pipeline_status', '') || ''),
        lead_source: String(safeGet(customer, 'lead_source', '') || ''),
      }

      // 2. Itens coletados: marcador [INTERESSE-COMPRA] gravado nas notas do cliente
      try {
        const notes = String(safeGet(customer, 'notes', '') || '')
        const m = notes.match(/\[INTERESSE-COMPRA:([^\]]*)\]/i)
        if (!packet.itens_coletados && m) {
          packet.itens_coletados = { bruto: m[1].trim() }
        }
      } catch (_) {}

      // 3. Último orçamento (quotes) do cliente
      try {
        const quotes = $app.findRecordsByFilter('quotes', 'customer = {:cid}', '-created', 1, 0, {
          cid: customer.id,
        })
        if (quotes && quotes.length > 0) {
          const q = quotes[0]
          packet.ultimo_orcamento = {
            numero: String(safeGet(q, 'quote_number', safeGet(q, 'number', q.id)) || ''),
            status: String(safeGet(q, 'status', '') || ''),
            valor: safeGet(q, 'total', safeGet(q, 'value', null)),
            data: String(safeGet(q, 'created', '') || ''),
          }
        }
      } catch (_) {}

      // 4. Último pedido (orders) do cliente
      try {
        const orders = $app.findRecordsByFilter('orders', 'customer = {:cid}', '-created', 1, 0, {
          cid: customer.id,
        })
        if (orders && orders.length > 0) {
          const o = orders[0]
          packet.ultimo_pedido = {
            codigo: String(safeGet(o, 'order_number', safeGet(o, 'code', o.id)) || ''),
            commercial_status: String(safeGet(o, 'commercial_status', '') || ''),
            financial_status: String(safeGet(o, 'financial_status', '') || ''),
            data: String(safeGet(o, 'created', '') || ''),
          }
        }
      } catch (_) {}

      // 5. Última NF-e processada do cliente (busca pelo documento)
      const docDigits = String(packet.cliente.documento || '').replace(/\D/g, '')
      if (docDigits.length >= 11) {
        try {
          const nfes = $app.findRecordsByFilter(
            'nfe_processed',
            'customer_document ~ {:doc} || customer_cnpj ~ {:doc} || cnpj ~ {:doc}',
            '-created',
            1,
            0,
            { doc: docDigits },
          )
          if (nfes && nfes.length > 0) {
            const n = nfes[0]
            packet.ultima_nfe = {
              numero: String(safeGet(n, 'nfe_number', safeGet(n, 'numero', '')) || ''),
              status: String(safeGet(n, 'status', safeGet(n, 'processing_status', '')) || ''),
              chave: String(safeGet(n, 'chave', safeGet(n, 'access_key', '')) || ''),
              data: String(safeGet(n, 'created', '') || ''),
            }
          }
        } catch (_) {}
      }
    }

    // 6. Resumo da sessão (chat_summaries pelo telefone canônico)
    try {
      const canon = canonicalDigits(phone)
      const sums = $app.findRecordsByFilter(
        'chat_summaries',
        'canonical_phone = {:cp}',
        '-created',
        1,
        0,
        { cp: canon },
      )
      if (sums && sums.length > 0) {
        const s = sums[0]
        packet.resumo_sessao = {
          ultima_mensagem: String(safeGet(s, 'last_message_preview', '') || ''),
          direcao: String(safeGet(s, 'last_message_direction', '') || ''),
          ultima_interacao: String(safeGet(s, 'last_message_at', '') || ''),
          primeira_interacao: String(safeGet(s, 'first_message_at', '') || ''),
          nao_lidas: Number(safeGet(s, 'unread_count', 0)) || 0,
        }
      }
    } catch (_) {}

    return packet
  }

  const packetToLogText = (packet) => {
    const p = packet || {}
    const cli = p.cliente || {}
    const res = p.resumo_sessao || {}
    const itens = p.itens_coletados || {}
    return (
      'Cliente: ' +
      (cli.nome || p.telefone) +
      ' (' +
      (p.telefone || '') +
      ')' +
      ' | Resumo: ' +
      (res.ultima_mensagem || 'sem mensagens') +
      ' | Itens: ' +
      (itens.bruto || itens.itens || JSON.stringify(itens) || 'não especificado') +
      ' | Orçamento: ' +
      (p.ultimo_orcamento
        ? (p.ultimo_orcamento.numero || '') + ' ' + (p.ultimo_orcamento.status || '')
        : 'nenhum') +
      ' | Pedido: ' +
      (p.ultimo_pedido
        ? (p.ultimo_pedido.codigo || '') + ' ' + (p.ultimo_pedido.commercial_status || '')
        : 'nenhum') +
      ' | NF-e: ' +
      (p.ultima_nfe ? (p.ultima_nfe.numero || '') + ' ' + (p.ultima_nfe.status || '') : 'nenhuma')
    )
  }

  globalThis.__aiHandoffContext = {
    buildHandoffPacket: buildHandoffPacket,
    packetToLogText: packetToLogText,
  }
})()
