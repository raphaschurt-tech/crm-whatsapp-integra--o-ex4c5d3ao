import pb from '@/lib/pocketbase/client'
import { Product } from '@/types/crm'

export const getProducts = async (): Promise<Product[]> => {
  try {
    return await pb.collection<Product>('products').getFullList({ sort: 'name' })
  } catch (error) {
    console.warn('Erro ao carregar produtos:', error)
    return []
  }
}

export const getProduct = (id: string) => pb.collection<Product>('products').getOne(id)

export const createProduct = (data: Partial<Product>) =>
  pb.collection<Product>('products').create(data)

export const updateProduct = (id: string, data: Partial<Product>) =>
  pb.collection<Product>('products').update(id, data)

export const deleteProduct = (id: string) => pb.collection('products').delete(id)
