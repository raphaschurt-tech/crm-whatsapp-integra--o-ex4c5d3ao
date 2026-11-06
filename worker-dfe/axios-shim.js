/**
 * worker-dfe/axios-shim.js
 * Fornece um axios mínimo (get/post com resposta { data, status }) para os testes
 * locais do worker (test-oom-restart.js / test-simulation.js) quando o pacote real
 * axios não está instalado no ambiente de execução dos testes.
 *
 * O worker real (worker-dfe no servidor do usuário) sempre instala axios via
 * npm install conforme worker-dfe/package.json — este shim é SOMENTE para os testes.
 */

function makeResponse(data, status = 200) {
  return { data, status, statusText: 'OK', headers: {} }
}

function makeError(message, code) {
  const err = new Error(message)
  err.code = code || 'ECONNABORTED'
  err.isAxiosError = true
  return err
}

const axiosInstance = {
  get: async function (url, cfg) {
    if (url.includes('/dfe/status')) {
      // Resposta padrão de status — os testes sobrescrevem CrmClient.prototype.getStatus,
      // então este corpo só atende chamadas diretas não interceptadas.
      return makeResponse({
        dfe_enabled: true,
        company_cnpj: '00496593000129',
        pointer: { ult_nsu: '000000000000002', max_nsu: '000000000000057', is_initialized: true },
        poll_interval_hours: 1,
      })
    }
    if (url.includes('/dfe/commands')) return makeResponse({ commands: [] })
    throw makeError(`axios-shim: GET não mockado para ${url}`, 'ENOTMOCKED')
  },
  post: async function (url, body, cfg) {
    if (url.includes('/dfe/pointer')) return makeResponse({ success: true })
    if (url.includes('/dfe/history')) return makeResponse({ success: true })
    if (url.includes('/dfe/event')) return makeResponse({ success: true })
    if (url.includes('/dfe/commands') && /\/ack$/.test(url)) return makeResponse({ success: true })
    if (url.includes('/dfe/key-download')) return makeResponse({ success: true })
    if (url.includes('/dfe/ingest')) {
      return makeResponse({ success: true, processed: true, duplicate: false })
    }
    throw makeError(`axios-shim: POST não mockado para ${url}`, 'ENOTMOCKED')
  },
}

const axiosShim = Object.assign(function axiosFn() {
  return axiosInstance
}, axiosInstance)

axiosShim.default = axiosShim
axiosShim.create = function () {
  return axiosInstance
}
axiosShim.isAxiosError = (e) => Boolean(e && e.isAxiosError)

module.exports = axiosShim
