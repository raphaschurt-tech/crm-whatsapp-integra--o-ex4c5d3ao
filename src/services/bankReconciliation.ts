import pb from '@/lib/pocketbase/client'
import {
  BankStatementLine,
  BankReconciliation,
  AccountsPayable,
  AccountsReceivable,
  MatchCandidate,
  StatementLineWithMatch,
  MatchSuggestionConfidence,
} from '@/types/crm'
import { ParsedStatementTransaction, ParsedStatementResult } from './statementParser'

export interface ImportStatementParams {
  bankAccountId: string
  transactions: ParsedStatementTransaction[]
  fileName?: string
  batchId?: string
}

export interface ImportStatementResult {
  totalInFile: number
  importedCount: number
  duplicatedCount: number
  importedLines: BankStatementLine[]
  errors: string[]
}

/**
 * Normaliza string para tokens de busca e comparação
 */
function extractTokens(text?: string | null): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

/**
 * Calcula diferença em dias corridos entre duas datas YYYY-MM-DD
 */
function daysDiff(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1.substring(0, 10) + 'T00:00:00Z').getTime()
  const d2 = new Date(dateStr2.substring(0, 10) + 'T00:00:00Z').getTime()
  return Math.abs(Math.round((d1 - d2) / (1000 * 60 * 60 * 24)))
}

/**
 * Importa linhas de extrato com deduplicação rigorosa por conta + dedupe_hash
 */
export async function importBankStatement(
  params: ImportStatementParams,
): Promise<ImportStatementResult> {
  const { bankAccountId, transactions, fileName, batchId } = params
  const result: ImportStatementResult = {
    totalInFile: transactions.length,
    importedCount: 0,
    duplicatedCount: 0,
    importedLines: [],
    errors: [],
  }

  if (!bankAccountId || transactions.length === 0) {
    return result
  }

  // Busca hashes já existentes nesta conta para evitar consultas em loop
  // Busca todas as linhas da conta
  const existingRecords = await pb
    .collection('bank_statement_lines')
    .getFullList<BankStatementLine>({
      filter: `bank_account = "${bankAccountId}"`,
      fields: 'id,dedupe_hash',
    })

  const existingHashSet = new Set<string>()
  for (const r of existingRecords) {
    if (r.dedupe_hash) existingHashSet.add(r.dedupe_hash)
  }

  const generatedBatchId =
    batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

  for (const tx of transactions) {
    if (existingHashSet.has(tx.dedupeHash)) {
      result.duplicatedCount += 1
      continue
    }

    try {
      const created = await pb.collection('bank_statement_lines').create<BankStatementLine>({
        bank_account: bankAccountId,
        date: tx.date,
        amount: tx.amount,
        type: tx.type,
        description: tx.description,
        fitid: tx.fitid || '',
        check_number: tx.checkNumber || '',
        memo: tx.memo || '',
        dedupe_hash: tx.dedupeHash,
        status: 'pendente',
        import_batch_id: generatedBatchId,
        source_file_name: fileName || '',
      })

      existingHashSet.add(tx.dedupeHash)
      result.importedCount += 1
      result.importedLines.push(created)
    } catch (err: any) {
      // Se colidiu com índice único no banco de dados, conta como duplicado
      if (
        err?.status === 400 &&
        (String(err?.message).includes('idx_stmt_lines_dedupe') ||
          String(err?.data?.dedupe_hash).includes('unique'))
      ) {
        result.duplicatedCount += 1
        existingHashSet.add(tx.dedupeHash)
      } else {
        result.errors.push(
          `Erro ao importar lançamento "${tx.description}" (${tx.amount}): ${err?.message || String(err)}`,
        )
      }
    }
  }

  return result
}

/**
 * Busca linhas do extrato bancário por conta e filtros opcionais
 */
export async function getBankStatementLines(options: {
  bankAccountId: string
  status?: 'pendente' | 'conciliado' | 'ignorado' | 'todos'
  startDate?: string
  endDate?: string
}): Promise<BankStatementLine[]> {
  const filters: string[] = [`bank_account = "${options.bankAccountId}"`]

  if (options.status && options.status !== 'todos') {
    filters.push(`status = "${options.status}"`)
  }

  if (options.startDate) {
    filters.push(`date >= "${options.startDate}T00:00:00.000Z"`)
  }

  if (options.endDate) {
    filters.push(`date <= "${options.endDate}T23:59:59.999Z"`)
  }

  return pb.collection('bank_statement_lines').getFullList<BankStatementLine>({
    filter: filters.join(' && '),
    sort: '-date',
    expand: 'matched_payable,matched_receivable,reconciled_by',
  })
}

/**
 * Avalia casamento entre uma linha de extrato e lançamentos do CRM (A Pagar ou A Receber)
 * Critérios:
 * 1. Valor exato (ou centavos idênticos)
 * 2. Data próxima (tolerância até 3 dias úteis/corridos)
 * 3. Descrição/identificação (nome fornecedor/cliente, chave NF-e, número da NF-e)
 * Classificação:
 * - provavel: 1 candidato forte (valor exato + data próxima + descrição coerente)
 * - dubia: 2 ou mais candidatos com pontuação próxima
 * - sem_correspondencia: nenhum candidato elegível
 */
export function scoreMatchCandidates(
  line: BankStatementLine,
  payables: AccountsPayable[],
  receivables: AccountsReceivable[],
): {
  confidence: MatchSuggestionConfidence
  bestMatch?: MatchCandidate
  candidates: MatchCandidate[]
} {
  const lineAbsCents = Math.round(Math.abs(line.amount) * 100)
  const lineDateStr = line.date.substring(0, 10)
  const lineTokens = extractTokens(line.description + ' ' + (line.memo || ''))

  const candidates: MatchCandidate[] = []

  if (line.type === 'debito') {
    // Débitos procuram contas a pagar
    for (const ap of payables) {
      // Ignora canceladas
      if (ap.status === 'cancelado') continue

      const apCents = Math.round(Number(ap.amount) * 100)
      if (apCents !== lineAbsCents) continue // Regra rígida: valor exato

      const dueDateStr = (ap.due_date || '').substring(0, 10)
      const diff = dueDateStr ? daysDiff(lineDateStr, dueDateStr) : 99

      // Filtra por janela de tolerância de até 3 dias (pode pagar até 3 dias antes ou depois da data de vencimento)
      if (diff > 3) continue

      let score = 50 // Base: valor exato + data próxima
      const reasons: string[] = ['Valor exato', `Vencimento próximo (${diff}d)`]

      if (diff === 0) {
        score += 20
        reasons.push('Data idêntica')
      } else if (diff === 1) {
        score += 10
      }

      // Pontuação por descrição (nome do fornecedor, número NF-e, chave)
      const apTokens = extractTokens(
        `${ap.description} ${ap.supplier_name || ''} ${ap.nfe_access_key || ''}`,
      )
      let tokenMatches = 0
      for (const t of apTokens) {
        if (lineTokens.includes(t)) {
          tokenMatches += 1
        }
      }

      if (tokenMatches > 0) {
        score += Math.min(tokenMatches * 15, 30)
        reasons.push(`${tokenMatches} termo(s) coincidente(s) na descrição`)
      }

      // Se o status da conta já for pendente e não tiver conta bancária vinculada, ganha peso
      if (ap.status === 'pendente') {
        score += 10
        reasons.push('Status pendente no CRM')
      }

      candidates.push({
        id: ap.id,
        kind: 'payable',
        description: ap.description,
        amount: ap.amount,
        due_date: dueDateStr,
        status: ap.status,
        origin: ap.origin,
        entity_name: ap.supplier_name,
        nfe_number: ap.nfe_access_key ? ap.nfe_access_key.substring(25, 34) : undefined,
        score,
        reasons,
      })
    }
  } else {
    // Créditos procuram contas a receber
    for (const ar of receivables) {
      if (ar.status === 'cancelado') continue

      const arCents = Math.round(Number(ar.amount) * 100)
      if (arCents !== lineAbsCents) continue

      const dueDateStr = (ar.due_date || '').substring(0, 10)
      const diff = dueDateStr ? daysDiff(lineDateStr, dueDateStr) : 99

      if (diff > 3) continue

      let score = 50
      const reasons: string[] = ['Valor exato', `Vencimento próximo (${diff}d)`]

      if (diff === 0) {
        score += 20
        reasons.push('Data idêntica')
      } else if (diff === 1) {
        score += 10
      }

      const arTokens = extractTokens(`${ar.description} ${ar.customer_name || ''}`)
      let tokenMatches = 0
      for (const t of arTokens) {
        if (lineTokens.includes(t)) {
          tokenMatches += 1
        }
      }

      if (tokenMatches > 0) {
        score += Math.min(tokenMatches * 15, 30)
        reasons.push(`${tokenMatches} termo(s) coincidente(s) na descrição`)
      }

      if (ar.status === 'pendente') {
        score += 10
        reasons.push('Status pendente no CRM')
      }

      candidates.push({
        id: ar.id,
        kind: 'receivable',
        description: ar.description,
        amount: ar.amount,
        due_date: dueDateStr,
        status: ar.status,
        origin: ar.origin,
        entity_name: ar.customer_name,
        score,
        reasons,
      })
    }
  }

  // Ordena candidatos por pontuação decrescente
  candidates.sort((a, b) => b.score - a.score)

  if (candidates.length === 0) {
    return {
      confidence: 'sem_correspondencia',
      candidates: [],
    }
  }

  if (candidates.length === 1) {
    return {
      confidence: 'provavel',
      bestMatch: candidates[0],
      candidates,
    }
  }

  // 2 ou mais candidatos: verifica se o primeiro tem destaque claro
  const top1 = candidates[0]
  const top2 = candidates[1]
  if (top1.score - top2.score >= 25 && top1.score >= 70) {
    return {
      confidence: 'provavel',
      bestMatch: top1,
      candidates,
    }
  }

  return {
    confidence: 'dubia',
    bestMatch: top1,
    candidates,
  }
}

/**
 * Constrói a lista de linhas do extrato com sugestões de casamento calculadas
 */
export async function buildReconciliationMatches(bankAccountId: string): Promise<{
  linesWithMatches: StatementLineWithMatch[]
  pendingLinesCount: number
  reconciledLinesCount: number
  ignoredLinesCount: number
}> {
  const [statementLines, payables, receivables] = await Promise.all([
    getBankStatementLines({ bankAccountId, status: 'todos' }),
    pb.collection('accounts_payable').getFullList<AccountsPayable>({
      filter: 'status != "cancelado"',
      sort: '-due_date',
    }),
    pb.collection('accounts_receivable').getFullList<AccountsReceivable>({
      filter: 'status != "cancelado"',
      sort: '-due_date',
    }),
  ])

  let pendingCount = 0
  let reconciledCount = 0
  let ignoredCount = 0

  const linesWithMatches: StatementLineWithMatch[] = statementLines.map((line) => {
    if (line.status === 'conciliado') {
      reconciledCount += 1
      return {
        line,
        confidence: 'provavel',
        candidates: [],
      }
    }

    if (line.status === 'ignorado') {
      ignoredCount += 1
      return {
        line,
        confidence: 'sem_correspondencia',
        candidates: [],
      }
    }

    pendingCount += 1
    const matchResult = scoreMatchCandidates(line, payables, receivables)
    return {
      line,
      confidence: matchResult.confidence,
      bestMatch: matchResult.bestMatch,
      candidates: matchResult.candidates,
    }
  })

  return {
    linesWithMatches,
    pendingLinesCount: pendingCount,
    reconciledLinesCount: reconciledCount,
    ignoredLinesCount: ignoredCount,
  }
}

/**
 * Confirmação humana em 1 clique:
 * NADA concilia sozinho.
 * Atualiza o lançamento como pago/recebido com a data real do extrato e vincula à conta bancária.
 * Atualiza a linha do extrato como conciliada.
 */
export async function confirmReconciliationMatch(params: {
  lineId: string
  candidate: MatchCandidate
  userId?: string
}): Promise<void> {
  const { lineId, candidate, userId } = params
  const line = await pb.collection('bank_statement_lines').getOne<BankStatementLine>(lineId)

  // Data real do extrato
  const realDate = line.date.substring(0, 10)

  if (candidate.kind === 'payable') {
    // Atualiza accounts_payable: status='pago', paid_at=realDate, bank_account_id=line.bank_account
    // Nota: guard do hook financial_module permite marcar como pago e alterar bank_account_id
    await pb.collection('accounts_payable').update(candidate.id, {
      status: 'pago',
      paid_at: realDate,
      bank_account_id: line.bank_account,
    })

    // Atualiza bank_statement_lines
    await pb.collection('bank_statement_lines').update(lineId, {
      status: 'conciliado',
      matched_type: 'payable',
      matched_payable: candidate.id,
      reconciled_at: new Date().toISOString(),
      reconciled_by: userId || pb.authStore.model?.id || '',
    })
  } else {
    // Atualiza accounts_receivable: status='pago', paid_at=realDate, bank_account_id=line.bank_account
    await pb.collection('accounts_receivable').update(candidate.id, {
      status: 'pago',
      paid_at: realDate,
      bank_account_id: line.bank_account,
    })

    // Atualiza bank_statement_lines
    await pb.collection('bank_statement_lines').update(lineId, {
      status: 'conciliado',
      matched_type: 'receivable',
      matched_receivable: candidate.id,
      reconciled_at: new Date().toISOString(),
      reconciled_by: userId || pb.authStore.model?.id || '',
    })
  }
}

/**
 * Desfaz conciliação de uma linha
 */
export async function undoReconciliation(lineId: string): Promise<void> {
  const line = await pb.collection('bank_statement_lines').getOne<BankStatementLine>(lineId)

  await pb.collection('bank_statement_lines').update(lineId, {
    status: 'pendente',
    matched_type: null,
    matched_payable: null,
    matched_receivable: null,
    reconciled_at: null,
    reconciled_by: null,
  })
}

/**
 * Ignora uma linha do extrato (ex: transferência interna já lançada, estorno neutro)
 */
export async function ignoreStatementLine(lineId: string, notes?: string): Promise<void> {
  await pb.collection('bank_statement_lines').update(lineId, {
    status: 'ignorado',
    matched_type: 'ignorado',
    notes: notes || 'Ignorado pelo usuário',
  })
}

/**
 * Cria lançamento avulso a partir de uma linha sem correspondência (tarifa/TED/transferência/recebimento avulso)
 * e já concilia automaticamente a linha
 */
export async function createAdHocEntryAndReconcile(params: {
  lineId: string
  categoryId?: string
  description?: string
  paymentMethod?: string
  notes?: string
  userId?: string
}): Promise<void> {
  const { lineId, categoryId, description, paymentMethod, notes, userId } = params
  const line = await pb.collection('bank_statement_lines').getOne<BankStatementLine>(lineId)
  const lineDate = line.date.substring(0, 10)
  const absAmount = Math.abs(line.amount)
  const effectiveDesc = description?.trim() || line.description
  const currentUserId = userId || pb.authStore.model?.id || ''

  if (line.type === 'debito') {
    // Cria conta a pagar avulsa já liquidada ('pago')
    const payable = await pb.collection('accounts_payable').create<AccountsPayable>({
      description: effectiveDesc,
      category: categoryId || '',
      amount: absAmount,
      due_date: lineDate,
      paid_at: lineDate,
      status: 'pago',
      origin: 'manual',
      payment_method: (paymentMethod as any) || 'outros',
      bank_account_id: line.bank_account,
      notes: notes || `Lançamento avulso via conciliação bancária: ${line.description}`,
      created_by: currentUserId,
    })

    await pb.collection('bank_statement_lines').update(lineId, {
      status: 'conciliado',
      matched_type: 'avulso_despesa',
      matched_payable: payable.id,
      reconciled_at: new Date().toISOString(),
      reconciled_by: currentUserId,
    })
  } else {
    // Cria conta a receber avulsa já liquidada ('pago')
    const receivable = await pb.collection('accounts_receivable').create<AccountsReceivable>({
      description: effectiveDesc,
      category: categoryId || '',
      amount: absAmount,
      due_date: lineDate,
      paid_at: lineDate,
      status: 'pago',
      origin: 'manual',
      payment_method: (paymentMethod as any) || 'outros',
      bank_account_id: line.bank_account,
      notes: notes || `Lançamento avulso via conciliação bancária: ${line.description}`,
      created_by: currentUserId,
    })

    await pb.collection('bank_statement_lines').update(lineId, {
      status: 'conciliado',
      matched_type: 'avulso_receita',
      matched_receivable: receivable.id,
      reconciled_at: new Date().toISOString(),
      reconciled_by: currentUserId,
    })
  }
}

/**
 * Calcula fechamento por conta e competência (YYYY-MM):
 * - Saldo inicial da conta
 * - Total de recebimentos liquidados vinculados
 * - Total de pagamentos liquidados vinculados
 * - Saldo CRM calculado
 * - Saldo do extrato importado (última linha do período ou saldo final de cabeçalho OFX)
 * - Divergência e linhas pendentes
 */
export async function calculateAccountCompetenceClosing(params: {
  bankAccountId: string
  competence: string // YYYY-MM
  statementClosingBalance?: number
  statementClosingDate?: string
}): Promise<{
  competence: string
  bankAccount: any
  initialBalance: number
  totalInflows: number
  totalOutflows: number
  crmCalculatedBalance: number
  statementClosingBalance: number
  differenceAmount: number
  isReconciled: boolean
  pendingLinesCount: number
  pendingLines: BankStatementLine[]
}> {
  const { bankAccountId, competence, statementClosingBalance, statementClosingDate } = params

  const bankAccount = await pb.collection('bank_accounts').getOne(bankAccountId)
  const initialBalance = Number(bankAccount.initial_balance || 0)

  // Início e fim da competência em YYYY-MM-DD
  const [yyyy, mm] = competence.split('-')
  const startDate = `${competence}-01T00:00:00.000Z`
  const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate()
  const endDate = `${competence}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`

  // Busca liquidados do CRM no período
  const [payables, receivables, statementLines] = await Promise.all([
    pb.collection('accounts_payable').getFullList<AccountsPayable>({
      filter: `bank_account_id = "${bankAccountId}" && status = "pago" && paid_at <= "${competence}-${String(lastDay).padStart(2, '0')}"`,
    }),
    pb.collection('accounts_receivable').getFullList<AccountsReceivable>({
      filter: `bank_account_id = "${bankAccountId}" && status = "pago" && paid_at <= "${competence}-${String(lastDay).padStart(2, '0')}"`,
    }),
    pb.collection('bank_statement_lines').getFullList<BankStatementLine>({
      filter: `bank_account = "${bankAccountId}" && date >= "${startDate}" && date <= "${endDate}"`,
      sort: '-date',
    }),
  ])

  let totalOutflows = 0
  for (const p of payables) {
    totalOutflows += Number(p.amount || 0)
  }

  let totalInflows = 0
  for (const r of receivables) {
    totalInflows += Number(r.amount || 0)
  }

  const crmCalculatedBalance =
    Math.round((initialBalance + totalInflows - totalOutflows) * 100) / 100

  // Se não foi fornecido saldo de extrato, calcula a partir do saldo inicial + soma das linhas do extrato
  let stmtBalance = statementClosingBalance
  if (stmtBalance === undefined || stmtBalance === null) {
    let stmtSum = 0
    for (const l of statementLines) {
      stmtSum += Number(l.amount || 0)
    }
    stmtBalance = Math.round((initialBalance + stmtSum) * 100) / 100
  }

  const differenceAmount = Math.round((crmCalculatedBalance - stmtBalance) * 100) / 100
  const isReconciled = Math.abs(differenceAmount) < 0.01

  const pendingLines = statementLines.filter((l) => l.status === 'pendente')

  return {
    competence,
    bankAccount,
    initialBalance,
    totalInflows: Math.round(totalInflows * 100) / 100,
    totalOutflows: Math.round(totalOutflows * 100) / 100,
    crmCalculatedBalance,
    statementClosingBalance: stmtBalance,
    differenceAmount,
    isReconciled,
    pendingLinesCount: pendingLines.length,
    pendingLines,
  }
}

/**
 * Salva fechamento de conciliação bancária por conta/competência
 */
export async function saveBankReconciliationClosing(data: {
  bankAccountId: string
  competence: string
  statementClosingBalance: number
  statementClosingDate?: string
  crmCalculatedBalance: number
  differenceAmount: number
  status: 'conciliado' | 'divergente' | 'em_aberto'
  pendingLinesCount: number
  notes?: string
  userId?: string
}): Promise<BankReconciliation> {
  const payload = {
    bank_account: data.bankAccountId,
    competence: data.competence,
    statement_closing_balance: data.statementClosingBalance,
    statement_closing_date: data.statementClosingDate || null,
    crm_calculated_balance: data.crmCalculatedBalance,
    difference_amount: data.differenceAmount,
    status: data.status,
    pending_lines_count: data.pendingLinesCount,
    closed_at: new Date().toISOString(),
    closed_by: data.userId || pb.authStore.model?.id || '',
    notes: data.notes || '',
  }

  // Verifica se já existe fechamento para esta conta + competência
  try {
    const existing = await pb
      .collection('bank_reconciliations')
      .getFirstListItem(
        `bank_account = "${data.bankAccountId}" && competence = "${data.competence}"`,
      )
    return await pb
      .collection('bank_reconciliations')
      .update<BankReconciliation>(existing.id, payload)
  } catch {
    return await pb.collection('bank_reconciliations').create<BankReconciliation>(payload)
  }
}

export interface PluggyStatusResult {
  success: boolean
  has_credentials: boolean
  can_sync_now: boolean
  cooldown_remaining_seconds: number
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_message: string | null
  configured_account_id?: string | null
  configured_item_id?: string | null
  error?: string
}

export interface PluggySyncResult {
  success: boolean
  message: string
  imported_count: number
  duplicated_count: number
  error_count: number
  total_retrieved: number
  bank_account_id: string
  bank_account_name: string
  sync_at: string
  code?: string
}

/**
 * Consulta o status da integração Pluggy (credenciais, última sync, cooldown)
 */
export async function getPluggyStatus(): Promise<PluggyStatusResult> {
  try {
    return await pb.send<PluggyStatusResult>('/backend/v1/financial/pluggy/status', {
      method: 'GET',
    })
  } catch (err: any) {
    const data = err?.data || err?.response?.data || {}
    return {
      success: false,
      has_credentials: false,
      can_sync_now: false,
      cooldown_remaining_seconds: 0,
      last_sync_at: null,
      last_sync_status: 'error',
      last_sync_message:
        data?.message || data?.error || err.message || 'Falha ao consultar status da Pluggy',
      error: data?.message || data?.error || err.message,
    }
  }
}

/**
 * Dispara a sincronização do extrato via API Pluggy
 */
export async function syncPluggyStatement(params?: {
  bankAccountId?: string
  force?: boolean
}): Promise<PluggySyncResult> {
  try {
    return await pb.send<PluggySyncResult>('/backend/v1/financial/pluggy/sync', {
      method: 'POST',
      body: {
        bank_account_id: params?.bankAccountId,
        force: params?.force,
      },
    })
  } catch (err: any) {
    const data = err?.data || err?.response?.data || {}
    const msg =
      data?.message ||
      data?.error ||
      err.message ||
      'Erro desconhecido ao sincronizar com a Pluggy.'
    const code = data?.code || (err.status === 400 ? 'BAD_REQUEST' : 'ERROR')

    const errorObj = new Error(msg) as any
    errorObj.code = code
    errorObj.data = data
    throw errorObj
  }
}
