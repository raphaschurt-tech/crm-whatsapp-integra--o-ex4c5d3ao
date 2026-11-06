/**
 * worker-dfe/crmClient.js
 * Cliente HTTP para comunicação com as rotas customizadas do CRM (CF-1b, CF-1c, CF-2d)
 * O worker SÓ faz chamadas de saída ao CRM através destas rotas autenticadas por Token DFe dedicado.
 *
 * FIX HEAP-OOM (ingest com retry):
 * O timeout do ingest sobe para 90s (timeout de processamento do CRM). Em [CRM-INGEST-ERR]
 * de TIMEOUT (ECONNABORTED / ECONNRESET) o erro é RETRYABLE: até 2 novas tentativas com
 * espera de 30s entre elas. O documento NUNCA é descartado por timeout — se todas as
 * tentativas falharem, o erro é relançado e o ciclo encerra; o ponteiro não avança e o
 * documento é reprocessado no PRÓXIMO ciclo (dedupe por chave de acesso no CRM evita
 * duplicação).
 *
 * FIX BUG 0.0.276 (build quebrado): as atribuições dos ganchos de teste
 * (CrmClient.INGEST_TIMEOUT_MS etc.) estavam ANTES da declaração da classe — TDZ
 * "Cannot access 'CrmClient' before initialization" em crmClient.js linha 38.
 * Agora TODOS os ganchos são atribuídos DEPOIS do bloco `class CrmClient { ... }`
 * (ver bloco "Ganchos de teste" no fim do arquivo) — nada executa antes da
 * declaração da classe.
 */

let axios = null
try {
  axios = require('axios')
} catch (_) {}

const RETRYABLE_AXIOS_ERROR_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT'])

function isRetryableError(err) {
  if (!err) return false
  if (RETRYABLE_AXIOS_ERROR_CODES.has(err.code)) return true
  // Erros reempacotados como [CRM-XXX-ERR undefined] preservam o código original
  // no JSON embutido na mensagem — detectar timeout de request
  const msg = String(err.message || '')
  return /ECONNABORTED|ECONNRESET|ETIMEDOUT|timeout/i.test(msg) && /CRM-.*-ERR/i.test(msg)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// FIX HEAP-OOM (item 4): ingest com timeout de 90s (era 30s) + 2 tentativas
// adicionais com espera de 30s entre elas em caso de TIMEOUT do CRM.
const INGEST_TIMEOUT_MS = 90000
const INGEST_MAX_RETRIES = 2
const INGEST_RETRY_WAIT_MS = 30000

class CrmClient {
  constructor(baseUrl, token) {
    this.baseUrl = (baseUrl || 'http://127.0.0.1:8090').replace(/\/$/, '')
    this.token = token || ''
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-DFe-Token': this.token,
    }
  }

  buildUrl(endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const separator = cleanEndpoint.includes('?') ? '&' : '?'
    const query = this.token ? `${separator}dfe_token=${encodeURIComponent(this.token)}` : ''
    return `${this.baseUrl}${cleanEndpoint}${query}`
  }

  async getStatus() {
    try {
      const res = await axios.get(this.buildUrl('/backend/v1/dfe/status'), {
        headers: this.getHeaders(),
        timeout: 10000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const data = err.response ? err.response.data : null
      throw new Error(`[CRM-STATUS-ERR ${status}] ${JSON.stringify(data || err.message)}`)
    }
  }

  async updatePointer(data) {
    try {
      const res = await axios.post(this.buildUrl('/backend/v1/dfe/pointer'), data, {
        headers: this.getHeaders(),
        timeout: 10000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-POINTER-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async getPendingCommands() {
    try {
      const res = await axios.get(this.buildUrl('/backend/v1/dfe/commands'), {
        headers: this.getHeaders(),
        timeout: 10000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-CMD-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async acknowledgeCommand(cmdId, status, summary) {
    try {
      const res = await axios.post(
        this.buildUrl(`/backend/v1/dfe/commands/${cmdId}/ack`),
        { status, result_summary: summary },
        { headers: this.getHeaders(), timeout: 10000 },
      )
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-CMD-ACK-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async reportKeyDownload(data) {
    try {
      const res = await axios.post(this.buildUrl('/backend/v1/dfe/key-download'), data, {
        headers: this.getHeaders(),
        timeout: 30000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-KEY-DOWNLOAD-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async recordHistory(data) {
    try {
      const payload = { ...data }
      if (payload.nsu === undefined || payload.nsu === null || String(payload.nsu).trim() === '') {
        payload.nsu = '0'
      }
      const res = await axios.post(this.buildUrl('/backend/v1/dfe/history'), payload, {
        headers: this.getHeaders(),
        timeout: 15000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-HIST-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async recordEvent(data) {
    try {
      const res = await axios.post(this.buildUrl('/backend/v1/dfe/event'), data, {
        headers: this.getHeaders(),
        timeout: 15000,
      })
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-EVENT-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }

  async ingestXml(xmlString, nsu = '') {
    const attemptOnce = async (attemptNo) => {
      try {
        const res = await axios.post(
          this.buildUrl('/backend/v1/dfe/ingest'),
          { xml: xmlString, nsu: nsu },
          { headers: this.getHeaders(), timeout: INGEST_TIMEOUT_MS },
        )
        return res.data
      } catch (err) {
        const status = err.response ? err.response.status : null
        const resData = err.response ? err.response.data : null
        const wrapped = new Error(
          `[CRM-INGEST-ERR ${status}]${attemptNo > 1 ? ` (tentativa ${attemptNo}/${INGEST_MAX_RETRIES + 1})` : ''} ${JSON.stringify(resData || err.message)}`,
        )
        // Preservar o código original do erro (ex.: ECONNABORTED) para classificação de retry
        if (err.code && !wrapped.code) wrapped.code = err.code
        throw wrapped
      }
    }

    try {
      return await attemptOnce(1)
    } catch (firstErr) {
      // Erro não-retryable (resposta HTTP do CRM, ex.: 4xx/5xx sem timeout): relança direto
      if (!isRetryableError(firstErr)) throw firstErr
      console.warn(
        `[CRM-INGEST-RETRY] TIMEOUT no ingest do CRM (CRM-INGEST-ERR) — documento NÃO é descartado. Serão feitas até ${INGEST_MAX_RETRIES} novas tentativas com ${INGEST_RETRY_WAIT_MS / 1000}s de espera.`,
      )
    }

    let lastErr = null
    for (let attempt = 2; attempt <= INGEST_MAX_RETRIES + 1; attempt++) {
      // __sleep é o gancho de teste (test-oom-restart acelera a espera de 30s);
      // em produção é sempre o sleep padrão de 30s.
      await (CrmClient.__sleep || sleep)(INGEST_RETRY_WAIT_MS)
      try {
        return await attemptOnce(attempt)
      } catch (retryErr) {
        lastErr = retryErr
        if (!isRetryableError(retryErr)) throw retryErr
      }
    }

    // Esgotadas as tentativas: o documento NÃO é descartado — o erro é relançado,
    // o ponteiro não avança e o documento é reprocessado no PRÓXIMO ciclo
    // (dedupe por chave de acesso no CRM evita duplicação).
    console.error(
      `[CRM-INGEST-ERR-TIMEOUT] Ingest falhou por timeout após ${INGEST_MAX_RETRIES + 1} tentativa(s). Documento NÃO descartado: será reprocessado no próximo ciclo.`,
    )
    throw lastErr
  }
}

// Ganchos de teste: permitem acelerar a espera entre tentativas e interceptar o
// axios nos testes sem tocar nos tempos reais de produção (padrão = sem efeito).
// Atribuídos APÓS a declaração da classe (FIX BUG 0.0.276 — antes estavam ANTES
// da declaração e causavam TDZ "Cannot access 'CrmClient' before initialization").
CrmClient.INGEST_TIMEOUT_MS = INGEST_TIMEOUT_MS
CrmClient.INGEST_MAX_RETRIES = INGEST_MAX_RETRIES
CrmClient.INGEST_RETRY_WAIT_MS = INGEST_RETRY_WAIT_MS
CrmClient.__sleep = sleep
CrmClient.__setSleepImpl = function (fn) {
  CrmClient.__sleep = fn || sleep
}

module.exports = CrmClient
module.exports.__getAxios = function () {
  return axios
}
module.exports.__setAxios = function (ax) {
  axios = ax
}
module.exports.__isRetryableError = isRetryableError
