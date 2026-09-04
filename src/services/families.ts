import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { ItemFamily, Product } from '@/types/crm'

export const getFamilies = async (): Promise<ItemFamily[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<ItemFamily>('item_families').getFullList({
          sort: 'name',
          expand: 'products',
        }),
      { retries: 2, delayMs: 400 },
    )
  } catch (error) {
    console.warn('Erro ao carregar famílias:', error)
    return []
  }
}

export const getFamily = (id: string) =>
  pb.collection<ItemFamily>('item_families').getOne(id, {
    expand: 'products',
  })

export const createFamily = (data: { name: string; description?: string; products?: string[] }) =>
  pb.collection<ItemFamily>('item_families').create(data)

export const updateFamily = (
  id: string,
  data: {
    name?: string
    description?: string
    products?: string[]
  },
) => pb.collection<ItemFamily>('item_families').update(id, data)

export const deleteFamily = (id: string) => pb.collection('item_families').delete(id)

export const addProductToFamily = async (familyId: string, productId: string) => {
  const family = await getFamily(familyId)
  const current = Array.isArray(family.products) ? family.products : []
  if (!current.includes(productId)) {
    return updateFamily(familyId, { products: [...current, productId] })
  }
  return family
}

export const removeProductFromFamily = async (familyId: string, productId: string) => {
  const family = await getFamily(familyId)
  const current = Array.isArray(family.products) ? family.products : []
  const updated = current.filter((id) => id !== productId)
  return updateFamily(familyId, { products: updated })
}
