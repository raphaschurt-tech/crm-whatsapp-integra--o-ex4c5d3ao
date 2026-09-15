import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { PurchaseItem, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'

/**
 * Normaliza os itens de uma solicitação de compra para garantir retrocompatibilidade.
 * Se items estiver preenchido e não-vazio, usa items.
 * Caso contrário, cria 1 item a partir de part_name, vehicle e quantidade 1.
 */
export const normalizePurchaseItems = (
  request?: Partial<PurchaseRequest> | null,
): PurchaseItem[] => {
  if (!request) return []
  const legacySupplier = request.supplier || ''
  const legacyCost = typeof request.cost_price === 'number' ? request.cost_price : undefined
  const legacySell = typeof request.sell_price === 'number' ? request.sell_price : undefined

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.map((item, index) => {
      const qty = Math.max(1, Number(item.quantity) || 1)
      const supplierId = item.supplier_id || (legacySupplier ? legacySupplier : undefined)
      // Se for o 1º item e ele não tiver custo/venda explícito, mas a compra tiver os valores legados, herda
      const cost =
        typeof item.cost_price === 'number'
          ? item.cost_price
          : index === 0 && legacyCost !== undefined
            ? legacyCost
            : undefined
      const sell =
        typeof item.sell_price === 'number'
          ? item.sell_price
          : index === 0 && legacySell !== undefined
            ? legacySell
            : undefined

      return {
        part_name: item.part_name || '',
        vehicle: item.vehicle || '',
        quantity: qty,
        supplier_id: supplierId,
        supplier_name: item.supplier_name,
        cost_price: cost,
        sell_price: sell,
      }
    })
  }

  if (request.part_name || request.vehicle) {
    return [
      {
        part_name: request.part_name || '',
        vehicle: request.vehicle || '',
        quantity: 1,
        supplier_id: legacySupplier || undefined,
        cost_price: legacyCost,
        sell_price: legacySell,
      },
    ]
  }
  return []
}

/**
 * Retorna a contagem total de unidades (soma de quantidades de todos os itens)
 */
export const getTotalItemQuantity = (request?: Partial<PurchaseRequest> | null): number => {
  const items = normalizePurchaseItems(request)
  return items.reduce((acc, it) => acc + (it.quantity || 1), 0)
}

/**
 * Calcula margem de um item específico: (venda × quantidade) − (custo × quantidade)
 * Retorna null se não houver venda ou custo válidos preenchidos
 */
export const getItemMargin = (item: PurchaseItem): number | null => {
  const qty = Math.max(1, Number(item.quantity) || 1)
  const hasSell = typeof item.sell_price === 'number' && !isNaN(item.sell_price)
  const hasCost = typeof item.cost_price === 'number' && !isNaN(item.cost_price)

  if (!hasSell && !hasCost) return null
  const sellTotal = (hasSell ? item.sell_price || 0 : 0) * qty
  const costTotal = (hasCost ? item.cost_price || 0 : 0) * qty
  return sellTotal - costTotal
}

/**
 * Calcula a margem percentual de um item a partir do custo e da venda:
 * margem% = ((venda - custo) / custo) * 100
 * Retorna null se custo for vazio, zero ou menor ou se não houver venda.
 */
export const calculateMarginPercent = (
  cost?: number | null,
  sell?: number | null,
): number | null => {
  if (cost === undefined || cost === null || isNaN(cost) || cost <= 0) return null
  if (sell === undefined || sell === null || isNaN(sell)) return null
  const margin = ((sell - cost) / cost) * 100
  return isFinite(margin) ? margin : null
}

/**
 * Calcula o preço de venda a partir do custo e da margem percentual:
 * venda = custo * (1 + margem%/100), arredondado para 2 casas decimais.
 * Retorna null se custo for vazio, zero ou menor, ou se margem% não for número válido.
 */
export const calculateSellPriceFromMargin = (
  cost?: number | null,
  marginPercent?: number | null,
): number | null => {
  if (cost === undefined || cost === null || isNaN(cost) || cost <= 0) return null
  if (marginPercent === undefined || marginPercent === null || isNaN(marginPercent)) return null
  const rawSell = cost * (1 + marginPercent / 100)
  return Math.round((rawSell + Number.EPSILON) * 100) / 100
}

/**
 * Calcula os totais de uma compra inteira somando todos os seus itens
 */
export const getPurchaseTotals = (
  request?: Partial<PurchaseRequest> | null,
): {
  totalCost: number
  totalSell: number
  totalMargin: number
  hasAnyPricing: boolean
  hasBothPricing: boolean
} => {
  const items = normalizePurchaseItems(request)
  let totalCost = 0
  let totalSell = 0
  let hasAnyCost = false
  let hasAnySell = false

  for (const it of items) {
    const qty = Math.max(1, Number(it.quantity) || 1)
    if (typeof it.cost_price === 'number' && !isNaN(it.cost_price)) {
      totalCost += it.cost_price * qty
      hasAnyCost = true
    }
    if (typeof it.sell_price === 'number' && !isNaN(it.sell_price)) {
      totalSell += it.sell_price * qty
      hasAnySell = true
    }
  }

  const hasAnyPricing = hasAnyCost || hasAnySell
  const hasBothPricing = hasAnyCost && hasAnySell
  const totalMargin = totalSell - totalCost

  return {
    totalCost,
    totalSell,
    totalMargin,
    hasAnyPricing,
    hasBothPricing,
  }
}

/**
 * Formata um resumo compacto dos itens para exibição nos cards, incluindo quantidade e fornecedor se houver.
 * Exemplo: '2× bucha da bandeja (Kicks 2016) — Fornecedor A, 1× coxim do motor (Onix 2020) — Fornecedor B'
 */
export const formatPurchaseItemsSummary = (
  request?: Partial<PurchaseRequest> | null,
  supplierMap?: Record<string, string>,
): string => {
  const items = normalizePurchaseItems(request)
  if (items.length === 0) {
    return request?.part_name || 'Sem itens'
  }

  return items
    .map((item) => {
      const qtyStr = `${item.quantity || 1}×`
      const vehStr = item.vehicle ? ` (${item.vehicle})` : ''
      let supName = item.supplier_name
      if (!supName && item.supplier_id && supplierMap) {
        supName = supplierMap[item.supplier_id]
      }
      const supStr = supName ? ` — ${supName}` : ''

      let marginStr = ''
      if (
        typeof item.cost_price === 'number' &&
        item.cost_price > 0 &&
        typeof item.sell_price === 'number' &&
        !isNaN(item.sell_price)
      ) {
        const marginPct = calculateMarginPercent(item.cost_price, item.sell_price)
        if (marginPct !== null) {
          const formattedPct = marginPct % 1 === 0 ? marginPct.toFixed(0) : marginPct.toFixed(1)
          marginStr = ` (margem ${formattedPct}%)`
        }
      }

      return `${qtyStr} ${item.part_name}${vehStr}${supStr}${marginStr}`
    })
    .join(', ')
}

export interface PurchaseColumnDef {
  id: PurchaseRequestStatus
  label: string
  color: string
  badgeBg: string
  borderColor: string
  description: string
}

export const PURCHASE_COLUMNS: PurchaseColumnDef[] = [
  {
    id: 'solicitada',
    label: 'Solicitada',
    color: 'text-sky-700',
    badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
    borderColor: 'border-t-sky-500',
    description: 'Cliente pediu a peça, atendente criou a solicitação',
  },
  {
    id: 'cotacao',
    label: 'Cotação',
    color: 'text-amber-700',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    borderColor: 'border-t-amber-500',
    description: 'Buscando preço com distribuidoras/fabricantes',
  },
  {
    id: 'aprovada',
    label: 'Aprovada',
    color: 'text-indigo-700',
    badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    borderColor: 'border-t-indigo-500',
    description: 'Preço definido, compra autorizada',
  },
  {
    id: 'pedido_emitido',
    label: 'Pedido emitido',
    color: 'text-purple-700',
    badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
    borderColor: 'border-t-purple-500',
    description: 'Compra feita com o fornecedor',
  },
  {
    id: 'em_transito',
    label: 'Em trânsito',
    color: 'text-blue-700',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    borderColor: 'border-t-blue-500',
    description: 'Fornecedor despachou, aguardando chegada',
  },
  {
    id: 'recebida',
    label: 'Recebida',
    color: 'text-teal-700',
    badgeBg: 'bg-teal-50 text-teal-700 border-teal-200',
    borderColor: 'border-t-teal-500',
    description: 'Peça chegou na RPA',
  },
  {
    id: 'entregue',
    label: 'Entregue',
    color: 'text-emerald-700',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    borderColor: 'border-t-emerald-500',
    description: 'Peça entregue ao cliente ou em estoque',
  },
]

export const getPurchaseRequests = async (): Promise<PurchaseRequest[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<PurchaseRequest>('purchase_requests').getFullList({
          sort: '-created',
          expand: 'customer,supplier,created_by,quote',
        }),
      { retries: 3, delayMs: 800 },
    )
  } catch (error) {
    console.warn('Erro ao carregar solicitações de compra:', error)
    return []
  }
}

export const getPurchaseRequest = (id: string) =>
  pb.collection<PurchaseRequest>('purchase_requests').getOne(id, {
    expand: 'customer,supplier,created_by,quote',
  })

export const createPurchaseRequest = async (
  data: Partial<PurchaseRequest>,
): Promise<PurchaseRequest> => {
  // Se houver items, mantém retrocompatibilidade de part_name e vehicle no registro mestre com o 1º item ou resumo
  const items = data.items && data.items.length > 0 ? data.items : undefined
  const firstItem = items?.[0]
  const partName = data.part_name || firstItem?.part_name || ''
  const vehicle = data.vehicle || firstItem?.vehicle || ''

  const payload = {
    ...data,
    part_name: partName,
    vehicle: vehicle,
    items: items,
    os_number: data.os_number?.trim() || '',
    status: data.status || 'solicitada',
    created_by: pb.authStore.record?.id || data.created_by,
  }
  return await pb.collection<PurchaseRequest>('purchase_requests').create(payload, {
    expand: 'customer,supplier,created_by,quote',
  })
}

export const updatePurchaseRequest = async (
  id: string,
  data: Partial<PurchaseRequest>,
): Promise<PurchaseRequest> => {
  const payload: Record<string, any> = { ...data }
  if (data.items && data.items.length > 0) {
    const firstItem = data.items[0]
    if (!data.part_name) {
      payload.part_name = firstItem.part_name
    }
    if (!data.vehicle) {
      payload.vehicle = firstItem.vehicle
    }
  }
  if (data.os_number !== undefined) {
    payload.os_number = data.os_number.trim()
  }

  return await pb.collection<PurchaseRequest>('purchase_requests').update(id, payload, {
    expand: 'customer,supplier,created_by,quote',
  })
}

/**
 * Move a solicitação de compra para um novo status aplicando regras de negócio automáticas:
 * - Se mover para 'recebida': grava automaticamente `received_at` com a data atual (se ainda não houver).
 * - Se mover para 'entregue': marca `is_completed = true`.
 */
export const movePurchaseRequestStatus = async (
  id: string,
  targetStatus: PurchaseRequestStatus,
  currentData?: Partial<PurchaseRequest>,
): Promise<PurchaseRequest> => {
  const payload: Partial<PurchaseRequest> = {
    status: targetStatus,
  }

  if (targetStatus === 'recebida') {
    if (!currentData?.received_at) {
      payload.received_at = new Date().toISOString()
    }
  }

  if (targetStatus === 'entregue') {
    payload.is_completed = true
  }

  return await updatePurchaseRequest(id, payload)
}

export const deletePurchaseRequest = async (id: string): Promise<boolean> => {
  return await pb.collection('purchase_requests').delete(id)
}

/**
 * Busca compras ativas em andamento (não concluídas/não entregues) por cliente.
 */
export const getActivePurchasesByCustomer = async (
  customerId: string,
): Promise<PurchaseRequest[]> => {
  try {
    return await pb.collection<PurchaseRequest>('purchase_requests').getFullList({
      filter: `customer = "${customerId}" && status != "entregue"`,
      sort: '-created',
    })
  } catch (error) {
    console.warn('Erro ao carregar compras em andamento do cliente:', error)
    return []
  }
}

export interface QuoteEligibilityResult {
  canGenerate: boolean
  reasons: string[]
  itemsMissingSell: number[]
}

/**
 * Valida se uma solicitação de compra está elegível para gerar orçamento:
 * - Deve possuir cliente vinculado
 * - Deve ter ao menos 1 item
 * - TODOS os itens devem ter preço de venda preenchido (> 0)
 */
export const checkPurchaseQuoteEligibility = (
  purchase?: Partial<PurchaseRequest> | null,
): QuoteEligibilityResult => {
  if (!purchase) {
    return {
      canGenerate: false,
      reasons: ['Compra não selecionada'],
      itemsMissingSell: [],
    }
  }

  const reasons: string[] = []
  const itemsMissingSell: number[] = []

  if (!purchase.customer) {
    reasons.push('compra sem cliente')
  }

  const items = normalizePurchaseItems(purchase)
  if (items.length === 0) {
    reasons.push('compra sem itens')
  } else {
    items.forEach((item, index) => {
      const hasSellPrice =
        typeof item.sell_price === 'number' && !isNaN(item.sell_price) && item.sell_price > 0
      if (!hasSellPrice) {
        itemsMissingSell.push(index + 1)
      }
    })

    if (itemsMissingSell.length > 0) {
      if (itemsMissingSell.length === 1) {
        reasons.push(`item ${itemsMissingSell[0]} sem preço de venda`)
      } else {
        reasons.push(`itens ${itemsMissingSell.join(', ')} sem preço de venda`)
      }
    }
  }

  return {
    canGenerate: reasons.length === 0,
    reasons,
    itemsMissingSell,
  }
}

/**
 * Gera ou atualiza o orçamento a partir de uma solicitação de compra:
 * - Cria um ORÇAMENTO para o cliente vinculado com todos os itens da compra e totais
 * - Grava vínculo bidirecional (purchase_request.quote e quote.purchase_request)
 * - Se já houver um orçamento vinculado, atualiza-o sem duplicar
 * - A compra NÃO muda de etapa/coluna
 */
export const generateOrUpdateQuoteFromPurchase = async (
  purchaseId: string,
): Promise<{ quote: any; purchase: PurchaseRequest; isUpdate: boolean }> => {
  // 1. Carrega a compra completa
  const currentPurchase = await getPurchaseRequest(purchaseId)
  if (!currentPurchase) {
    throw new Error('Solicitação de compra não encontrada.')
  }

  // 2. Valida elegibilidade
  const eligibility = checkPurchaseQuoteEligibility(currentPurchase)
  if (!eligibility.canGenerate) {
    throw new Error(`Não foi possível gerar orçamento: ${eligibility.reasons.join(', ')}.`)
  }

  const items = normalizePurchaseItems(currentPurchase)

  // 3. Resolve / cria os produtos no catálogo para cada item da compra
  const quoteItemsPayload: Array<{
    product: string
    quantity: number
    unit_price: number
    total: number
  }> = []

  let calculatedSubtotal = 0

  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1)
    const unitPrice = Number(item.sell_price) || 0
    const totalItem = Math.round((qty * unitPrice + Number.EPSILON) * 100) / 100
    calculatedSubtotal += totalItem

    const productId = await import('@/services/quotes').then((m) =>
      m.findOrCreateProductForPart(item.part_name, unitPrice, item.cost_price, item.vehicle),
    )

    quoteItemsPayload.push({
      product: productId,
      quantity: qty,
      unit_price: unitPrice,
      total: totalItem,
    })
  }

  calculatedSubtotal = Math.round((calculatedSubtotal + Number.EPSILON) * 100) / 100
  const finalTotal = calculatedSubtotal

  const osNote = currentPurchase.os_number ? `OS: ${currentPurchase.os_number}. ` : ''
  const quoteNotes =
    `Orçamento gerado a partir do Pipeline de Compras. ${osNote}${currentPurchase.notes || ''}`.trim()

  // 4. Verifica se já existe orçamento vinculado na compra ou se há orçamento apontando para ela
  let existingQuoteId = currentPurchase.quote || null

  if (!existingQuoteId) {
    try {
      const existingQuotes = await pb.collection('quotes').getList(1, 1, {
        filter: `purchase_request = "${purchaseId}"`,
      })
      if (existingQuotes.items.length > 0) {
        existingQuoteId = existingQuotes.items[0].id
      }
    } catch {
      /* intentionally ignored */
    }
  }

  let finalQuote: any
  let isUpdate = false

  const quotesModule = await import('@/services/quotes')

  if (existingQuoteId) {
    // Atualiza o orçamento existente (não duplica)
    try {
      finalQuote = await quotesModule.updateQuoteWithItems(
        existingQuoteId,
        {
          customer: currentPurchase.customer,
          purchase_request: purchaseId,
          subtotal: calculatedSubtotal,
          discount: 0,
          total: finalTotal,
          notes: quoteNotes,
        },
        quoteItemsPayload,
      )
      isUpdate = true
    } catch (err) {
      console.warn('Erro ao atualizar orçamento vinculado existente, tentando recriar:', err)
      existingQuoteId = null
    }
  }

  if (!existingQuoteId) {
    // Cria um novo orçamento
    finalQuote = await quotesModule.createQuoteWithItems(
      {
        customer: currentPurchase.customer,
        purchase_request: purchaseId,
        status: 'rascunho',
        subtotal: calculatedSubtotal,
        discount: 0,
        total: finalTotal,
        notes: quoteNotes,
      },
      quoteItemsPayload,
    )
    isUpdate = false
  }

  // 5. Garante vínculo bidirecional: salva referência do orçamento na compra se ainda não estiver salvo
  const updatedPurchase = await pb.collection<PurchaseRequest>('purchase_requests').update(
    purchaseId,
    {
      quote: finalQuote.id,
    },
    {
      expand: 'customer,supplier,created_by,quote',
    },
  )

  return {
    quote: finalQuote,
    purchase: updatedPurchase,
    isUpdate,
  }
}
