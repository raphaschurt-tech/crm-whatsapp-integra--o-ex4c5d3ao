import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Customer } from '@/types/crm'

export const getCustomers = async (): Promise<Customer[]> => {
  try {
    return await withRetry(
      () => pb.collection<Customer>('customers').getFullList({ sort: 'name' }),
      { retries: 3, delayMs: 800 },
    )
  } catch (error) {
    console.warn('Erro ao carregar clientes:', error)
    return []
  }
}

export const getCustomer = (id: string) => pb.collection<Customer>('customers').getOne(id)

/**
 * Normaliza documento removendo todos os caracteres não numéricos.
 */
export const cleanDocument = (doc?: string): string => {
  return doc ? doc.replace(/\D/g, '') : ''
}

/**
 * Verifica se já existe outro cliente cadastrado com o mesmo CPF ou CNPJ (com ou sem máscara).
 * Retorna o cliente conflitante, se houver.
 */
export const checkDuplicateDocument = async (
  doc: string,
  excludeCustomerId?: string,
): Promise<Customer | null> => {
  const clean = cleanDocument(doc)
  if (!clean) return null

  try {
    const allCustomers = await pb.collection<Customer>('customers').getFullList()
    for (const c of allCustomers) {
      if (excludeCustomerId && c.id === excludeCustomerId) continue

      const existingCpfClean = cleanDocument(c.cpf)
      const existingCnpjClean = cleanDocument(c.cnpj)

      if (clean === existingCpfClean || clean === existingCnpjClean) {
        return c
      }
    }
  } catch (error) {
    console.warn('Erro ao verificar duplicidade de documento:', error)
  }

  return null
}

export const createCustomer = (data: Partial<Customer>) =>
  pb.collection<Customer>('customers').create(data)

export const updateCustomer = (id: string, data: Partial<Customer>) =>
  pb.collection<Customer>('customers').update(id, data)

export const deleteCustomer = (id: string) => pb.collection('customers').delete(id)
