import pb from '@/lib/pocketbase/client'
import {
  BankAccount,
  BankAccountWithBalance,
  BankAccountType,
  AccountsPayable,
  AccountsReceivable,
} from '@/types/crm'

/**
 * Lista dos principais bancos brasileiros (Febraban)
 */
export const FEBRABAN_BANKS = [
  { code: '001', name: 'Banco do Brasil S.A.' },
  { code: '237', name: 'Banco Bradesco S.A.' },
  { code: '341', name: 'Itaú Unibanco S.A.' },
  { code: '104', name: 'Caixa Econômica Federal' },
  { code: '033', name: 'Banco Santander (Brasil) S.A.' },
  { code: '260', name: 'Nu Pagamentos S.A. (Nubank)' },
  { code: '077', name: 'Banco Inter S.A.' },
  { code: '212', name: 'Banco Original S.A.' },
  { code: '336', name: 'Banco C6 S.A.' },
  { code: '290', name: 'PagBank (PagSeguro)' },
  { code: '380', name: 'PicPay Serviços S.A.' },
  { code: '748', name: 'Sicredi' },
  { code: '756', name: 'Sicoob' },
  { code: '422', name: 'Banco Safra S.A.' },
  { code: '041', name: 'Banrisul' },
  { code: '000', name: 'Caixa Físico / Cofre Interno' },
  { code: '999', name: 'Outro Banco / Instituição' },
] as const

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  corrente: 'Conta Corrente',
  poupanca: 'Conta Poupança',
  investimento: 'Investimento / Aplicação',
  caixa: 'Caixa Físico / Espécie',
}

/**
 * Normaliza campos numéricos/alfanuméricos para comparação antiduplicidade
 */
export function normalizeBankField(val?: string | null): string {
  if (!val) return ''
  return val
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Converte valor monetário em centavos inteiros para evitar imprecisões de float
 */
export function toCents(amount: number | null | undefined): number {
  if (!amount || isNaN(amount)) return 0
  return Math.round(Number(amount) * 100)
}

/**
 * Converte centavos inteiros de volta para decimal
 */
export function fromCents(cents: number): number {
  return cents / 100
}

/**
 * Busca todas as contas bancárias (ativas ou inativas)
 */
export async function getBankAccounts(options?: { onlyActive?: boolean }): Promise<BankAccount[]> {
  const filter = options?.onlyActive ? 'is_active = true' : ''
  return pb.collection('bank_accounts').getFullList<BankAccount>({
    filter,
    sort: '-is_active,nickname',
    expand: 'customer_entity',
  })
}

/**
 * Busca apenas as contas bancárias ativas
 */
export async function getActiveBankAccounts(): Promise<BankAccount[]> {
  return getBankAccounts({ onlyActive: true })
}

/**
 * Cria uma nova conta bancária
 */
export async function createBankAccount(data: Partial<BankAccount>): Promise<BankAccount> {
  return pb.collection('bank_accounts').create<BankAccount>(data)
}

/**
 * Atualiza uma conta bancária
 */
export async function updateBankAccount(
  id: string,
  data: Partial<BankAccount>,
): Promise<BankAccount> {
  return pb.collection('bank_accounts').update<BankAccount>(id, data)
}

/**
 * Desativa (ou reativa) uma conta bancária. Nunca exclui para preservar integridade histórica.
 */
export async function toggleBankAccountActive(id: string, isActive: boolean): Promise<BankAccount> {
  return pb.collection('bank_accounts').update<BankAccount>(id, { is_active: isActive })
}

/**
 * Verifica se já existe uma conta com a mesma combinação (banco + agência + conta + tipo)
 * Retorna a conta duplicada encontrada se houver (para aviso não-bloqueante na UI).
 */
export async function checkDuplicateBankAccount(params: {
  bank_code: string
  agency: string
  account_number: string
  account_type: BankAccountType
  excludeId?: string
}): Promise<BankAccount | null> {
  const all = await getBankAccounts()
  const targetCode = normalizeBankField(params.bank_code)
  const targetAgency = normalizeBankField(params.agency)
  const targetNumber = normalizeBankField(params.account_number)
  const targetType = params.account_type

  for (const acc of all) {
    if (params.excludeId && acc.id === params.excludeId) continue
    if (
      normalizeBankField(acc.bank_code) === targetCode &&
      normalizeBankField(acc.agency) === targetAgency &&
      normalizeBankField(acc.account_number) === targetNumber &&
      acc.account_type === targetType
    ) {
      return acc
    }
  }
  return null
}

/**
 * Calcula o saldo atual de cada conta bancária.
 * REGRA ACORDADA: O saldo conta APENAS lançamentos EFETIVAMENTE LIQUIDADOS (status = 'pago').
 * Lançamentos 'pendente' ou 'cancelado' NÃO entram no saldo atual.
 * Valores somados em centavos (decimal explícito).
 */
export async function getBankAccountsWithBalance(): Promise<BankAccountWithBalance[]> {
  const [accounts, settledPayables, settledReceivables] = await Promise.all([
    getBankAccounts(),
    pb.collection('accounts_payable').getFullList<AccountsPayable>({
      filter: 'status = "pago" && bank_account_id != ""',
    }),
    pb.collection('accounts_receivable').getFullList<AccountsReceivable>({
      filter: 'status = "pago" && bank_account_id != ""',
    }),
  ])

  // Mapas por conta em centavos
  const paidCentsByAccount = new Map<string, { totalCents: number; count: number }>()
  for (const ap of settledPayables) {
    if (!ap.bank_account_id) continue
    const curr = paidCentsByAccount.get(ap.bank_account_id) || { totalCents: 0, count: 0 }
    curr.totalCents += toCents(ap.amount)
    curr.count += 1
    paidCentsByAccount.set(ap.bank_account_id, curr)
  }

  const receivedCentsByAccount = new Map<string, { totalCents: number; count: number }>()
  for (const ar of settledReceivables) {
    if (!ar.bank_account_id) continue
    const curr = receivedCentsByAccount.get(ar.bank_account_id) || { totalCents: 0, count: 0 }
    curr.totalCents += toCents(ar.amount)
    curr.count += 1
    receivedCentsByAccount.set(ar.bank_account_id, curr)
  }

  return accounts.map((acc) => {
    const initialCents = toCents(acc.initial_balance || 0)
    const paidInfo = paidCentsByAccount.get(acc.id) || { totalCents: 0, count: 0 }
    const receivedInfo = receivedCentsByAccount.get(acc.id) || { totalCents: 0, count: 0 }

    const currentCents = initialCents + receivedInfo.totalCents - paidInfo.totalCents

    return {
      ...acc,
      current_balance: fromCents(currentCents),
      total_paid: fromCents(paidInfo.totalCents),
      total_received: fromCents(receivedInfo.totalCents),
      settled_entries_count: paidInfo.count + receivedInfo.count,
    }
  })
}
