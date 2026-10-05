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

// Cache em memória de busca de cliente por telefone para prevenir rajadas / loops (TTL 10 minutos)
interface CustomerCacheEntry {
  customer: Customer | null
  timestamp: number
}
const customerPhoneCache = new Map<string, CustomerCacheEntry>()
// Cache permanente do último contato conhecido (nunca expira, fallback de UI para não sumir nome)
const lastKnownCustomerByPhone = new Map<string, Customer>()
const inFlightCustomerLookups = new Map<string, Promise<Customer | null>>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutos de cache

// Backoff para 429 Too Many Requests (evita martelar se o backend estiver limitando)
let rateLimitBackoffUntil = 0

/**
 * Registra ou atualiza contatos conhecidos no cache em lote (evita N requisições)
 */
export function populateCustomerCache(customers: Customer[]): void {
  const now = Date.now()
  for (const c of customers) {
    if (!c) continue
    const digits = (c.phone || '').replace(/\D/g, '')
    if (digits.length >= 8) {
      const canonical = digits.slice(-8)
      customerPhoneCache.set(canonical, { customer: c, timestamp: now })
      lastKnownCustomerByPhone.set(canonical, c)
    }
    if (digits) {
      customerPhoneCache.set(digits, { customer: c, timestamp: now })
      lastKnownCustomerByPhone.set(digits, c)
    }
  }
}

/**
 * Retorna o último cliente conhecido do cache síncrono para render imediato sem piscar
 */
export function getLastKnownCustomer(rawPhone: string): Customer | null {
  const digits = (rawPhone || '').replace(/\D/g, '')
  if (!digits) return null
  const canonical = digits.length >= 8 ? digits.slice(-8) : digits
  return lastKnownCustomerByPhone.get(canonical) || lastKnownCustomerByPhone.get(digits) || null
}

/**
 * Busca cliente por telefone com normalização (variantes 55...), deduplicação in-flight,
 * proteção contra 429, cache de 10 min e fallback permanente para manter o nome salvo.
 */
export async function findCustomerByPhone(rawPhone: string): Promise<Customer | null> {
  const digits = (rawPhone || '').replace(/\D/g, '')
  if (!digits || digits.length < 8) return null

  // Chave canônica para o cache (últimos 8 dígitos ou DDD + número)
  const canonicalKey = digits.length >= 8 ? digits.slice(-8) : digits
  const lastKnown =
    lastKnownCustomerByPhone.get(canonicalKey) || lastKnownCustomerByPhone.get(digits) || null

  const cached = customerPhoneCache.get(canonicalKey) || customerPhoneCache.get(digits)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.customer ?? lastKnown
  }

  // Se estamos sob janela de backoff de 429 (Too Many Requests), respeitar e devolver fallback imediatamente
  if (Date.now() < rateLimitBackoffUntil) {
    return lastKnown
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

      // Máximo 1 retry com backoff para nunca gerar loop de 429
      const matchedCustomers = await withRetry(
        () =>
          pb.collection<Customer>('customers').getList(1, 5, {
            filter: filterPhoneParts,
          }),
        { retries: 1, delayMs: 1500 },
      )

      // Encontrar cliente cujo número limpo case com uma das variantes
      const matched =
        matchedCustomers.items.find((c) => {
          const cDigits = (c.phone || '').replace(/\D/g, '')
          return variants.has(cDigits)
        }) || null

      // Salvar no cache ativo e no último conhecido
      customerPhoneCache.set(canonicalKey, {
        customer: matched,
        timestamp: Date.now(),
      })
      if (matched) {
        lastKnownCustomerByPhone.set(canonicalKey, matched)
        lastKnownCustomerByPhone.set(digits, matched)
      }

      return matched ?? lastKnown
    } catch (err: any) {
      const is429 =
        err?.status === 429 ||
        String(err?.message || '').includes('429') ||
        String(err?.message || '')
          .toLowerCase()
          .includes('too many')
      if (is429) {
        // Pausar novas requisições por 5 segundos para respeitar o rate limit do backend
        rateLimitBackoffUntil = Date.now() + 5000
        console.warn('[findCustomerByPhone] Rate limit 429 atingido. Ativando backoff de 5s.')
      } else {
        console.warn('[findCustomerByPhone] Falha ao buscar cliente por telefone:', err)
      }
      // CRÍTICO: sob qualquer falha/429, SEMPRE manter o último cliente conhecido do cache em vez de null
      return lastKnown
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
