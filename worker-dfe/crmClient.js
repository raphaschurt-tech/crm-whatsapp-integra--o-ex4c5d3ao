/**
 * worker-dfe/crmClient.js
 * Cliente HTTP para comunicação com as rotas customizadas do CRM (CF-1b, CF-1c, CF-2d)
 * O worker SÓ faz chamadas de saída ao CRM através destas rotas autenticadas por Token DFe dedicado.
 */

const axios = require('axios')

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

  async recordHistory(data) {
    try {
      const res = await axios.post(this.buildUrl('/backend/v1/dfe/history'), data, {
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

  async ingestXml(xmlString) {
    try {
      const res = await axios.post(
        this.buildUrl('/backend/v1/dfe/ingest'),
        { xml: xmlString },
        { headers: this.getHeaders(), timeout: 30000 },
      )
      return res.data
    } catch (err) {
      const status = err.response ? err.response.status : null
      const resData = err.response ? err.response.data : null
      throw new Error(`[CRM-INGEST-ERR ${status}] ${JSON.stringify(resData || err.message)}`)
    }
  }
}

module.exports = CrmClient
