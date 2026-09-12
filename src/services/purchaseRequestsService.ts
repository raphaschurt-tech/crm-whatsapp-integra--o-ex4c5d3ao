import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'

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
  const payload = {
    ...data,
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
  return await pb.collection<PurchaseRequest>('purchase_requests').update(id, data, {
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
