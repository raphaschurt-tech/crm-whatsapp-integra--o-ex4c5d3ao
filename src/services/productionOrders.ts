import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { ProductionOrder, Product, SelectedProductionItem } from '@/types/crm'
import { getProduct, updateProduct } from '@/services/products'

export const getProductionOrders = async (): Promise<ProductionOrder[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<ProductionOrder>('production_orders').getFullList({
          sort: '-created',
          expand: 'product',
        }),
      { retries: 2, delayMs: 400 },
    )
  } catch (error) {
    console.warn('Erro ao listar ordens de produção:', error)
    return []
  }
}

export const getProductionOrder = async (id: string): Promise<ProductionOrder> => {
  return pb.collection<ProductionOrder>('production_orders').getOne(id, {
    expand: 'product',
  })
}

/**
 * Requisito de custo do produto final:
 * "Se um item usado também for do tipo 'Produzido', o custo dele é o custo da última OP que o produziu."
 * Retorna o custo real resolvido para um produto (produzido ou comprado).
 */
export const getResolvedItemUnitCost = async (
  itemProduct: Product,
): Promise<{ unitCost: number; isProduced: boolean }> => {
  const isItemProduced = Boolean(
    itemProduct.is_produced ?? itemProduct.product_type === 'produzido',
  )
  if (isItemProduced) {
    try {
      // Buscar última OP concluída para este produto
      const lastCompletedOrders = await pb
        .collection<ProductionOrder>('production_orders')
        .getList(1, 1, {
          filter: `product = '${itemProduct.id}' && status = 'concluida'`,
          sort: '-completed_at,-created',
        })

      if (lastCompletedOrders.items.length > 0) {
        const lastOP = lastCompletedOrders.items[0]
        const opUnitCost =
          lastOP.unit_cost && lastOP.unit_cost > 0
            ? lastOP.unit_cost
            : (lastOP.total_cost || 0) / (lastOP.quantity || 1)

        if (opUnitCost > 0) {
          return { unitCost: Number(opUnitCost.toFixed(2)), isProduced: true }
        }
      }
    } catch (e) {
      console.warn('Erro ao buscar custo da última OP para insumo produzido:', e)
    }
  }

  // Se não for produzido ou não tiver OP concluída anterior, usa o cost padrão cadastrado
  return {
    unitCost: Number((itemProduct.cost || 0).toFixed(2)),
    isProduced: isItemProduced,
  }
}

export const generateProductionOrderCode = async (): Promise<string> => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(1000 + Math.random() * 9000)
  return `OP-${dateStr}-${random}`
}

export const createProductionOrder = async (data: {
  code?: string
  product: string
  quantity: number
  status?: 'aberta' | 'em_producao' | 'concluida' | 'cancelada'
  total_cost: number
  unit_cost: number
  selected_items: SelectedProductionItem[]
  notes?: string
}): Promise<ProductionOrder> => {
  const code = data.code || (await generateProductionOrderCode())
  return pb.collection<ProductionOrder>('production_orders').create({
    code,
    product: data.product,
    quantity: data.quantity,
    status: data.status || 'aberta',
    total_cost: data.total_cost,
    unit_cost: data.unit_cost,
    selected_items: data.selected_items,
    notes: data.notes || '',
  })
}

export const updateProductionOrder = async (
  id: string,
  data: Partial<ProductionOrder>,
): Promise<ProductionOrder> => {
  return pb.collection<ProductionOrder>('production_orders').update(id, data)
}

export const deleteProductionOrder = async (id: string): Promise<boolean> => {
  return pb.collection('production_orders').delete(id)
}

/**
 * Conclusão da OP e baixa no estoque:
 * "Quando a OP muda para status 'Concluída', o sistema dá baixa no estoque dos itens selecionados
 *  e entra no estoque o produto final fabricado, com o custo real da produção."
 */
export const completeProductionOrder = async (orderId: string): Promise<ProductionOrder> => {
  const order = await getProductionOrder(orderId)

  if (order.status === 'concluida') {
    throw new Error('Esta Ordem de Produção já foi concluída anteriormente.')
  }

  // 1. Dar baixa no estoque dos itens selecionados
  const selectedItems: SelectedProductionItem[] = Array.isArray(order.selected_items)
    ? order.selected_items
    : []

  for (const item of selectedItems) {
    try {
      const insumo = await getProduct(item.product_id)
      const currentStock = insumo.stock_quantity || 0
      const newStock = Math.max(0, currentStock - (item.quantity_used || 1))
      await updateProduct(item.product_id, { stock_quantity: newStock })
    } catch (err) {
      console.error(`Erro ao dar baixa no item ${item.product_name} (${item.product_id}):`, err)
    }
  }

  // 2. Dar entrada no produto final com o custo real unitário
  const finalProductId = order.product
  const producedQty = order.quantity || 1
  const unitCost =
    order.unit_cost && order.unit_cost > 0 ? order.unit_cost : (order.total_cost || 0) / producedQty

  try {
    const finalProduct = await getProduct(finalProductId)
    const currentStock = finalProduct.stock_quantity || 0
    const updatedStock = currentStock + producedQty
    await updateProduct(finalProductId, {
      stock_quantity: updatedStock,
      cost: Number(unitCost.toFixed(2)),
    })
  } catch (err) {
    console.error(`Erro ao dar entrada no estoque do produto final ${finalProductId}:`, err)
  }

  // 3. Atualizar a OP para concluída
  const updatedOrder = await pb.collection<ProductionOrder>('production_orders').update(orderId, {
    status: 'concluida',
    completed_at: new Date().toISOString(),
  })

  return updatedOrder
}
