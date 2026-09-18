import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Order, OrderItem } from '@/types/crm'

export interface ConvertQuoteToOrderParams {
  quoteId: string
  promisedDeliveryDate?: string
  responsibleUserId?: string
}

export interface ConvertQuoteToOrderResponse {
  success: boolean
  order?: Order
  message?: string
  error?: string
  idempotent?: boolean
}

export interface CancelOrderResponse {
  success: boolean
  order?: Order
  message?: string
  error?: string
  idempotent?: boolean
}

/**
 * Busca todos os pedidos cadastrados (Slice 1A)
 */
export async function getOrders(): Promise<Order[]> {
  return withRetry(
    async () => {
      const records = await pb.collection('orders').getFullList<Order>({
        sort: '-created',
        expand: 'quote_id,responsible',
      })
      return records
    },
    { retries: 3, delayMs: 300 },
  )
}

/**
 * Busca um pedido por ID com itens e relações expandidas
 */
export async function getOrder(id: string): Promise<Order> {
  return withRetry(
    async () => {
      const record = await pb.collection('orders').getOne<Order>(id, {
        expand: 'quote_id,responsible',
      })
      return record
    },
    { retries: 3, delayMs: 300 },
  )
}

/**
 * Busca os itens de um pedido
 */
export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  return withRetry(
    async () => {
      const records = await pb.collection('order_items').getFullList<OrderItem>({
        filter: `order_id = "${orderId}"`,
        sort: 'created',
        expand: 'product_id',
      })
      return records
    },
    { retries: 3, delayMs: 300 },
  )
}

/**
 * Busca o pedido ativo (não cancelado) associado a um orçamento, se existir
 */
export async function getActiveOrderByQuoteId(quoteId: string): Promise<Order | null> {
  return withRetry(
    async () => {
      try {
        const records = await pb.collection('orders').getList<Order>(1, 1, {
          filter: `quote_id = "${quoteId}" && commercial_status != "cancelado"`,
          sort: '-created',
          expand: 'quote_id,responsible',
        })
        return records.items[0] || null
      } catch (_) {
        return null
      }
    },
    { retries: 3, delayMs: 300 },
  )
}

/**
 * Converte um orçamento em pedido chamando o hook atômico /backend/v1/orders/convert
 */
export async function convertQuoteToOrder(
  params: ConvertQuoteToOrderParams,
): Promise<ConvertQuoteToOrderResponse> {
  try {
    const res = await pb.send('/backend/v1/orders/convert', {
      method: 'POST',
      body: {
        quote_id: params.quoteId,
        promised_delivery_date: params.promisedDeliveryDate || null,
        responsible: params.responsibleUserId || null,
      },
    })
    return res as ConvertQuoteToOrderResponse
  } catch (err: any) {
    const errorMessage =
      err?.data?.error || err?.message || 'Falha ao converter orçamento em pedido.'
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Cancela um pedido e libera as reservas de estoque chamando /backend/v1/orders/cancel
 */
export async function cancelOrder(orderId: string): Promise<CancelOrderResponse> {
  try {
    const res = await pb.send('/backend/v1/orders/cancel', {
      method: 'POST',
      body: {
        order_id: orderId,
      },
    })
    return res as CancelOrderResponse
  } catch (err: any) {
    const errorMessage = err?.data?.error || err?.message || 'Falha ao cancelar pedido.'
    return {
      success: false,
      error: errorMessage,
    }
  }
}
