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
  stageEnteredTimestamp: number
  activeQuote: Quote | null
  allQuotes: Quote[]
  totalQuoteAmount: number
  whatsappConversation: WhatsAppCustomer | null
  activePurchaseCount?: number
  firstActivePurchaseId?: string
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

  // 5. Novo lead por padrão (caso pipeline_status seja novo_lead)
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
  const [customers, quotes, whatsappConversations, purchaseRequests] = await Promise.all([
    withRetry(() => getCustomers(), { retries: 3, delayMs: 800 }).catch(() => [] as Customer[]),
    withRetry(() => getQuotes(), { retries: 3, delayMs: 800 }).catch(() => [] as Quote[]),
    withRetry(() => loadWhatsAppConversations(), { retries: 3, delayMs: 800 }).catch(
      () => [] as WhatsAppCustomer[],
    ),
    withRetry(
      () => pb.collection('purchase_requests').getFullList({ filter: 'status != "entregue"' }),
      {
        retries: 2,
        delayMs: 500,
      },
    ).catch(() => [] as any[]),
  ])

  // Mapear solicitações de compras ativas (em andamento) por cliente
  const activePurchasesByCustomer = new Map<string, any[]>()
  for (const pr of purchaseRequests) {
    if (!pr.customer) continue
    const list = activePurchasesByCustomer.get(pr.customer) || []
    list.push(pr)
    activePurchasesByCustomer.set(pr.customer, list)
  }

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

  // Regra: Contatos importados criados sem pipeline_status não entram no Pipeline.
  // Somente clientes com pipeline_status preenchido (ou com orçamentos/interações reais) devem aparecer no Pipeline.
  // E clientes com deleted=true nunca aparecem no Pipeline.
  const activeCustomers = customers.filter((c) => {
    if (c.deleted) return false
    const rawStatus = (c.pipeline_status || '').trim()
    const hasQuotes = (quotesByCustomer.get(c.id) || []).length > 0
    const cleanPhone = normalizeDigits(c.phone)
    const hasMessages = Boolean(
      (convByCustomerId.get(c.id)?.messages.length || 0) > 0 ||
      (convByPhone.get(cleanPhone)?.messages.length || 0) > 0,
    )
    // Se o cliente não tem pipeline_status e também não tem interação/orçamento (ex: acabou de ser importado), fica fora do funil
    if (!rawStatus && !hasQuotes && !hasMessages) {
      return false
    }
    return true
  })

  const cards: PipelineCardData[] = activeCustomers.map((customer) => {
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

    // Determinar timestamp de entrada na etapa atual:
    // Se o cliente tem status manual salvo no backend (override), customer.updated reflete quando o status foi modificado/movido.
    // Se o status foi derivado automaticamente por eventos de vendas/atendimento:
    // - Para fechado: data em que o orçamento pago foi aprovado/pago (updated do quote pago)
    // - Para aguardando_pagamento: data em que o link foi gerado ou quote aprovado
    // - Para orcamento_enviado: data do envio do orçamento (created ou updated do quote enviado)
    // - Para em_atendimento: timestamp da primeira interação ou orçamento que causou a transição para em_atendimento
    // - Para novo_lead ou fornecedores: data de cadastro/criação do cliente
    let stageEnteredTimestamp = new Date(customer.updated || customer.created).getTime()
    if (!isManualOverride) {
      if (columnId === 'fechado') {
        const paidQuote = custQuotes.find((q) => q.status === 'pago')
        if (paidQuote) {
          stageEnteredTimestamp = new Date(paidQuote.updated || paidQuote.created).getTime()
        }
      } else if (columnId === 'aguardando_pagamento') {
        const awaitingQuote = custQuotes.find(
          (q) =>
            q.status === 'aprovado' ||
            ((q.status === 'enviado' || (q.status as string) === 'aprovado') &&
              Boolean(q.payment_link?.trim())),
        )
        if (awaitingQuote) {
          stageEnteredTimestamp = new Date(awaitingQuote.updated || awaitingQuote.created).getTime()
        }
      } else if (columnId === 'orcamento_enviado') {
        const sentQuote = custQuotes.find((q) => q.status === 'enviado')
        if (sentQuote) {
          stageEnteredTimestamp = new Date(sentQuote.updated || sentQuote.created).getTime()
        }
      } else if (columnId === 'em_atendimento') {
        // Momento em que entrou em atendimento: primeira mensagem do WhatsApp ou primeiro orçamento
        let firstInteraction = new Date(customer.created).getTime()
        if (whatsappConv && whatsappConv.messages.length > 0) {
          const firstMsg = whatsappConv.messages[0]
          if (firstMsg?.timestamp) {
            firstInteraction = firstMsg.timestamp
          }
        }
        if (custQuotes.length > 0) {
          const earliestQuote = custQuotes[custQuotes.length - 1]
          const quoteTime = new Date(earliestQuote.created).getTime()
          if (quoteTime > 0 && quoteTime < firstInteraction) {
            firstInteraction = quoteTime
          }
        }
        stageEnteredTimestamp = firstInteraction
      } else if (columnId === 'novo_lead' || columnId === 'fornecedores') {
        stageEnteredTimestamp = new Date(customer.created).getTime()
      }
    }

    const custPurchases = activePurchasesByCustomer.get(customer.id) || []

    return {
      customer,
      columnId,
      isManualOverride,
      lastInteractionText,
      lastInteractionDate,
      lastInteractionTimestamp,
      stageEnteredTimestamp,
      activeQuote,
      allQuotes: custQuotes,
      totalQuoteAmount,
      whatsappConversation: whatsappConv,
      activePurchaseCount: custPurchases.length,
      firstActivePurchaseId: custPurchases[0]?.id,
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
  lostReasonData?: {
    lost_reason?: string
    lost_reason_detail?: string
  },
): Promise<Customer> {
  const payload: Partial<Customer> = {
    pipeline_status: targetColumn,
  }

  if (targetColumn === 'perdido') {
    if (lostReasonData?.lost_reason) {
      payload.lost_reason = lostReasonData.lost_reason
      payload.lost_reason_detail = lostReasonData.lost_reason_detail || ''
    }
  } else {
    // Ao mover para qualquer outra coluna diferente de Perdido, limpa lost_reason e lost_reason_detail
    payload.lost_reason = ''
    payload.lost_reason_detail = ''
  }

  return updateCustomer(customerId, payload)
}
