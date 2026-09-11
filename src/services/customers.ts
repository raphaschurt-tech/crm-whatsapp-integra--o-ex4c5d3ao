import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Customer } from '@/types/crm'

export const getCustomers = async (includeDeleted = false): Promise<Customer[]> => {
  try {
    const filter = includeDeleted ? '' : 'deleted != true'
    return await withRetry(
      () =>
        pb.collection<Customer>('customers').getFullList({
          sort: 'name',
          filter: filter || undefined,
        }),
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

/**
 * Soft delete de cliente: marca deleted = true e deleted_at com timestamp atual.
 * Nunca realiza remoção física do registro no banco de dados.
 * Protegido no backend: apenas role 'admin' tem permissão de executar.
 */
export const deleteCustomer = async (id: string): Promise<Customer> => {
  return await pb.collection<Customer>('customers').update(id, {
    deleted: true,
    deleted_at: new Date().toISOString(),
  })
}

export interface SyncContactsResult {
  ok: boolean
  imported: number
  updated: number
  ignored: number
  totalFetched: number
  error?: string
}

/**
 * Dispara a sincronização manual de contatos do WhatsApp (Z-API) no backend.
 */
export const syncWhatsAppContacts = async (): Promise<SyncContactsResult> => {
  return await pb.send<SyncContactsResult>('/backend/v1/whatsapp/sync-contacts', {
    method: 'POST',
  })
}
