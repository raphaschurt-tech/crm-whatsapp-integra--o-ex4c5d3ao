import pb from '@/lib/pocketbase/client'

interface CachedPhotoData {
  url: string | null
  timestamp: number
}

const CACHE_PREFIX = 'rpa_wa_photo_'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 horas

// Cache em memória para acesso síncrono e evitar JSON.parse constante
const memoryCache = new Map<string, { url: string | null; expiresAt: number }>()

// In-flight promises para desduplicar requisições em andamento do mesmo telefone
const inFlightRequests = new Map<string, Promise<string | null>>()

// Fila com limitação de concorrência (máx 2 requisições simultâneas para a Z-API)
const MAX_CONCURRENT = 2
let runningCount = 0
const queue: Array<() => void> = []

function runNext() {
  if (runningCount >= MAX_CONCURRENT || queue.length === 0) {
    return
  }
  const nextFn = queue.shift()
  if (nextFn) {
    runningCount++
    try {
      nextFn()
    } catch {
      runningCount = Math.max(0, runningCount - 1)
      runNext()
    }
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          runningCount = Math.max(0, runningCount - 1)
          runNext()
        })
    })
    runNext()
  })
}

/**
 * Normaliza número para a chave de cache e requisição
 */
export function normalizePhoneForPhoto(rawPhone: string): string {
  let digits = (rawPhone || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`
  }
  return digits
}

/**
 * Lê do cache síncrono (memória ou localStorage)
 */
export function getCachedProfilePhoto(phone: string): { hit: boolean; url: string | null } {
  const norm = normalizePhoneForPhoto(phone)
  if (!norm) return { hit: false, url: null }

  const now = Date.now()

  // 1. Checa memória
  const mem = memoryCache.get(norm)
  if (mem && mem.expiresAt > now) {
    return { hit: true, url: mem.url }
  }

  // 2. Checa localStorage
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${norm}`)
    if (raw) {
      const parsed: CachedPhotoData = JSON.parse(raw)
      if (parsed && typeof parsed.timestamp === 'number') {
        if (now - parsed.timestamp < CACHE_TTL_MS) {
          memoryCache.set(norm, {
            url: parsed.url,
            expiresAt: parsed.timestamp + CACHE_TTL_MS,
          })
          return { hit: true, url: parsed.url }
        } else {
          localStorage.removeItem(`${CACHE_PREFIX}${norm}`)
        }
      }
    }
  } catch {
    /* ignore storage errors */
  }

  return { hit: false, url: null }
}

/**
 * Salva no cache (memória + localStorage)
 */
function setCachedProfilePhoto(phone: string, url: string | null) {
  const norm = normalizePhoneForPhoto(phone)
  if (!norm) return

  const now = Date.now()
  memoryCache.set(norm, {
    url,
    expiresAt: now + CACHE_TTL_MS,
  })

  try {
    const payload: CachedPhotoData = {
      url,
      timestamp: now,
    }
    localStorage.setItem(`${CACHE_PREFIX}${norm}`, JSON.stringify(payload))
  } catch {
    /* ignore quota / storage errors */
  }
}

/**
 * Busca a foto de perfil do contato via endpoint autenticado do backend.
 * Garante:
 * - Cache local TTL 24h
 * - Desduplicação in-flight por telefone
 * - Concorrência controlada por fila
 * - Nunca lança erro ou interrompe o front: em qualquer falha retorna null
 */
export async function fetchProfilePhoto(rawPhone: string): Promise<string | null> {
  const norm = normalizePhoneForPhoto(rawPhone)
  if (!norm || norm.length < 10) {
    return null
  }

  // Verificar cache
  const cached = getCachedProfilePhoto(norm)
  if (cached.hit) {
    return cached.url
  }

  // Verificar se já existe requisição em andamento para este telefone
  const inFlight = inFlightRequests.get(norm)
  if (inFlight) {
    return inFlight
  }

  const taskPromise = enqueue(async () => {
    try {
      const res = await pb.send<{ ok: boolean; photoUrl: string | null }>(
        `/backend/v1/whatsapp/profile-photo?phone=${encodeURIComponent(norm)}`,
        {
          method: 'GET',
        },
      )
      const photoUrl = res && res.photoUrl ? res.photoUrl : null
      setCachedProfilePhoto(norm, photoUrl)
      return photoUrl
    } catch (err) {
      // Em caso de falha de rede/backend, grava null no cache temporário para não floodar chamadas
      console.warn(`[fetchProfilePhoto] Falha silenciosa para ${norm}:`, err)
      setCachedProfilePhoto(norm, null)
      return null
    }
  })

  const wrapped = taskPromise.finally(() => {
    inFlightRequests.delete(norm)
  })

  inFlightRequests.set(norm, wrapped)
  return wrapped
}
