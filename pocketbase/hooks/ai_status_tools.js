// ai_status_tools.js — Fase 7 Rodada 1: 3 tools novas de function calling (somente leitura).
// (a) status_pedido — orçamentos e pedidos pelo telefone canônico do cliente;
// (b) status_nfe — NF-e processadas e contas a pagar por documento/telefone do cliente;
// (c) segunda_via_danfe — localiza a chave de 44 dígitos e grava comando busca_por_chave
//     na fila do worker DF-e (coleção dfe_command_queue, rota existente respeitada).
// Regra permanente: resposta SÓ com dado lido — nada inventado. Sem dados, retorna
// vazio/escalavel_humano e a IA escala ao atendente.
//
// Cada executor recebe um objeto ctx com o que precisa:
//   ctx.phone           — telefone canônico do remetente (message_processing)
//   ctx.maskedPhone     — telefone mascarado para logs
//   ctx.enqueueDfeCommand — função(command, params, createdByTag) que grava na fila do worker DF-e
// Os executores NUNCA lançam exceção: sempre devolvem objeto (com `erro` quando falham).

const BRASILIA_OFFSET_MS = -3 * 3600 * 1000

const nowBrasiliaIso = () => {
  try {
    return new Date(Date.now() + BRASILIA_OFFSET_MS).toISOString().replace('Z', '-03:00')
  } catch (_) {
    return new Date().toISOString()
  }
}

const cleanDigits = (v) => String(v || '').replace(/\D/g, '')

// Telefone canônico: sem DDI 55 (padrão usado em chat_summaries/contatos unificados)
const canonicalPhoneOf = (p) => {
  const d = cleanDigits(p)
  if (!d) return ''
  if (d.startsWith('55') && d.length >= 12) return d.slice(2)
  return d
}

const formatBRL = (v) => {
  const n = Number(v) || 0
  return 'R$ ' + n.toFixed(2).replace('.', ',')
}

const formatDateTimeBR = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  const b = new Date(d.getTime() + BRASILIA_OFFSET_MS)
  const pad = (x) => String(x).padStart(2, '0')
  return (
    pad(b.getUTCDate()) +
    '/' +
    pad(b.getUTCMonth() + 1) +
    '/' +
    b.getUTCFullYear() +
    ' ' +
    pad(b.getUTCHours()) +
    ':' +
    pad(b.getUTCMinutes())
  )
}

// Localiza o cliente por telefone canônico (contatos unificados: variantes com/sem DDI)
const findCustomerByPhone = (phone) => {
  const canonical = canonicalPhoneOf(phone)
  if (!canonical) return null
  const variants = [canonical]
  if (canonical.length >= 10 && canonical.length <= 11) {
    variants.push('55' + canonical)
  }
  // Match por sufixo: cobre phones gravados com DDI ou com máscara
  const suffix = canonical.length > 8 ? canonical.slice(-8) : canonical
  for (let i = 0; i < variants.length; i++) {
    try {
      const found = $app.findRecordsByFilter('customers', 'phone ~ {:v}', '-created', 10, 0, {
        v: variants[i],
      })
      // Confirma pelo sufixo canônico para evitar falso positivo do ~
      for (let j = 0; j < found.length; j++) {
        const custPhone = cleanDigits(found[j].getString('phone'))
        if (custPhone.endsWith(suffix)) return found[j]
      }
    } catch (_) {}
  }
  return null
}

// ============================================================
// (a) status_pedido — últimos orçamentos e pedidos do cliente
// ============================================================
const executeStatusPedido = (ctx) => {
  try {
    const customer = findCustomerByPhone(ctx.phone)
    if (!customer) {
      return {
        cliente_encontrado: false,
        orcamentos: [],
        pedidos: [],
        mensagem:
          'Cliente não localizado pelo telefone. Pergunte o nome/empresa e escale ao humano se não resolver.',
      }
    }

    const custId = customer.id
    const custName = String(customer.getString('name') || '')
    const custDoc = cleanDigits(customer.getString('document') || '')

    // --- Orçamentos (quotes) — relation direta ao cliente
    const orcamentos = []
    try {
      const quotes = $app.findRecordsByFilter('quotes', 'customer = {:cid}', '-created', 5, 0, {
        cid: custId,
      })
      for (let i = 0; i < quotes.length; i++) {
        const q = quotes[i]
        let total = 0
        try {
          total = Number(q.get('total')) || 0
        } catch (_) {}
        orcamentos.push({
          numero: String(q.getString('quote_number') || q.id),
          status: String(q.getString('status') || ''),
          valor: total,
          valor_fmt: total > 0 ? formatBRL(total) : 'Sob consulta',
          data: formatDateTimeBR(q.getString('created') || q.created),
        })
      }
    } catch (qErr) {
      console.log('[TOOL-STATUS-PEDIDO-QUOTES-ERR]', String(qErr))
    }

    // --- Pedidos (orders) — via quotes do cliente (orders carrega quote relation)
    const pedidos = []
    const quoteIds = {}
    for (let i = 0; i < orcamentosRaw.length; i++) quoteIds[orcamentosRaw[i].id] = true
    try {
      const orders = $app.findRecordsByFilter('orders', 'quote = {:qid}', '-created', 10, 0, {
        qid: custId,
      })
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        pedidos.push({
          codigo: String(o.getString('order_number') || o.id),
          status_comercial: String(o.getString('commercial_status') || ''),
          status_financeiro: String(o.getString('financial_status') || ''),
          valor: Number(o.get('total')) || 0,
          valor_fmt: formatBRL(Number(o.get('total')) || 0),
          data: formatDateTimeBR(o.getString('created') || o.created),
        })
      }
    } catch (oErr) {
      console.log('[TOOL-STATUS-PEDIDO-ORDERS-ERR]', String(oErr))
    }

    console.log(
      '[TOOL-STATUS-PEDIDO-EXECUTED]',
      JSON.stringify({
        horarioBrasilia: nowBrasiliaIso(),
        phone: ctx.maskedPhone,
        customerId: custId,
        orcamentos: orcamentos.length,
        pedidos: pedidos.length,
      }),
    )

    return {
      cliente_encontrado: true,
      cliente: custName,
      orcamentos: orcamentos,
      pedidos: pedidos,
    }
  } catch (err) {
    console.log('[TOOL-STATUS-PEDIDO-ERROR]', String(err))
    return { cliente_encontrado: false, orcamentos: [], pedidos: [], erro: String(err) }
  }
}

// ============================================================
// (b) status_nfe — NF-e recebidas do cliente + contas a pagar
// ============================================================
const executeStatusNfe = (ctx) => {
  try {
    const customer = findCustomerByPhone(ctx.phone)
    if (!customer) {
      return {
        cliente_encontrado: false,
        notas: [],
        mensagem:
          'Cliente não localizado pelo telefone. Pergunte o CNPJ ou número da NF e escale ao humano se não resolver.',
      }
    }

    const custDoc = cleanDigits(customer.getString('document') || '')
    const custName = String(customer.getString('name') || '')

    // --- NF-e processadas (nfe_processed), por documento do emitente/destinatário
    const notas = []
    try {
      let nfeFilter = ''
      const bind = {}
      if (custDoc.length >= 11) {
        nfeFilter = 'supplier_document ~ {:doc} || customer_document ~ {:doc}'
        bind = { doc: custDoc }
      } else {
        // Sem documento: procura pelas chaves registradas nas notas com o nome do cliente
        nfeFilter = 'supplier_name ~ {:name} || customer_name ~ {:name}'
        bind = { name: custName }
      }
      const nfes = $app.findRecordsByFilter('nfe_processed', nfeFilter, '-created', 10, 0, bind)
      for (let i = 0; i < nfes.length; i++) {
        const n = nfes[i]
        const status = String(n.getString('status') || '')
        notas.push({
          numero: String(n.getString('nfe_number') || n.id),
          chave: String(n.getString('nfe_key') || '').trim(),
          status: status,
          emitente: String(n.getString('supplier_name') || ''),
          valor: Number(n.get('total_value')) || 0,
          valor_fmt: formatBRL(Number(n.get('total_value')) || 0),
          data: formatDateTimeBR(n.getString('created') || n.created),
        })
      }
    } catch (nfeErr) {
      console.log('[TOOL-STATUS-NFE-NFE-ERR]', String(nfeErr))
    }

    // --- Contas a pagar ligadas ao cliente/fornecedor
    let contas = {
      encontradas: 0,
      pendentes: 0,
      pagas: [],
      resumo: 'Nenhuma conta a pagar encontrada.',
    }
    try {
      if (custDoc.length >= 11) {
        const aps = $app.findRecordsByFilter(
          'accounts_payable',
          'supplier_document ~ {:doc}',
          '-created',
          10,
          0,
          { doc: custDoc },
        )
        const pagas = []
        let pendentes = 0
        for (let i = 0; i < aps.length; i++) {
          const ap = aps[i]
          const apStatus = String(ap.getString('status') || '')
          if (apStatus === 'pago' || apStatus === 'paid') {
            pagas.push({
              descricao: String(ap.getString('description') || ''),
              valor_fmt: formatBRL(Number(ap.get('amount')) || 0),
              vencimento: formatDateTimeBR(ap.getString('due_date') || ''),
              status: apStatus,
            })
          } else {
            pendentes++
          }
        }
        contas = {
          encontradas: aps.length,
          pendentes: pendentes,
          pagas: pagas,
          resumo:
            pendentes > 0
              ? pendentes + ' conta(s) com pagamento pendente.'
              : 'Nenhuma pendência em aberto.',
        }
      }
    } catch (apErr) {
      console.log('[TOOL-STATUS-NFE-CONTAS-ERR]', String(apErr))
    }

    console.log(
      '[TOOL-STATUS-NFE-EXECUTED]',
      JSON.stringify({
        horarioBrasilia: nowBrasiliaIso(),
        phone: ctx.maskedPhone,
        customerId: customer.id,
        notas: notas.length,
        contas: contas.encontradas,
      }),
    )

    return {
      cliente_encontrado: true,
      cliente: custName,
      notas: notas,
      contas_a_pagar: contas,
      regra_cancelada: 'NF cancelada não deve ser paga — comunique isso ao cliente com clareza.',
    }
  } catch (err) {
    console.log('[TOOL-STATUS-NFE-ERROR]', String(err))
    return { cliente_encontrado: false, notas: [], erro: String(err) }
  }
}

// ============================================================
// (c) segunda_via_danfe — acha a chave de 44 dígitos do cliente
//     no pipeline DF-e e grava comando busca_por_chave na fila.
//     NUNCA inventa chave; sem chave → escala ao humano.
// ============================================================
const executeSegundaViaDanfe = (ctx) => {
  try {
    const customer = findCustomerByPhone(ctx.phone)
    if (!customer) {
      return {
        chave_encontrada: false,
        escalavel_humano: true,
        mensagem:
          'Cliente não localizado pelo telefone. Escalar ao humano para identificar a nota.',
      }
    }

    const custDoc = cleanDigits(customer.getString('document') || '')
    const custName = String(customer.getString('name') || '')

    // Procura a chave mais recente nas NF-e processadas do cliente (pipeline DF-e)
    let chave = ''
    let chaveOrigem = ''
    try {
      let bind = {}
      let filter = ''
      if (custDoc.length >= 11) {
        filter = 'supplier_document ~ {:doc} || customer_document ~ {:doc}'
        bind = { doc: custDoc }
      } else {
        filter = 'supplier_name ~ {:name} || customer_name ~ {:name}'
        bind = { name: custName }
      }
      const nfes = $app.findRecordsByFilter('nfe_processed', filter, '-created', 5, 0, bind)
      for (let i = 0; i < nfes.length; i++) {
        const k = cleanDigits(nfes[i].getString('nfe_key') || '')
        if (k.length === 44) {
          chave = k
          chaveOrigem = String(nfes[i].getString('nfe_number') || nfes[i].id)
          break
        }
      }
    } catch (keyErr) {
      console.log('[TOOL-SEGUNDA-VIA-DANFE-KEY-ERR]', String(keyErr))
    }

    if (!chave) {
      console.log(
        '[TOOL-SEGUNDA-VIA-DANFE-SEM-CHAVE]',
        JSON.stringify({
          horarioBrasilia: nowBrasiliaIso(),
          phone: ctx.maskedPhone,
          customerId: customer.id,
        }),
      )
      return {
        chave_encontrada: false,
        escalavel_humano: true,
        mensagem:
          'Nenhuma chave de 44 dígitos encontrada nas notas do cliente. Não invente chave — escale ao humano.',
      }
    }

    // Grava comando busca_por_chave na fila do worker DF-e (coleção dfe_command_queue,
    // mesmo canal da rota existente /backend/v1/dfe/commands/enqueue).
    let enqueueResult = { ok: false, detail: '' }
    try {
      const col = $app.findCollectionByNameOrId('dfe_command_queue')
      const cmd = new Record(col)
      cmd.set('command', 'busca_por_chave')
      cmd.set('params', { chave: chave, origem: 'ia_whatsapp', cliente: custName })
      cmd.set('status', 'pendente')
      cmd.set('result_summary', 'Enfileirado pela IA (segunda via DANFE)')
      cmd.set('executed_at', '')
      $app.save(cmd)
      enqueueResult = { ok: true, detail: cmd.id }
    } catch (enqErr) {
      enqueueResult = { ok: false, detail: String(enqErr) }
      console.log('[TOOL-SEGUNDA-VIA-DANFE-ENQUEUE-ERR]', String(enqErr))
    }

    console.log(
      '[TOOL-SEGUNDA-VIA-DANFE-EXECUTED]',
      JSON.stringify({
        horarioBrasilia: nowBrasiliaIso(),
        phone: ctx.maskedPhone,
        customerId: customer.id,
        chave: chave.slice(0, 8) + '...' + chave.slice(-4),
        origem: chaveOrigem,
        enfileirado: enqueueResult.ok,
      }),
    )

    return {
      chave_encontrada: true,
      chave: chave,
      chave_mascarada: chave.slice(0, 8) + '...' + chave.slice(-4),
      numero_nfe: chaveOrigem,
      comando_enfileirado: enqueueResult.ok,
      resposta_sugerida: 'Gerando a segunda via da DANFE e te envio em instantes.',
    }
  } catch (err) {
    console.log('[TOOL-SEGUNDA-VIA-DANFE-ERROR]', String(err))
    return { chave_encontrada: false, escalavel_humano: true, erro: String(err) }
  }
}

// Exporta no escopo global do JSVM (isole por hook — atribui a globalThis)
globalThis.__aiStatusTools = {
  executeStatusPedido,
  executeStatusNfe,
  executeSegundaViaDanfe,
  findCustomerByPhone,
  canonicalPhoneOf,
}
