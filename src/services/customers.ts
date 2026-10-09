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
/**
 * Helper para agrupar tipo de entidade (cliente vs fornecedor/ambos)
 */
export function getCustomerGroupType(customerType?: string): 'cliente' | 'fornecedor' {
  const t = (customerType || '').toLowerCase()
  if (t === 'fornecedor' || t === 'ambos') return 'fornecedor'
  return 'cliente'
}

/**
 * Normaliza telefone para o core canônico (DDD + 8 dígitos sem DDI 55 e sem nono dígito)
 */
export function getCanonicalPhoneCore(rawPhone?: string): string {
  if (!rawPhone) return ''
  const s = String(rawPhone).trim()
  if (s.toLowerCase().includes('@lid')) return ''
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 14 || digits.length < 8) return ''

  let withoutDdi = digits
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    withoutDdi = digits.slice(2)
  }

  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
  }
  if (withoutDdi.length === 10) {
    return withoutDdi
  }
  return withoutDdi
}

/**
 * Verifica se já existe outro cliente/fornecedor cadastrado com o mesmo CPF ou CNPJ (com ou sem máscara)
 * dentro do mesmo grupo (cliente vs fornecedor).
 * Retorna o cliente conflitante, se houver.
 */
export const checkDuplicateDocument = async (
  doc: string,
  excludeCustomerId?: string,
  targetCustomerType?: string,
): Promise<Customer | null> => {
  const clean = cleanDocument(doc)
  if (!clean) return null

  const targetGroup = getCustomerGroupType(targetCustomerType)

  try {
    const allCustomers = await pb.collection<Customer>('customers').getFullList({
      filter: 'deleted != true',
    })
    for (const c of allCustomers) {
      if (excludeCustomerId && c.id === excludeCustomerId) continue

      // Verificar correspondência de grupo (cliente vs fornecedor) se especificado
      if (targetCustomerType) {
        const existingGroup = getCustomerGroupType(c.customer_type)
        if (existingGroup !== targetGroup) continue
      }

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

// Dedupe in-flight da consulta global de clientes via getCustomers()
let inFlightAllCustomersPromise: Promise<Customer[]> | null = null
let allCustomersLoadedAt = 0

// Backoff para 429 Too Many Requests (evita martelar se o backend estiver limitando)
let rateLimitBackoffUntil = 0

/**
 * Gera todas as variantes conhecidas de um número de telefone para indexação:
 * - Dígitos puros
 * - Com DDI 55 (se 10 ou 11 dígitos)
 * - Sem DDI 55 (se começa com 55 e tem 12 ou 13 dígitos)
 * - Com nono dígito (se DDD 2 dígitos + 8 dígitos móveis)
 * - Sem nono dígito (se DDD 2 dígitos + 9 dígitos iniciando em 9)
 * - Últimos 8 dígitos (canônico local)
 * - Últimos 9 dígitos (móvel local)
 */
export function getPhoneVariants(rawPhone: string): string[] {
  const digits = (rawPhone || '').replace(/\D/g, '')
  if (!digits || digits.length < 8) return []

  const variants = new Set<string>()
  variants.add(digits)

  // Variantes de DDI 55
  let withoutDdi = digits
  let withDdi = digits
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    withoutDdi = digits.slice(2)
    variants.add(withoutDdi)
  } else if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    withDdi = `55${digits}`
    variants.add(withDdi)
  }

  // Variantes de 8 e 9 dígitos (celulares brasileiros com/sem o dígito 9)
  // Caso 1: sem DDI, DDD de 2 dígitos + 9 dígitos (ex: 11988306629)
  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    const ddd = withoutDdi.slice(0, 2)
    const eight = withoutDdi.slice(3)
    const withoutNine = `${ddd}${eight}`
    variants.add(withoutNine)
    variants.add(`55${withoutNine}`)
  }
  // Caso 2: sem DDI, DDD de 2 dígitos + 8 dígitos (ex: 1188306629)
  if (withoutDdi.length === 10) {
    const ddd = withoutDdi.slice(0, 2)
    const eight = withoutDdi.slice(2)
    const withNine = `${ddd}9${eight}`
    variants.add(withNine)
    variants.add(`55${withNine}`)
  }

  // Sufixos canônicos (últimos 8 e 9 dígitos)
  if (digits.length >= 8) {
    variants.add(digits.slice(-8))
  }
  if (digits.length >= 9) {
    variants.add(digits.slice(-9))
  }

  return Array.from(variants)
}

/**
 * Registra ou atualiza contatos conhecidos no cache em lote (cobre TODAS as variantes)
 */
export function populateCustomerCache(customers: Customer[]): void {
  const now = Date.now()
  for (const c of customers) {
    if (!c) continue
    const variants = getPhoneVariants(c.phone || '')
    for (const v of variants) {
      customerPhoneCache.set(v, { customer: c, timestamp: now })
      lastKnownCustomerByPhone.set(v, c)
    }
  }
}

/**
 * Retorna o último cliente conhecido do cache síncrono para render imediato sem piscar.
 * Testa todas as variantes de telefone para máxima chance de match.
 */
export function getLastKnownCustomer(rawPhone: string): Customer | null {
  const variants = getPhoneVariants(rawPhone)
  for (const v of variants) {
    const found = lastKnownCustomerByPhone.get(v)
    if (found) return found
  }
  return null
}

/**
 * Garante que o catálogo de clientes está em memória (carregado via getCustomers em lote).
 * Usa deduplicação de promessa em voo e TTL de 5 minutos para evitar chamadas redundantes.
 */
export async function ensureCustomersLoaded(forceRefresh = false): Promise<Customer[]> {
  const now = Date.now()
  const isFresh =
    !forceRefresh && allCustomersLoadedAt > 0 && now - allCustomersLoadedAt < 5 * 60 * 1000
  if (isFresh && customerPhoneCache.size > 0) {
    return Array.from(lastKnownCustomerByPhone.values())
  }

  if (inFlightAllCustomersPromise) {
    return inFlightAllCustomersPromise
  }

  // Se estiver sob backoff de 429, retorna clientes já conhecidos imediatamente
  if (now < rateLimitBackoffUntil) {
    return Array.from(lastKnownCustomerByPhone.values())
  }

  inFlightAllCustomersPromise = (async () => {
    try {
      const list = await getCustomers(false)
      if (list && list.length > 0) {
        populateCustomerCache(list)
        allCustomersLoadedAt = Date.now()
      }
      return list
    } catch (err: any) {
      const is429 =
        err?.status === 429 ||
        String(err?.message || '').includes('429') ||
        String(err?.message || '')
          .toLowerCase()
          .includes('too many')
      if (is429) {
        rateLimitBackoffUntil = Date.now() + 5000
        console.warn('[ensureCustomersLoaded] Rate limit 429 no backend. Backoff 5s ativado.')
      }
      return Array.from(lastKnownCustomerByPhone.values())
    } finally {
      inFlightAllCustomersPromise = null
    }
  })()

  return inFlightAllCustomersPromise
}

/**
 * Busca cliente por telefone:
 * 1. Consulta em memória pelo cache permanente / ativo cobrindo todas as variantes de telefone
 * 2. Se não estiver no cache, carrega em lote via ensureCustomersLoaded() (1 única consulta compartilhada)
 * 3. Fallback pontual individual com dedupe in-flight e backoff de 5s sob 429, com no máximo 1 retry
 * 4. NUNCA descarta o último cliente conhecido sob erro/429
 */
export async function findCustomerByPhone(rawPhone: string): Promise<Customer | null> {
  const digits = (rawPhone || '').replace(/\D/g, '')
  if (!digits || digits.length < 8) return null

  // 1. Verificação síncrona imediata no cache de variantes
  const lastKnown = getLastKnownCustomer(rawPhone)
  const variants = getPhoneVariants(rawPhone)
  for (const v of variants) {
    const entry = customerPhoneCache.get(v)
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS && entry.customer) {
      return entry.customer
    }
  }

  // Se já temos o cliente gravado no lastKnown, retornamos sem precisar bater no banco
  if (lastKnown) {
    return lastKnown
  }

  // 2. Se o cache de clientes ainda não foi populado nesta sessão, carregar a lista geral em lote
  if (allCustomersLoadedAt === 0 && Date.now() >= rateLimitBackoffUntil) {
    try {
      await ensureCustomersLoaded()
      const resolvedFromBatch = getLastKnownCustomer(rawPhone)
      if (resolvedFromBatch) return resolvedFromBatch
    } catch {
      /* ignore */
    }
  }

  // Se estamos sob janela de backoff de 429 (Too Many Requests), respeitar e devolver fallback imediatamente
  if (Date.now() < rateLimitBackoffUntil) {
    return lastKnown
  }

  // Chave canônica para o dedupe in-flight
  const canonicalKey = digits.length >= 8 ? digits.slice(-8) : digits

  // 3. Deduplicação in-flight: se já existe uma busca em voo para essa chave, reutilizar a mesma Promise
  if (inFlightCustomerLookups.has(canonicalKey)) {
    return inFlightCustomerLookups.get(canonicalKey)!
  }

  const lookupPromise = (async (): Promise<Customer | null> => {
    try {
      const lookupVariants = new Set<string>(variants)
      const filterPhoneParts = Array.from(lookupVariants)
        .slice(0, 4)
        .map((v) => `phone ~ "${v}"`)
        .join(' || ')

      // Máximo 1 retry com backoff para nunca gerar loop de 429
      const matchedCustomers = await withRetry(
        () =>
          pb.collection<Customer>('customers').getList(1, 5, {
            filter: filterPhoneParts || undefined,
          }),
        { retries: 1, delayMs: 1500 },
      )

      // Encontrar cliente cujo número limpo case com uma das variantes
      const matched =
        matchedCustomers.items.find((c) => {
          const cVariants = getPhoneVariants(c.phone || '')
          return cVariants.some((cv) => lookupVariants.has(cv))
        }) || null

      // Salvar no cache ativo e no último conhecido
      if (matched) {
        populateCustomerCache([matched])
      } else {
        for (const v of variants) {
          customerPhoneCache.set(v, { customer: null, timestamp: Date.now() })
        }
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

/**
 * Analisa mensagem ou objeto de erro para identificar se é um erro de duplicidade
 * vindo do hook customer_duplicate_guard do backend PocketBase.
 * Extrai a mensagem amigável e o ID do registro conflitante (se presente).
 */
export interface DuplicateConflictInfo {
  isDuplicate: boolean
  message: string
  existingId?: string
  existingName?: string
  field?: 'telefone' | 'CPF' | 'CNPJ' | 'documento'
  entityLabel?: 'cliente' | 'fornecedor'
}

export function extractDuplicateErrorInfo(error: unknown): DuplicateConflictInfo {
  const defaultRes: DuplicateConflictInfo = {
    isDuplicate: false,
    message: '',
  }

  if (!error) return defaultRes

  let rawMessage = ''
  if (typeof error === 'string') {
    rawMessage = error
  } else if (typeof error === 'object' && error !== null) {
    const err = error as any
    // PocketBase ClientResponseError ou objeto genérico de erro
    rawMessage = err.response?.message || err.data?.message || err.message || ''
    // Também checar se veio em data errors
    if (!rawMessage && err.response?.data && typeof err.response.data === 'object') {
      const dataValues = Object.values(err.response.data)
      for (const val of dataValues) {
        if (typeof val === 'object' && val && 'message' in val) {
          rawMessage = String((val as any).message)
          break
        }
      }
    }
  }

  if (!rawMessage) return defaultRes

  // Padrão emitido pelo customer_duplicate_guard:
  // "Já existe um cliente/fornecedor cadastrado com este telefone/CPF/CNPJ: {nome} [id:{existingId}]"
  // ou sem o [id:...] caso legado: "Já existe um cliente cadastrado com este..."
  const match = rawMessage.match(
    /Já existe um (cliente|fornecedor) cadastrado com este (telefone|CPF|CNPJ):\s*([^[]+?)(?:\s*\[id:([a-zA-Z0-9_-]+)\])?$/i,
  )

  if (match) {
    const entityLabel = match[1].toLowerCase() as 'cliente' | 'fornecedor'
    const field = match[2] as 'telefone' | 'CPF' | 'CNPJ'
    const existingName = match[3]?.trim() || ''
    const existingId = match[4]?.trim() || undefined
    const cleanDisplayMsg = `Já existe um ${entityLabel} cadastrado com este ${field}: ${existingName}`

    return {
      isDuplicate: true,
      message: cleanDisplayMsg,
      existingId,
      existingName,
      field,
      entityLabel,
    }
  }

  // Checagem genérica caso a mensagem contenha "Já existe um" e ("cadastrado" ou "telefone" ou "CPF" ou "CNPJ")
  if (
    rawMessage.includes('Já existe um') &&
    (rawMessage.includes('cadastrado') ||
      rawMessage.includes('telefone') ||
      rawMessage.includes('CPF') ||
      rawMessage.includes('CNPJ'))
  ) {
    // Tentar extrair id caso exista [id:xxx]
    const idMatch = rawMessage.match(/\[id:([a-zA-Z0-9_-]+)\]/)
    const cleanMsg = rawMessage.replace(/\s*\[id:[a-zA-Z0-9_-]+\]/, '').trim()
    return {
      isDuplicate: true,
      message: cleanMsg,
      existingId: idMatch ? idMatch[1] : undefined,
    }
  }

  return defaultRes
}

export const createCustomer = async (data: Partial<Customer>): Promise<Customer> => {
  try {
    return await pb.collection<Customer>('customers').create(data)
  } catch (err: any) {
    // Garantir que a mensagem de duplicidade ou validação do backend não seja engolida
    const dup = extractDuplicateErrorInfo(err)
    if (dup.isDuplicate) {
      err.isDuplicate = true
      err.duplicateInfo = dup
      // Atribuir mensagem amigável limpa diretamente para consumidores de err.message
      err.message = dup.message
    }
    throw err
  }
}

export const updateCustomer = async (id: string, data: Partial<Customer>): Promise<Customer> => {
  try {
    return await pb.collection<Customer>('customers').update(id, data)
  } catch (err: any) {
    const dup = extractDuplicateErrorInfo(err)
    if (dup.isDuplicate) {
      err.isDuplicate = true
      err.duplicateInfo = dup
      err.message = dup.message
    }
    throw err
  }
}

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
