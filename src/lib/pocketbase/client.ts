import PocketBase from 'pocketbase'
import { isNetworkOrServerError } from '@/lib/retry'

/**
 * Custom fetch wrapper with automatic retry for cold starts and transient network drops.
 * If the request fails with "Failed to fetch" or 502/503/504, it retries up to 2 times
 * before throwing to the caller.
 */
const fetchWithRetry: typeof fetch = async (input, init) => {
  const maxRetries = 2
  let delay = 1000

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init)
      // Se for 502/503/504 (cold start ou proxy ainda acordando), tenta novamente
      if (
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        attempt < maxRetries
      ) {
        console.warn(
          `[PocketBase Fetch] Cold start HTTP ${response.status}. Retrying attempt ${attempt + 1}/${maxRetries}...`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2
        continue
      }
      return response
    } catch (err) {
      if (attempt < maxRetries && isNetworkOrServerError(err)) {
        console.warn(
          `[PocketBase Fetch] Network error: ${(err as Error)?.message}. Retrying attempt ${attempt + 1}/${maxRetries}...`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2
        continue
      }
      throw err
    }
  }

  return fetch(input, init)
}

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.beforeSend = (url, options) => {
  options.fetch = fetchWithRetry
  return { url, options }
}
pb.autoCancellation(false)

export default pb
