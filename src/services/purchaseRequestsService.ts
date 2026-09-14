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
      return `${qtyStr} ${item.part_name}${vehStr}${supStr}`
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
          expand: 'customer,supplier,created_by',
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
    expand: 'customer,supplier,created_by',
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
    expand: 'customer,supplier,created_by',
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
    expand: 'customer,supplier,created_by',
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
