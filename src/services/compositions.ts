import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { ProductComposition } from '@/types/crm'

export const getCompositionsByProduct = async (
  productId: string,
): Promise<ProductComposition[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<ProductComposition>('product_compositions').getFullList({
          filter: `product = '${productId}'`,
          expand: 'family,allowed_products',
        }),
      { retries: 2, delayMs: 400 },
    )
  } catch (error) {
    console.warn('Erro ao carregar composições do produto:', error)
    return []
  }
}

export const saveProductCompositions = async (
  productId: string,
  compositions: Array<{
    id?: string
    familyId: string
    allowedProductIds: string[]
    required: boolean
  }>,
) => {
  // 1. Obter composições existentes
  const existing = await pb.collection<ProductComposition>('product_compositions').getFullList({
    filter: `product = '${productId}'`,
  })

  const currentFamilyIds = new Set(compositions.map((c) => c.familyId))

  // 2. Remover composições que não estão mais na lista
  for (const item of existing) {
    if (!currentFamilyIds.has(item.family)) {
      await pb.collection('product_compositions').delete(item.id)
    }
  }

  // 3. Criar ou atualizar composições selecionadas
  for (const comp of compositions) {
    const found = existing.find((e) => e.family === comp.familyId)
    if (found) {
      await pb.collection('product_compositions').update(found.id, {
        allowed_products: comp.allowedProductIds,
        required: comp.required,
      })
    } else {
      await pb.collection('product_compositions').create({
        product: productId,
        family: comp.familyId,
        allowed_products: comp.allowedProductIds,
        required: comp.required,
      })
    }
  }
}
