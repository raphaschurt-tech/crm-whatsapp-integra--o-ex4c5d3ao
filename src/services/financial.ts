import pb from '@/lib/pocketbase/client'
import {
  AccountsPayable,
  AccountsReceivable,
  FinancialCategory,
  FinancialRecurringTemplate,
  NfeProcessed,
  NfePriceQueueItem,
  NfeProductMapping,
  FinancialDashboardKpis,
  FinancialPaymentMethod,
} from '@/types/crm'

// Helper para fuso de Brasília (UTC-3)
export function getBrasiliaToday(): string {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const brMs = utcMs - 3 * 3600000
  const brDate = new Date(brMs)
  return brDate.toISOString().slice(0, 10)
}

export function getBrasiliaMonthKey(date = new Date()): string {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const brMs = utcMs - 3 * 3600000
  const brDate = new Date(brMs)
  const y = brDate.getUTCFullYear()
  const m = String(brDate.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Verifica se um lançamento está vencido:
 * Status pendente E due_date < hoje (calculado na leitura, sem depender de cron)
 */
export function isOverdue(dueDateStr: string, status: string): boolean {
  if (status !== 'pendente') return false
  if (!dueDateStr) return false
  const today = getBrasiliaToday()
  const dueDateYmd = dueDateStr.slice(0, 10)
  return dueDateYmd < today
}

/**
 * Verifica se vence nos próximos 7 dias (inclusive hoje até hoje + 7 dias)
 */
export function isDueNext7Days(dueDateStr: string, status: string): boolean {
  if (status !== 'pendente') return false
  if (!dueDateStr) return false
  const today = getBrasiliaToday()
  const dueDateYmd = dueDateStr.slice(0, 10)
  if (dueDateYmd < today) return false

  const todayDate = new Date(today + 'T00:00:00')
  const next7Date = new Date(todayDate)
  next7Date.setDate(next7Date.getDate() + 7)
  const maxLimit = next7Date.toISOString().slice(0, 10)

  return dueDateYmd <= maxLimit
}

// ==========================================
// CATEGORIAS FINANCEIRAS
// ==========================================

export async function getFinancialCategories(): Promise<FinancialCategory[]> {
  return pb.collection('financial_categories').getFullList<FinancialCategory>({
    sort: 'name',
  })
}

export async function createFinancialCategory(
  data: Partial<FinancialCategory>,
): Promise<FinancialCategory> {
  return pb.collection('financial_categories').create<FinancialCategory>(data)
}

export async function updateFinancialCategory(
  id: string,
  data: Partial<FinancialCategory>,
): Promise<FinancialCategory> {
  return pb.collection('financial_categories').update<FinancialCategory>(id, data)
}

export async function deleteFinancialCategory(id: string): Promise<boolean> {
  await pb.collection('financial_categories').delete(id)
  return true
}

// ==========================================
// CONTAS A PAGAR
// ==========================================

export interface GetAccountsPayableFilter {
  status?: string
  supplier?: string
  category?: string
  origin?: string
  competence?: string // YYYY-MM
  search?: string
  startDate?: string
  endDate?: string
}

export async function getAccountsPayable(
  filters?: GetAccountsPayableFilter,
): Promise<AccountsPayable[]> {
  const filterParts: string[] = []

  if (filters?.status && filters.status !== 'todos') {
    filterParts.push(`status = "${filters.status}"`)
  }
  if (filters?.supplier && filters.supplier !== 'todos') {
    filterParts.push(`supplier = "${filters.supplier}"`)
  }
  if (filters?.category && filters.category !== 'todos') {
    filterParts.push(`category = "${filters.category}"`)
  }
  if (filters?.origin && filters.origin !== 'todos') {
    filterParts.push(`origin = "${filters.origin}"`)
  }
  if (filters?.startDate) {
    filterParts.push(`due_date >= "${filters.startDate} 00:00:00"`)
  }
  if (filters?.endDate) {
    filterParts.push(`due_date <= "${filters.endDate} 23:59:59"`)
  }
  if (filters?.competence) {
    // Início e fim do mês
    const [y, m] = filters.competence.split('-')
    const lastDay = new Date(Number(y), Number(m), 0).getDate()
    filterParts.push(`due_date >= "${filters.competence}-01 00:00:00"`)
    filterParts.push(
      `due_date <= "${filters.competence}-${String(lastDay).padStart(2, '0')} 23:59:59"`,
    )
  }

  const filterStr = filterParts.length > 0 ? filterParts.join(' && ') : ''

  const records = await pb.collection('accounts_payable').getFullList<AccountsPayable>({
    filter: filterStr,
    sort: 'due_date,created',
    expand: 'category,supplier,nfe_record,recurring_template',
  })

  // Busca textual livre no front se informada
  if (filters?.search && filters.search.trim()) {
    const s = filters.search.toLowerCase()
    return records.filter(
      (r) =>
        r.description?.toLowerCase().includes(s) ||
        r.supplier_name?.toLowerCase().includes(s) ||
        r.nfe_access_key?.toLowerCase().includes(s) ||
        r.notes?.toLowerCase().includes(s),
    )
  }

  return records
}

export async function createAccountPayable(
  formData: FormData | Partial<AccountsPayable>,
): Promise<AccountsPayable> {
  return pb.collection('accounts_payable').create<AccountsPayable>(formData)
}

export async function updateAccountPayable(
  id: string,
  formData: FormData | Partial<AccountsPayable>,
): Promise<AccountsPayable> {
  return pb.collection('accounts_payable').update<AccountsPayable>(id, formData)
}

export async function markPayableAsPaid(
  id: string,
  paymentMethod: FinancialPaymentMethod,
  paidAtDate?: string,
): Promise<AccountsPayable> {
  const paidAt = paidAtDate ? `${paidAtDate.slice(0, 10)} 12:00:00.000Z` : new Date().toISOString()
  return pb.collection('accounts_payable').update<AccountsPayable>(id, {
    status: 'pago',
    payment_method: paymentMethod,
    paid_at: paidAt,
  })
}

export async function reopenPayable(id: string): Promise<AccountsPayable> {
  return pb.collection('accounts_payable').update<AccountsPayable>(id, {
    status: 'pendente',
    paid_at: null,
  })
}

export async function deleteAccountPayable(id: string): Promise<boolean> {
  await pb.collection('accounts_payable').delete(id)
  return true
}

// ==========================================
// CONTAS A RECEBER
// ==========================================

export interface GetAccountsReceivableFilter {
  status?: string
  customer?: string
  category?: string
  origin?: string
  competence?: string
  search?: string
  startDate?: string
  endDate?: string
}

export async function getAccountsReceivable(
  filters?: GetAccountsReceivableFilter,
): Promise<AccountsReceivable[]> {
  const filterParts: string[] = []

  if (filters?.status && filters.status !== 'todos') {
    filterParts.push(`status = "${filters.status}"`)
  }
  if (filters?.customer && filters.customer !== 'todos') {
    filterParts.push(`customer = "${filters.customer}"`)
  }
  if (filters?.category && filters.category !== 'todos') {
    filterParts.push(`category = "${filters.category}"`)
  }
  if (filters?.origin && filters.origin !== 'todos') {
    filterParts.push(`origin = "${filters.origin}"`)
  }
  if (filters?.startDate) {
    filterParts.push(`due_date >= "${filters.startDate} 00:00:00"`)
  }
  if (filters?.endDate) {
    filterParts.push(`due_date <= "${filters.endDate} 23:59:59"`)
  }
  if (filters?.competence) {
    const [y, m] = filters.competence.split('-')
    const lastDay = new Date(Number(y), Number(m), 0).getDate()
    filterParts.push(`due_date >= "${filters.competence}-01 00:00:00"`)
    filterParts.push(
      `due_date <= "${filters.competence}-${String(lastDay).padStart(2, '0')} 23:59:59"`,
    )
  }

  const filterStr = filterParts.length > 0 ? filterParts.join(' && ') : ''

  const records = await pb.collection('accounts_receivable').getFullList<AccountsReceivable>({
    filter: filterStr,
    sort: 'due_date,created',
    expand: 'category,customer,quote',
  })

  if (filters?.search && filters.search.trim()) {
    const s = filters.search.toLowerCase()
    return records.filter(
      (r) =>
        r.description?.toLowerCase().includes(s) ||
        r.customer_name?.toLowerCase().includes(s) ||
        r.notes?.toLowerCase().includes(s),
    )
  }

  return records
}

export async function createAccountReceivable(
  formData: FormData | Partial<AccountsReceivable>,
): Promise<AccountsReceivable> {
  return pb.collection('accounts_receivable').create<AccountsReceivable>(formData)
}

export async function updateAccountReceivable(
  id: string,
  formData: FormData | Partial<AccountsReceivable>,
): Promise<AccountsReceivable> {
  return pb.collection('accounts_receivable').update<AccountsReceivable>(id, formData)
}

export async function markReceivableAsPaid(
  id: string,
  paymentMethod: FinancialPaymentMethod,
  paidAtDate?: string,
): Promise<AccountsReceivable> {
  const paidAt = paidAtDate ? `${paidAtDate.slice(0, 10)} 12:00:00.000Z` : new Date().toISOString()
  return pb.collection('accounts_receivable').update<AccountsReceivable>(id, {
    status: 'pago',
    payment_method: paymentMethod,
    paid_at: paidAt,
  })
}

export async function reopenReceivable(id: string): Promise<AccountsReceivable> {
  return pb.collection('accounts_receivable').update<AccountsReceivable>(id, {
    status: 'pendente',
    paid_at: null,
  })
}

export async function deleteAccountReceivable(id: string): Promise<boolean> {
  await pb.collection('accounts_receivable').delete(id)
  return true
}

// ==========================================
// RECORRENTES (MODELOS E CRON)
// ==========================================

export async function getFinancialRecurringTemplates(): Promise<FinancialRecurringTemplate[]> {
  return pb.collection('financial_recurring_templates').getFullList<FinancialRecurringTemplate>({
    sort: 'due_day,description',
    expand: 'category,supplier',
  })
}

export async function createFinancialRecurringTemplate(
  data: Partial<FinancialRecurringTemplate>,
): Promise<FinancialRecurringTemplate> {
  return pb.collection('financial_recurring_templates').create<FinancialRecurringTemplate>(data)
}

export async function updateFinancialRecurringTemplate(
  id: string,
  data: Partial<FinancialRecurringTemplate>,
): Promise<FinancialRecurringTemplate> {
  return pb.collection('financial_recurring_templates').update<FinancialRecurringTemplate>(id, data)
}

export async function deleteFinancialRecurringTemplate(id: string): Promise<boolean> {
  await pb.collection('financial_recurring_templates').delete(id)
  return true
}

export async function runRecurringCronManual(competence?: string): Promise<{
  success: boolean
  competence: string
  generated: number
  existing: number
  errors: number
  message: string
}> {
  return pb.send('/backend/v1/financial/recurring/run', {
    method: 'POST',
    body: { competence },
  })
}

// ==========================================
// NF-E PROCESSADAS & FILA DE PREÇOS
// ==========================================

// ==========================================
// DASHBOARD RESUMO (KPIs do Mês Selecionado)
// Deriva APENAS da coleção financeira (padrão de carga leve)
// ==========================================

export async function getFinancialDashboardKpis(
  competence: string,
): Promise<FinancialDashboardKpis> {
  const [yearStr, monthStr] = competence.split('-')
  const y = Number(yearStr)
  const m = Number(monthStr)
  const lastDay = new Date(y, m, 0).getDate()

  const startMonthIso = `${competence}-01 00:00:00`
  const endMonthIso = `${competence}-${String(lastDay).padStart(2, '0')} 23:59:59`

  // Buscar contas a pagar e contas a receber
  const [monthPayables, allPendingPayables, monthReceivables] = await Promise.all([
    pb.collection('accounts_payable').getFullList<AccountsPayable>({
      filter: `due_date >= "${startMonthIso}" && due_date <= "${endMonthIso}"`,
    }),
    pb.collection('accounts_payable').getFullList<AccountsPayable>({
      filter: 'status = "pendente"',
    }),
    pb.collection('accounts_receivable').getFullList<AccountsReceivable>({
      filter: `due_date >= "${startMonthIso}" && due_date <= "${endMonthIso}"`,
    }),
  ])

  // A pagar pendente no mês selecionado
  const pendingPayablesAmount = monthPayables
    .filter((p) => p.status === 'pendente')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

  // Vencidos (destaque vermelho) - calculados na leitura sobre todos os pendentes
  const overduePayables = allPendingPayables.filter((p) => isOverdue(p.due_date, p.status))
  const overduePayablesAmount = overduePayables.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const overduePayablesCount = overduePayables.length

  // A vencer nos próximos 7 dias
  const dueNext7Days = allPendingPayables.filter((p) => isDueNext7Days(p.due_date, p.status))
  const dueNext7DaysAmount = dueNext7Days.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const dueNext7DaysCount = dueNext7Days.length

  // A receber pendente no mês selecionado
  const pendingReceivablesAmount = monthReceivables
    .filter((r) => r.status === 'pendente')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)

  // Saídas do mês (pagos com vencimento ou paid_at no mês)
  const monthOutflows = monthPayables
    .filter((p) => p.status === 'pago')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

  // Entradas do mês (recebidos com vencimento ou paid_at no mês)
  const monthInflows = monthReceivables
    .filter((r) => r.status === 'pago')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)

  // Saldo do mês: entradas − saídas
  const monthBalance = monthInflows - monthOutflows

  return {
    pendingPayablesAmount,
    overduePayablesAmount,
    overduePayablesCount,
    dueNext7DaysAmount,
    dueNext7DaysCount,
    pendingReceivablesAmount,
    monthInflows,
    monthOutflows,
    monthBalance,
  }
}

// ==========================================
// SERVIÇOS DO PIPELINE NF-E (PROMPT 2)
// ==========================================

export async function uploadNfeXml(xmlContent: string): Promise<{
  success: boolean
  message?: string
  error?: string
  access_key?: string
  status?: string
  duplicate?: boolean
  exception?: boolean
  reason?: string
}> {
  return pb.send('/backend/v1/nfe/upload', {
    method: 'POST',
    body: { xml: xmlContent },
  })
}

export async function reconcileMatchItem(
  queueItemId: string,
  productId: string,
): Promise<{
  success: boolean
  message?: string
  error?: string
  sku?: string
  suggested_price?: number
}> {
  return pb.send('/backend/v1/nfe/reconcile-match', {
    method: 'POST',
    body: {
      queue_item_id: queueItemId,
      product_id: productId,
    },
  })
}

export async function applyQueuePrice(
  queueItemId: string,
  price?: number,
): Promise<{ success: boolean; message?: string; error?: string; sku?: string; price?: number }> {
  return pb.send('/backend/v1/nfe/apply-price', {
    method: 'POST',
    body: {
      queue_item_id: queueItemId,
      price: price,
    },
  })
}

export async function markSouisStockLaunched(
  nfeId: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  return pb.send('/backend/v1/nfe/mark-souis-stock-launched', {
    method: 'POST',
    body: { nfe_id: nfeId },
  })
}

export async function getNfeProcessedList(): Promise<NfeProcessed[]> {
  try {
    return await pb.collection('nfe_processed').getFullList<NfeProcessed>({
      sort: '-created',
      expand: 'supplier,souis_stock_launched_by',
    })
  } catch (_) {
    return []
  }
}

export async function getNfePriceQueue(status?: string): Promise<NfePriceQueueItem[]> {
  try {
    const filter = status ? `status = "${status}"` : ''
    return await pb.collection('nfe_price_queue').getFullList<NfePriceQueueItem>({
      filter,
      sort: '-created',
      expand: 'nfe,product,resolved_by',
    })
  } catch (_) {
    return []
  }
}

export async function getNfeProductMappings(): Promise<NfeProductMapping[]> {
  try {
    return await pb.collection('nfe_product_mappings').getFullList<NfeProductMapping>({
      sort: '-created',
      expand: 'product,confirmed_by',
    })
  } catch (_) {
    return []
  }
}

export async function deleteNfeProductMapping(id: string): Promise<boolean> {
  await pb.collection('nfe_product_mappings').delete(id)
  return true
}
