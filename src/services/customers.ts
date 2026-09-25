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
          expand: 'item_families',
        }),
      { retries: 3, delayMs: 800 },
    )
  } catch (error) {
    console.warn('Erro ao carregar clientes:', error)
    return []
  }
}

export const getCustomer = (id: string) =>
  pb.collection<Customer>('customers').getOne(id, { expand: 'item_families' })

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

// Cache em memória de busca de cliente por telefone para prevenir rajadas / loops (TTL 60s)
interface CustomerCacheEntry {
  customer: Customer | null
  timestamp: number
}
const customerPhoneCache = new Map<string, CustomerCacheEntry>()
const inFlightCustomerLookups = new Map<string, Promise<Customer | null>>()
const CACHE_TTL_MS = 60 * 1000 // 60 segundos

/**
 * Busca cliente por telefone com normalização (variantes 55...), deduplicação in-flight
 * e cache de 60 segundos para evitar 429 Too Many Requests em loops ou keep-alive.
 */
export async function findCustomerByPhone(rawPhone: string): Promise<Customer | null> {
  const digits = (rawPhone || '').replace(/\D/g, '')
  if (!digits || digits.length < 8) return null

  // Chave canônica para o cache (últimos 8 dígitos ou DDD + número)
  const canonicalKey = digits.length >= 8 ? digits.slice(-8) : digits
  const cached = customerPhoneCache.get(canonicalKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.customer
  }

  // Deduplicação in-flight: se já existe uma busca em voo para essa chave, reutilizar a mesma Promise
  if (inFlightCustomerLookups.has(canonicalKey)) {
    return inFlightCustomerLookups.get(canonicalKey)!
  }

  const lookupPromise = (async (): Promise<Customer | null> => {
    try {
      const variants = new Set<string>()
      variants.add(digits)
      if (digits.startsWith('55') && digits.length >= 12) {
        variants.add(digits.slice(2))
      } else if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
        variants.add(`55${digits}`)
      }

      const filterPhoneParts = Array.from(variants)
        .map((v) => `phone ~ "${v}"`)
        .join(' || ')

      const matchedCustomers = await withRetry(
        () =>
          pb.collection<Customer>('customers').getList(1, 5, {
            filter: filterPhoneParts,
          }),
        { retries: 3, delayMs: 1000 },
      )

      // Encontrar cliente cujo número limpo case com uma das variantes
      const matched =
        matchedCustomers.items.find((c) => {
          const cDigits = (c.phone || '').replace(/\D/g, '')
          return variants.has(cDigits)
        }) || null

      // Salvar no cache
      customerPhoneCache.set(canonicalKey, {
        customer: matched,
        timestamp: Date.now(),
      })

      return matched
    } catch (err) {
      console.warn('[findCustomerByPhone] Falha ao buscar cliente por telefone:', err)
      // Se já tínhamos algo no cache expirado, devolve em vez de falhar totalmente
      if (cached) return cached.customer
      return null
    } finally {
      inFlightCustomerLookups.delete(canonicalKey)
    }
  })()

  inFlightCustomerLookups.set(canonicalKey, lookupPromise)
  return lookupPromise
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
