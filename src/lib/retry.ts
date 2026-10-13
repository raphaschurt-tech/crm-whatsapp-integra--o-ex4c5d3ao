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

    // Status de cold start / gateway temporariamente indisponível ou 429 Too Many Requests
    if (
      errObj.status === 429 ||
      errObj.status === 502 ||
      errObj.status === 503 ||
      errObj.status === 504 ||
      errObj.status === 408
    ) {
      return true
    }

    const msg = (errObj.message || '').toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests')) {
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
    retries = 3,
    delayMs = 1000,
    backoffFactor = 2,
    maxDelayMs = 6000,
    isRetryable = isNetworkOrServerError,
  } = options

  let attempt = 0
  let currentDelay = delayMs

  while (true) {
    try {
      return await fn()
    } catch (error: any) {
      attempt++
      if (attempt > retries || !isRetryable(error)) {
        throw error
      }

      const status = error?.status ?? error?.response?.status
      const is429 = status === 429 || (error?.message || '').includes('429')

      // Verificar se a resposta 429 traz header Retry-After (em segundos ou date)
      let retryAfterMs: number | null = null
      const responseHeaders =
        error?.response?.headers || error?.originalError?.response?.headers || error?.headers

      if (responseHeaders) {
        let retryAfterVal: string | null = null
        if (typeof responseHeaders.get === 'function') {
          retryAfterVal = responseHeaders.get('retry-after') || responseHeaders.get('Retry-After')
        } else if (typeof responseHeaders === 'object') {
          retryAfterVal = responseHeaders['retry-after'] || responseHeaders['Retry-After'] || null
        }

        if (retryAfterVal) {
          const parsedSec = parseFloat(retryAfterVal)
          if (!isNaN(parsedSec) && parsedSec > 0) {
            retryAfterMs = parsedSec * 1000
          } else {
            const parsedDate = new Date(retryAfterVal).getTime()
            if (!isNaN(parsedDate) && parsedDate > Date.now()) {
              retryAfterMs = parsedDate - Date.now()
            }
          }
        }
      }

      let waitTime: number
      if (is429 && retryAfterMs !== null) {
        // Respeita o Retry-After informado pelo servidor
        waitTime = Math.min(retryAfterMs, maxDelayMs)
      } else if (is429) {
        // Backoff exponencial com jitter aleatório (1s ± 30%, 2s ± 30%, 4s ± 30%)
        // Tentativa 1: 1000ms * (0.7 ~ 1.3)
        // Tentativa 2: 2000ms * (0.7 ~ 1.3)
        // Tentativa 3: 4000ms * (0.7 ~ 1.3)
        const nominalMs = 1000 * Math.pow(backoffFactor, attempt - 1)
        const jitterFactor = 0.7 + Math.random() * 0.6 // ±30%
        waitTime = Math.min(nominalMs * jitterFactor, maxDelayMs)
      } else {
        const jitter = (Math.random() - 0.5) * 0.6 * currentDelay // ±30%
        waitTime = Math.min(Math.max(currentDelay + jitter, 100), maxDelayMs)
      }

      console.warn(
        `[CONV-LOAD] [Network Retry] Tentativa ${attempt} de ${retries} após erro (status: ${
          status || 'desconhecido'
        }, 429: ${is429}, aguardando ${Math.round(waitTime)}ms):`,
        error?.message || error,
      )
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs)
    }
  }
}
