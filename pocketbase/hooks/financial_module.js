// Hook: Rotas e ações do Menu Financeiro
// Requisitos PROMPT 1:
// - ③ Contas a Pagar: baixa (marcar pago com data + forma), log [FIN-BAIXA]
// - Estorno/reabertura também logado [FIN-BAIXA]
// - GUARDA NF-e: lançamentos vindos do pipeline com origin='nfe' ou vinculados a NF-e
//   são READ-ONLY no conteúdo (valor, fornecedor, parcelas, etc.) — só a baixa/estorno é permitida
// - Reenvio do mesmo XML nunca cria segundo lançamento (idempotência por nfe_access_key)
// - ⑤ Cron diário: para cada modelo recorrente ativo, gerar o lançamento do mês corrente se ainda não existir
// - S5: competência calculada no horário de Brasília (America/Sao_Paulo), NUNCA UTC
// - S6: dedupe por índice único no banco (recurring_template + recurring_competence)
// - MA-b: cron loga [FIN-CRON] (gerados / já existentes / falhas)
// - ⑦ GUARDA de categorias: não excluir categoria com lançamentos vinculados

// 1. Cron diário para geração de despesas recorrentes
// Executa diariamente às 06:00 UTC (03:00 Horário de Brasília)
cronAdd('financial-daily-recurring-cron', '0 6 * * *', () => {
  // Cálculo da data e competência no fuso de Brasília (UTC-3 fixo)
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const brMs = utcMs - 3 * 3600000
  const brDate = new Date(brMs)

  const year = brDate.getUTCFullYear()
  const month = String(brDate.getUTCMonth() + 1).padStart(2, '0')
  const competence = year + '-' + month

  let templates = []
  try {
    templates = $app.findRecordsByFilter(
      'financial_recurring_templates',
      'is_active = true',
      'created',
      500,
      0,
    )
  } catch (err) {
    console.log('[FIN-CRON] Erro ao buscar templates recorrentes: ' + String(err))
    return
  }

  let generatedCount = 0
  let existingCount = 0
  let errorCount = 0

  const payablesCol = $app.findCollectionByNameOrId('accounts_payable')

  for (let i = 0; i < templates.length; i++) {
    const tmpl = templates[i]
    const tmplId = tmpl.id
    const desc = tmpl.getString('description')
    const dueDay = tmpl.getInt('due_day') || 1
    const method = tmpl.getString('default_payment_method') || 'boleto'
    const catId = tmpl.getString('category')
    const suppId = tmpl.getString('supplier')
    const suppName = tmpl.getString('supplier_name')
    const fixedAmount = tmpl.getFloat('fixed_amount') || 0

    // Verificar se já existe lançamento para esta competência
    try {
      const existing = $app.findFirstRecordByFilter(
        'accounts_payable',
        `recurring_template = "${tmplId}" && recurring_competence = "${competence}"`,
      )
      if (existing) {
        existingCount++
        continue
      }
    } catch (_) {
      // Não existe lançamento anterior, prosseguir com criação
    }

    // Calcular data de vencimento no mês corrente (ajustando para o último dia do mês se dueDay for maior)
    const maxDaysInMonth = new Date(year, Number(month), 0).getDate()
    const validDay = Math.min(dueDay, maxDaysInMonth)
    const dueDateStr = `${year}-${month}-${String(validDay).padStart(2, '0')} 12:00:00.000Z`

    try {
      const rec = new Record(payablesCol)
      rec.set('description', `${desc} - ${competence}`)
      if (catId) rec.set('category', catId)
      if (suppId) rec.set('supplier', suppId)
      if (suppName) rec.set('supplier_name', suppName)
      rec.set('amount', fixedAmount)
      rec.set('due_date', dueDateStr)
      rec.set('status', 'pendente')
      rec.set('origin', 'recorrente')
      rec.set('recurring_template', tmplId)
      rec.set('recurring_competence', competence)
      rec.set('payment_method', method)
      rec.set('notes', `Gerado automaticamente via rotina de recorrentes (${competence})`)

      $app.save(rec)
      generatedCount++
    } catch (saveErr) {
      // Se estourar índice único por corrida, conta como existente
      const errMsg = String(saveErr)
      if (errMsg.indexOf('UNIQUE constraint failed') !== -1) {
        existingCount++
      } else {
        errorCount++
        console.log(`[FIN-CRON] Falha ao gerar recorrente "${desc}" (${competence}): ${errMsg}`)
      }
    }
  }

  console.log(
    `[FIN-CRON] Competência ${competence} (Brasília UTC-3) concluída: ${generatedCount} gerados, ${existingCount} já existentes, ${errorCount} falhas. Total de modelos: ${templates.length}.`,
  )
})

// 2. Rota manual / administrativa para forçar geração do cron de recorrentes
// POST /backend/v1/financial/recurring/run
routerAdd(
  'POST',
  '/backend/v1/financial/recurring/run',
  (e) => {
    const authRecord = e.auth
    if (!authRecord || authRecord.getString('role') !== 'admin') {
      return e.json(403, { success: false, error: 'Acesso negado: apenas admin' })
    }

    let reqData = {}
    try {
      reqData = e.requestInfo().body || {}
    } catch (_) {
      reqData = {}
    }

    // Fuso de Brasília UTC-3
    const now = new Date()
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
    const brMs = utcMs - 3 * 3600000
    const brDate = new Date(brMs)

    const defaultYear = brDate.getUTCFullYear()
    const defaultMonth = String(brDate.getUTCMonth() + 1).padStart(2, '0')
    const defaultCompetence = defaultYear + '-' + defaultMonth

    const targetCompetence =
      reqData.competence && String(reqData.competence).trim()
        ? String(reqData.competence).trim()
        : defaultCompetence

    const parts = targetCompetence.split('-')
    const year = Number(parts[0]) || defaultYear
    const month = String(parts[1] || defaultMonth).padStart(2, '0')

    let templates = []
    try {
      templates = $app.findRecordsByFilter(
        'financial_recurring_templates',
        'is_active = true',
        'created',
        500,
        0,
      )
    } catch (err) {
      return e.json(500, { success: false, error: 'Erro ao buscar templates: ' + String(err) })
    }

    let generatedCount = 0
    let existingCount = 0
    let errorCount = 0

    const payablesCol = $app.findCollectionByNameOrId('accounts_payable')

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i]
      const tmplId = tmpl.id
      const desc = tmpl.getString('description')
      const dueDay = tmpl.getInt('due_day') || 1
      const method = tmpl.getString('default_payment_method') || 'boleto'
      const catId = tmpl.getString('category')
      const suppId = tmpl.getString('supplier')
      const suppName = tmpl.getString('supplier_name')
      const fixedAmount = tmpl.getFloat('fixed_amount') || 0

      try {
        const existing = $app.findFirstRecordByFilter(
          'accounts_payable',
          `recurring_template = "${tmplId}" && recurring_competence = "${targetCompetence}"`,
        )
        if (existing) {
          existingCount++
          continue
        }
      } catch (_) {}

      const maxDaysInMonth = new Date(year, Number(month), 0).getDate()
      const validDay = Math.min(dueDay, maxDaysInMonth)
      const dueDateStr = `${year}-${month}-${String(validDay).padStart(2, '0')} 12:00:00.000Z`

      try {
        const rec = new Record(payablesCol)
        rec.set('description', `${desc} - ${targetCompetence}`)
        if (catId) rec.set('category', catId)
        if (suppId) rec.set('supplier', suppId)
        if (suppName) rec.set('supplier_name', suppName)
        rec.set('amount', fixedAmount)
        rec.set('due_date', dueDateStr)
        rec.set('status', 'pendente')
        rec.set('origin', 'recorrente')
        rec.set('recurring_template', tmplId)
        rec.set('recurring_competence', targetCompetence)
        rec.set('payment_method', method)
        rec.set('notes', `Gerado via execução manual de recorrentes (${targetCompetence})`)
        rec.set('created_by', authRecord.id)

        $app.save(rec)
        generatedCount++
      } catch (saveErr) {
        const errMsg = String(saveErr)
        if (errMsg.indexOf('UNIQUE constraint failed') !== -1) {
          existingCount++
        } else {
          errorCount++
          console.log(`[FIN-CRON] Falha manual "${desc}" (${targetCompetence}): ${errMsg}`)
        }
      }
    }

    const logMsg = `[FIN-CRON] Execução manual para competência ${targetCompetence} (Brasília): ${generatedCount} gerados, ${existingCount} já existentes, ${errorCount} falhas.`
    console.log(logMsg)

    return e.json(200, {
      success: true,
      competence: targetCompetence,
      generated: generatedCount,
      existing: existingCount,
      errors: errorCount,
      message: logMsg,
    })
  },
  $apis.requireAuth(),
)

// 3. Hooks de validação e log: Contas a Pagar e Receber
// - Log [FIN-BAIXA] em pagamento ou estorno
// - Bloqueio de alteração de conteúdo em registros vindos de NF-e (origin='nfe')
onRecordUpdate(
  (e) => {
    const collectionName = e.record.collection().name
    if (collectionName !== 'accounts_payable' && collectionName !== 'accounts_receivable') {
      return e.next()
    }

    const original = e.record.original()
    if (!original) {
      return e.next()
    }

    const oldStatus = original.getString('status')
    const newStatus = e.record.getString('status')
    const id = e.record.id
    const desc = e.record.getString('description')
    const amount = e.record.getFloat('amount')
    const authRecord = e.auth
    const userIdentifier = authRecord
      ? `${authRecord.getString('name')} (${authRecord.id})`
      : 'Sistema'

    // GUARDA NF-e: Lançamentos com origin='nfe' ou com nfe_access_key têm dados contratuais protegidos
    if (collectionName === 'accounts_payable') {
      const origin = original.getString('origin')
      const hasNfe = original.getString('nfe_access_key') || origin === 'nfe'
      if (hasNfe) {
        const origAmount = original.getFloat('amount')
        const newAmount = e.record.getFloat('amount')
        const origSupplier = original.getString('supplier')
        const newSupplier = e.record.getString('supplier')
        const origOrigin = original.getString('origin')

        if (Math.abs(origAmount - newAmount) > 0.001) {
          throw new BadRequestError(
            'Lançamentos originados de NF-e são protegidos: o valor não pode ser alterado.',
          )
        }
        if (origSupplier && origSupplier !== newSupplier) {
          throw new BadRequestError(
            'Lançamentos originados de NF-e são protegidos: o fornecedor não pode ser alterado.',
          )
        }
        if (origOrigin !== e.record.getString('origin')) {
          throw new BadRequestError('A origem deste lançamento é NF-e e não pode ser modificada.')
        }
      }
    }

    // Log de Baixa ou Estorno [FIN-BAIXA]
    if (oldStatus !== newStatus) {
      if (newStatus === 'pago') {
        const method = e.record.getString('payment_method') || 'N/A'
        const paidAt = e.record.getString('paid_at') || new Date().toISOString()
        console.log(
          `[FIN-BAIXA] Lançamento ${collectionName} ID=${id} ("${desc}") baixado como PAGO. Valor: R$ ${amount.toFixed(2)}, Método: ${method}, Data de Pagamento: ${paidAt}. Operador: ${userIdentifier}`,
        )
      } else if (oldStatus === 'pago' && (newStatus === 'pendente' || newStatus === 'cancelado')) {
        console.log(
          `[FIN-BAIXA] ESTORNO/REABERTURA: Lançamento ${collectionName} ID=${id} ("${desc}") alterado de PAGO para ${newStatus.toUpperCase()}. Valor: R$ ${amount.toFixed(2)}. Operador: ${userIdentifier}`,
        )
      }
    }

    return e.next()
  },
  'accounts_payable',
  'accounts_receivable',
)

// 4. GUARDA: Não permitir exclusão de categoria financeira se houver lançamentos vinculados
onRecordDelete((e) => {
  const collectionName = e.record.collection().name
  if (collectionName !== 'financial_categories') {
    return e.next()
  }

  const categoryId = e.record.id
  const categoryName = e.record.getString('name')

  // Checar Contas a Pagar
  let apCount = 0
  try {
    const apList = $app.findRecordsByFilter(
      'accounts_payable',
      `category = "${categoryId}"`,
      '',
      1,
      0,
    )
    apCount = apList.length
  } catch (_) {}

  if (apCount > 0) {
    throw new BadRequestError(
      `Não é possível excluir a categoria "${categoryName}" pois existem lançamentos vinculados a ela em Contas a Pagar.`,
    )
  }

  // Checar Contas a Receber
  let arCount = 0
  try {
    const arList = $app.findRecordsByFilter(
      'accounts_receivable',
      `category = "${categoryId}"`,
      '',
      1,
      0,
    )
    arCount = arList.length
  } catch (_) {}

  if (arCount > 0) {
    throw new BadRequestError(
      `Não é possível excluir a categoria "${categoryName}" pois existem lançamentos vinculados a ela em Contas a Receber.`,
    )
  }

  // Checar Modelos Recorrentes
  let recCount = 0
  try {
    const recList = $app.findRecordsByFilter(
      'financial_recurring_templates',
      `category = "${categoryId}"`,
      '',
      1,
      0,
    )
    recCount = recList.length
  } catch (_) {}

  if (recCount > 0) {
    throw new BadRequestError(
      `Não é possível excluir a categoria "${categoryName}" pois existem modelos recorrentes vinculados a ela.`,
    )
  }

  return e.next()
}, 'financial_categories')

// 5. GUARDA: Idempotência de criação por NF-e (se já existir accounts_payable com a mesma nfe_access_key e parcela, bloqueia duplicata)
onRecordCreate((e) => {
  const collectionName = e.record.collection().name
  if (collectionName !== 'accounts_payable') {
    return e.next()
  }

  const accessKey = e.record.getString('nfe_access_key')
  const installment = e.record.getInt('installment_number') || 1
  if (accessKey && accessKey.trim()) {
    try {
      const existing = $app.findFirstRecordByFilter(
        'accounts_payable',
        `nfe_access_key = "${accessKey.trim()}" && installment_number = ${installment}`,
      )
      if (existing) {
        throw new BadRequestError(
          `NF-e já lançada em Contas a Pagar (Chave: ${accessKey}, Parcela: ${installment}). Criação duplicada bloqueada.`,
        )
      }
    } catch (findErr) {
      if (String(findErr).indexOf('NF-e já lançada') !== -1) {
        throw findErr
      }
      // Não encontrou, ok para criar
    }
  }

  return e.next()
}, 'accounts_payable')
