import pb from '@/lib/pocketbase/client'
import { Customer, Quote, User } from '@/types/crm'
import { getCustomers, updateCustomer } from '@/services/customers'
import { getQuotes } from '@/services/quotes'
import { withRetry } from '@/lib/retry'
import {
  loadWhatsAppConversations,
  WhatsAppCustomer,
  WhatsAppMessage,
  formatActivityTime,
  formatPhoneDisplay,
} from '@/services/whatsappChat'

export type PipelineColumnId =
  | 'fornecedores'
  | 'novo_lead'
  | 'em_atendimento'
  | 'orcamento_enviado'
  | 'aguardando_pagamento'
  | 'fechado'
  | 'perdido'

export interface PipelineColumnDef {
  id: PipelineColumnId
  label: string
  color: string
  badgeBg: string
  borderColor: string
}

export const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  {
    id: 'fornecedores',
    label: 'Fornecedores',
    color: 'text-amber-700',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    borderColor: 'border-t-amber-500',
  },
  {
    id: 'novo_lead',
    label: 'Novo Lead',
    color: 'text-sky-700',
    badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
    borderColor: 'border-t-sky-500',
  },
  {
    id: 'em_atendimento',
    label: 'Em Atendimento',
    color: 'text-amber-700',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    borderColor: 'border-t-amber-500',
  },
  {
    id: 'orcamento_enviado',
    label: 'Orçamento Enviado',
    color: 'text-indigo-700',
    badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    borderColor: 'border-t-indigo-500',
  },
  {
    id: 'aguardando_pagamento',
    label: 'Aguardando Pagamento',
    color: 'text-purple-700',
    badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
    borderColor: 'border-t-purple-500',
  },
  {
    id: 'fechado',
    label: 'Fechado',
    color: 'text-emerald-700',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    borderColor: 'border-t-emerald-500',
  },
  {
    id: 'perdido',
    label: 'Perdido',
    color: 'text-rose-700',
    badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
    borderColor: 'border-t-rose-500',
  },
]

export interface PipelineCardData {
  customer: Customer
  columnId: PipelineColumnId
  isManualOverride: boolean
  lastInteractionText: string
  lastInteractionDate: Date | null
  lastInteractionTimestamp: number
  activeQuote: Quote | null
  allQuotes: Quote[]
  totalQuoteAmount: number
  whatsappConversation: WhatsAppCustomer | null
}

/**
 * Normaliza número de telefone para busca e mapeamento
 */
function normalizeDigits(phone?: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Calcula a coluna automática com base nos quotes e interações do WhatsApp
 */
export function deriveAutoStatus(
  customer: Customer,
  customerQuotes: Quote[],
  whatsappConv: WhatsAppCustomer | null,
): PipelineColumnId {
  // 0. Se for fornecedor, fica na coluna de fornecedores e nunca participa das transições automáticas de lead
  if (customer.customer_type === 'fornecedor') {
    return 'fornecedores'
  }

  // 1. Se tem orçamento pago -> "fechado"
  const hasPaidQuote = customerQuotes.some((q) => q.status === 'pago')
  if (hasPaidQuote) {
    return 'fechado'
  }

  // 2. Se tem link gerado ou aprovado aguardando pagamento
  // status 'aprovado' ou tem payment_link ou token ativo em orçamento enviado/aprovado
  const hasAwaitingPayment = customerQuotes.some(
    (q) =>
      q.status === 'aprovado' ||
      ((q.status === 'enviado' || (q.status as string) === 'aprovado') &&
        Boolean(q.payment_link?.trim())),
  )
  if (hasAwaitingPayment) {
    return 'aguardando_pagamento'
  }

  // 3. Se tem orçamento enviado
  const hasSentQuote = customerQuotes.some((q) => q.status === 'enviado')
  if (hasSentQuote) {
    return 'orcamento_enviado'
  }

  // Se tem apenas rascunho de orçamento, também pode ser considerado em atendimento
  const hasAnyQuote = customerQuotes.length > 0

  // 4. Se tem interação de WhatsApp (atendente respondeu, IA interagiu ou mensagem recebida)
  const hasInteraction = (whatsappConv && whatsappConv.messages.length > 0) || hasAnyQuote

  if (hasInteraction) {
    return 'em_atendimento'
  }

  // 5. Novo lead por padrão
  return 'novo_lead'
}

/**
 * Carrega e monta o pipeline completo cruzando Customers + Quotes + WhatsApp + Users
 */
export async function loadPipelineBoardData(): Promise<{
  cards: PipelineCardData[]
  customers: Customer[]
  quotes: Quote[]
  whatsappConversations: WhatsAppCustomer[]
}> {
  const [customers, quotes, whatsappConversations] = await Promise.all([
    withRetry(() => getCustomers(), { retries: 3, delayMs: 800 }).catch(() => [] as Customer[]),
    withRetry(() => getQuotes(), { retries: 3, delayMs: 800 }).catch(() => [] as Quote[]),
    withRetry(() => loadWhatsAppConversations(), { retries: 3, delayMs: 800 }).catch(
      () => [] as WhatsAppCustomer[],
    ),
  ])

  // Mapear conversas de WhatsApp por customerId ou por telefone normalizado
  const convByCustomerId = new Map<string, WhatsAppCustomer>()
  const convByPhone = new Map<string, WhatsAppCustomer>()

  for (const conv of whatsappConversations) {
    if (conv.customerId) {
      convByCustomerId.set(conv.customerId, conv)
    }
    const cleanP = normalizeDigits(conv.rawPhone)
    if (cleanP) {
      convByPhone.set(cleanP, conv)
      if (cleanP.startsWith('55')) {
        convByPhone.set(cleanP.slice(2), conv)
      } else {
        convByPhone.set(`55${cleanP}`, conv)
      }
    }
  }

  // Agrupar orçamentos por customerId
  const quotesByCustomer = new Map<string, Quote[]>()
  for (const q of quotes) {
    if (!q.customer) continue
    const list = quotesByCustomer.get(q.customer) || []
    list.push(q)
    quotesByCustomer.set(q.customer, list)
  }

  const cards: PipelineCardData[] = customers.map((customer) => {
    const custQuotes = quotesByCustomer.get(customer.id) || []
    // Ordenar orçamentos do cliente por data mais recente
    custQuotes.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())

    // Encontrar conversa do WhatsApp
    const cleanCustPhone = normalizeDigits(customer.phone)
    const whatsappConv =
      convByCustomerId.get(customer.id) ||
      convByPhone.get(cleanCustPhone) ||
      (cleanCustPhone.startsWith('55')
        ? convByPhone.get(cleanCustPhone.slice(2))
        : convByPhone.get(`55${cleanCustPhone}`)) ||
      null

    // Determinar última interação (data e timestamp)
    let lastInteractionTimestamp = new Date(customer.created).getTime()
    let lastInteractionDate: Date = new Date(customer.created)
    let lastInteractionText = formatActivityTime(customer.created)

    // Se houver mensagem mais recente no WhatsApp
    if (whatsappConv && whatsappConv.lastTimestamp > lastInteractionTimestamp) {
      lastInteractionTimestamp = whatsappConv.lastTimestamp
      lastInteractionDate = new Date(whatsappConv.lastTimestamp)
      lastInteractionText = formatActivityTime(lastInteractionDate)
    }

    // Se houver orçamento mais recente
    if (custQuotes.length > 0) {
      const latestQuoteTime = new Date(custQuotes[0].created).getTime()
      if (latestQuoteTime > lastInteractionTimestamp) {
        lastInteractionTimestamp = latestQuoteTime
        lastInteractionDate = new Date(latestQuoteTime)
        lastInteractionText = formatActivityTime(lastInteractionDate)
      }
    }

    // Orçamento em destaque (o mais recente ou com maior valor ativo)
    const activeQuote = custQuotes[0] || null
    const totalQuoteAmount = custQuotes.reduce((acc, q) => acc + (q.total || 0), 0)

    // Determinar coluna
    const isSupplier = customer.customer_type === 'fornecedor'
    const rawManualStatus = (customer.pipeline_status || '').trim()
    const isValidManual = PIPELINE_COLUMNS.some((col) => col.id === rawManualStatus)
    const isManualOverride = isValidManual && rawManualStatus.length > 0
    let columnId: PipelineColumnId = isManualOverride
      ? (rawManualStatus as PipelineColumnId)
      : deriveAutoStatus(customer, custQuotes, whatsappConv)

    // Fornecedores nunca devem cair em etapas de vendas automáticas.
    // Se não tiver override manual, ou se tiver override inválido, fica em 'fornecedores'.
    if (isSupplier && !isManualOverride) {
      columnId = 'fornecedores'
    }

    return {
      customer,
      columnId,
      isManualOverride,
      lastInteractionText,
      lastInteractionDate,
      lastInteractionTimestamp,
      activeQuote,
      allQuotes: custQuotes,
      totalQuoteAmount,
      whatsappConversation: whatsappConv,
    }
  })

  return {
    cards,
    customers,
    quotes,
    whatsappConversations,
  }
}

/**
 * Atualiza o status do pipeline do cliente no PocketBase.
 * Se targetColumn for vazio ou 'auto', remove o override e volta ao cálculo automático.
 */
export async function updateCustomerPipelineStatus(
  customerId: string,
  targetColumn: PipelineColumnId | '',
): Promise<Customer> {
  return updateCustomer(customerId, {
    pipeline_status: targetColumn,
  })
}
