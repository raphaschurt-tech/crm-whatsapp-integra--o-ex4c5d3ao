/**
 * Helper para execução resiliente de chamadas assíncronas com tentativas automáticas (retries)
 * e backoff exponencial com jitter, projetado especialmente para cold start de instâncias
 * ou falhas transitórias de rede ("Failed to fetch", status 502/503/504, timeouts).
 */

export interface RetryOptions {
  retries?: number
  delayMs?: number
  backoffFactor?: number
  maxDelayMs?: number
  isRetryable?: (error: unknown) => boolean
}

export function isNetworkOrServerError(error: unknown): boolean {
  if (!error) return false

  // Se for TypeError com mensagem contendo "fetch" ou "network"
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('load failed') ||
      msg.includes('aborted')
    ) {
      return true
    }
  }

  // PocketBase ClientResponseError ou respostas com status HTTP
  if (typeof error === 'object' && error !== null) {
    const errObj = error as {
      status?: number
      isAbort?: boolean
      originalError?: unknown
      message?: string
    }

    // Status 0 ou N/A (requisição não completou)
    if (errObj.status === 0 || errObj.status === undefined) {
      const msg = (errObj.message || '').toLowerCase()
      if (
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('timeout')
      ) {
        return true
      }
    }

    // Status de cold start / gateway temporariamente indisponível
    if (
      errObj.status === 502 ||
      errObj.status === 503 ||
      errObj.status === 504 ||
      errObj.status === 408
    ) {
      return true
    }

    // Verifica erro original interno
    if (errObj.originalError && isNetworkOrServerError(errObj.originalError)) {
      return true
    }
  }

  return false
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 2,
    delayMs = 1000,
    backoffFactor = 2,
    maxDelayMs = 5000,
    isRetryable = isNetworkOrServerError,
  } = options

  let attempt = 0
  let currentDelay = delayMs

  while (true) {
    try {
      return await fn()
    } catch (error) {
      attempt++
      if (attempt > retries || !isRetryable(error)) {
        throw error
      }

      console.warn(`[Network Retry] Tentativa ${attempt} de ${retries} após erro de rede:`, error)
      await new Promise((resolve) => setTimeout(resolve, currentDelay))
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs)
    }
  }
}
