/**
 * worker-dfe/dfeAdapter.js
 * Interface com a SEFAZ (NT 2014.002 - NFeDistribuicaoDFe) utilizando a API oficial de classe NFeWizard-io.
 * Causa raiz resolvida: nfewizard-io v1.0.0+ exporta uma classe default (NFeWizard = require('nfewizard-io').default || require('nfewizard-io')).
 * Métodos: wizard.NFE_LoadEnvironment({ config: ... }) e wizard.NFE_DistribuicaoDFePorNSU({ ultNSU }).
 *
 * MODO REAL AUTOMÁTICO:
 * - Sempre que a biblioteca carregar com sucesso, opera em modo 'real'.
 * - Fallback para 'simulacao' APENAS se o require/inicialização falhar, com log alto e visível:
 *   [DFE-MODE] real  ou  [DFE-MODE] simulacao (com motivo).
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { XMLParser } = require('fast-xml-parser')

class DfeAdapter {
  constructor(config) {
    this.config = config || {}
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    })
    this.wizardInstance = null
    this.isWizardLoaded = false
    this.mode = 'simulacao'
    this.modeReason = 'Inicialização pendente'
  }

  /**
   * Tenta carregar e instanciar o NFeWizard-io (API de classe v1.0.0+)
   */
  async initWizard() {
    if (this.isWizardLoaded && this.wizardInstance) {
      return true
    }

    try {
      let NFeWizardLib = null
      try {
        const requiredMod = require('nfewizard-io')
        NFeWizardLib = requiredMod.default || requiredMod
      } catch (reqErr) {
        this.mode = 'simulacao'
        this.modeReason = `Biblioteca 'nfewizard-io' não encontrada no node_modules (${reqErr.message}). Execute: npm install nfewizard-io @nfewizard/shared`
        return false
      }

      if (typeof NFeWizardLib !== 'function') {
        this.mode = 'simulacao'
        this.modeReason = `Export da biblioteca 'nfewizard-io' não é uma classe/construtor (${typeof NFeWizardLib})`
        return false
      }

      const wizard = new NFeWizardLib()
      if (typeof wizard.NFE_LoadEnvironment !== 'function') {
        this.mode = 'simulacao'
        this.modeReason = `Instância NFeWizard não possui o método NFE_LoadEnvironment`
        return false
      }

      // Resolver caminho absoluto do certificado PFX
      const pfxPath = path.resolve(
        process.cwd(),
        this.config.certPfxPath || './certs/certificado.pfx',
      )
      if (!fs.existsSync(pfxPath)) {
        this.mode = 'simulacao'
        this.modeReason = `Certificado PFX não encontrado no caminho: ${pfxPath}`
        return false
      }

      const tmpDistDir = path.resolve(process.cwd(), 'tmp/DistribuicaoDFe')
      try {
        if (!fs.existsSync(tmpDistDir)) {
          fs.mkdirSync(tmpDistDir, { recursive: true })
        }
      } catch (_) {}

      const cleanCnpj = String(this.config.cnpj || '').replace(/\D/g, '')
      const ambienteStr = String(this.config.ambiente || '1') // '1' = Produção
      const ufStr = String(this.config.uf || '35')

      await wizard.NFE_LoadEnvironment({
        config: {
          ambiente: ambienteStr,
          UF: ufStr,
          CNPJ: cleanCnpj,
          certificado: pfxPath,
          senha: this.config.certPassword || '',
          dfe: {
            baixarXMLDistribuicao: true,
            pathXMLDistribuicao: tmpDistDir,
          },
        },
      })

      this.wizardInstance = wizard
      this.isWizardLoaded = true
      this.mode = 'real'
      this.modeReason = 'Conexão SEFAZ oficial ativa via NFeWizard-io'
      return true
    } catch (loadErr) {
      this.wizardInstance = null
      this.isWizardLoaded = false
      this.mode = 'simulacao'
      this.modeReason = `Falha ao carregar ambiente NFeWizard: ${loadErr.message}`
      return false
    }
  }

  /**
   * Retorna o modo atual de operação ('real' ou 'simulacao')
   */
  getMode() {
    return {
      mode: this.mode,
      reason: this.modeReason,
    }
  }

  /**
   * Executa a consulta NFeDistribuicaoDFe por ultNSU (NT 2014.002)
   */
  async consultarPorUltNsu(ultNsu) {
    const formattedNsu = String(ultNsu || '0').padStart(15, '0')

    // Tentar inicializar NFeWizard oficial
    await this.initWizard()

    // Log OBRIGATÓRIO alto e visível em TODO ciclo
    if (this.mode === 'real') {
      console.log(
        `[DFE-MODE] real | SEFAZ Produção Oficial (NFeWizard-io) | ultNSU: ${formattedNsu}`,
      )
    } else {
      console.warn(`[DFE-MODE] simulacao | Motivo: ${this.modeReason} | ultNSU: ${formattedNsu}`)
    }

    try {
      if (this.mode === 'real' && this.wizardInstance) {
        console.log(
          `[DFE-POLL-QUERY] Consultando SEFAZ Nacional via NFE_DistribuicaoDFePorNSU (ultNSU: ${formattedNsu})...`,
        )
        const result = await this.wizardInstance.NFE_DistribuicaoDFePorNSU({
          ultNSU: formattedNsu,
        })
        return this.parseWizardResponse(result, formattedNsu)
      }

      // Fallback para simulação
      return this.mockSefazResponse(formattedNsu)
    } catch (err) {
      console.error('[DFE-SEFAZ-ERR]', err.message)
      throw err
    }
  }

  /**
   * Mapeia a resposta real retornada pela NFeWizard-io (retDistDFeInt / docZip)
   * para o formato uniforme que o ciclo já consome:
   * { cStat, xMotivo, ultNSU, maxNSU, docs: [{ nsu, schema, accessKey, model, rawXml, ... }] }
   */
  parseWizardResponse(rawResponse, fallbackNsu) {
    if (!rawResponse) {
      return {
        cStat: '137',
        xMotivo: 'Resposta vazia da SEFAZ',
        ultNSU: fallbackNsu,
        maxNSU: fallbackNsu,
        docs: [],
      }
    }

    const retDist = rawResponse.retDistDFeInt || rawResponse.distDFeInt || rawResponse

    const cStat = String(retDist.cStat || rawResponse.cStat || '137')
    const xMotivo = String(retDist.xMotivo || rawResponse.xMotivo || '')
    const ultNSU = String(retDist.ultNSU || rawResponse.ultNSU || fallbackNsu)
    const maxNSU = String(retDist.maxNSU || rawResponse.maxNSU || ultNSU)

    const docs = []
    const lote = retDist.loteDistDFeInt || rawResponse.loteDistDFeInt

    if (lote && lote.docZip) {
      const docZipArray = Array.isArray(lote.docZip) ? lote.docZip : [lote.docZip]

      for (const item of docZipArray) {
        if (!item) continue

        const schema = item['@_schema'] || item.schema || ''
        const nsu = item['@_NSU'] || item.NSU || ''
        let base64Content = item['#text'] || item.content || item

        if (typeof base64Content === 'object' && base64Content !== null) {
          base64Content = base64Content['#text'] || ''
        }

        let unzippedXml = ''
        try {
          if (typeof base64Content === 'string' && base64Content.trim()) {
            const zipBuffer = Buffer.from(base64Content.trim(), 'base64')
            unzippedXml = zlib.gunzipSync(zipBuffer).toString('utf-8')
          }
        } catch (unzipErr) {
          // Se não estiver comprimido em gzip, pode ser o próprio XML bruto
          if (typeof base64Content === 'string' && base64Content.includes('<')) {
            unzippedXml = base64Content
          } else {
            console.error(`[DFE-UNZIP-ERR] Falha ao descompactar NSU ${nsu}: ${unzipErr.message}`)
            continue
          }
        }

        if (unzippedXml) {
          const docParsed = this.analyzeUnzippedDoc(unzippedXml, schema, nsu)
          docs.push(docParsed)
        }
      }
    }

    return {
      cStat,
      xMotivo,
      ultNSU,
      maxNSU,
      docs,
    }
  }

  /**
   * Analisa documento descompactado (NF-e, resumo, evento)
   */
  analyzeUnzippedDoc(xmlString, schema, nsu) {
    const isSummary = schema.includes('resNFe') || xmlString.includes('<resNFe')
    const isFullNfe =
      schema.includes('procNFe') || xmlString.includes('<nfeProc') || xmlString.includes('<NFe')
    const isEvent =
      schema.includes('procEvento') ||
      xmlString.includes('<procEventoNFe') ||
      xmlString.includes('<retEnvEvento') ||
      xmlString.includes('<infEvento')

    let accessKey = ''
    let emitterCnpj = ''
    let emitterName = ''
    let issueDate = ''
    let totalAmount = 0
    let nfeNumber = ''
    let model = '55'
    let eventType = ''
    let eventSeq = 1
    let justification = ''
    let protocol = ''

    // Extração da chave de acesso (44 dígitos)
    const chMatch =
      xmlString.match(/<chNFe>([0-9]{44})<\/chNFe>/i) ||
      xmlString.match(/Id=["']NFe([0-9]{44})["']/i) ||
      xmlString.match(/chNFe=([0-9]{44})/i)
    if (chMatch) accessKey = chMatch[1]

    if (accessKey && accessKey.length === 44) {
      model = accessKey.slice(20, 22)
    }

    const cnpjMatch = xmlString.match(/<CNPJ>([0-9]{14})<\/CNPJ>/i)
    if (cnpjMatch) emitterCnpj = cnpjMatch[1]

    const nomeMatch = xmlString.match(/<xNome>([^<]+)<\/xNome>/i)
    if (nomeMatch) emitterName = nomeMatch[1]

    const dhMatch =
      xmlString.match(/<dhEmi>([^<]+)<\/dhEmi>/i) || xmlString.match(/<dEmi>([^<]+)<\/dEmi>/i)
    if (dhMatch) issueDate = dhMatch[1]

    const vNfMatch = xmlString.match(/<vNF>([^<]+)<\/vNF>/i)
    if (vNfMatch) totalAmount = parseFloat(vNfMatch[1]) || 0

    const nNfMatch = xmlString.match(/<nNF>([^<]+)<\/nNF>/i)
    if (nNfMatch) nfeNumber = nNfMatch[1]

    if (isEvent) {
      const tpEventoMatch = xmlString.match(/<tpEvento>([0-9]+)<\/tpEvento>/i)
      if (tpEventoMatch) eventType = tpEventoMatch[1]

      const seqMatch = xmlString.match(/<nSeqEvento>([0-9]+)<\/nSeqEvento>/i)
      if (seqMatch) eventSeq = parseInt(seqMatch[1], 10) || 1

      const xJustMatch = xmlString.match(/<xJust>([^<]+)<\/xJust>/i)
      if (xJustMatch) justification = xJustMatch[1]

      const nProtMatch = xmlString.match(/<nProt>([^<]+)<\/nProt>/i)
      if (nProtMatch) protocol = nProtMatch[1]
    }

    return {
      nsu,
      schema,
      accessKey,
      model,
      emitterCnpj,
      emitterName,
      issueDate,
      totalAmount,
      nfeNumber,
      isSummary,
      isFullNfe,
      isEvent,
      eventType,
      eventSeq,
      justification,
      protocol,
      rawXml: xmlString,
    }
  }

  /**
   * Mock / Ensaio para validação quando NFeWizard não estiver instalado
   */
  mockSefazResponse(ultNsu) {
    const currentNsu = parseInt(ultNsu, 10) || 0
    if (currentNsu === 0) {
      return {
        cStat: '138',
        xMotivo: 'Documentos localizados (ensaio)',
        ultNSU: '000000000000002',
        maxNSU: '000000000000002',
        docs: [
          {
            nsu: '000000000000001',
            schema: 'resNFe_v1.01.xsd',
            accessKey: '35250111222333000199550010000012341000012341',
            model: '55',
            emitterCnpj: '11222333000199',
            emitterName: 'FORNECEDOR HISTORICO SOU.IS PEÇAS LTDA',
            issueDate: '2024-05-10T14:30:00-03:00',
            totalAmount: 1850.5,
            nfeNumber: '1234',
            isSummary: true,
            isFullNfe: false,
            isEvent: false,
            rawXml:
              '<resNFe><chNFe>35250111222333000199550010000012341000012341</chNFe><vNF>1850.50</vNF></resNFe>',
          },
          {
            nsu: '000000000000002',
            schema: 'resNFe_v1.01.xsd',
            accessKey: '35250122333444000188550010000056781000056782',
            model: '55',
            emitterCnpj: '22333444000188',
            emitterName: 'DISTRIBUIDORA DE AUTO PEÇAS BRASIL S/A',
            issueDate: '2024-08-15T10:15:00-03:00',
            totalAmount: 3200.0,
            nfeNumber: '5678',
            isSummary: true,
            isFullNfe: false,
            isEvent: false,
            rawXml:
              '<resNFe><chNFe>35250122333444000188550010000056781000056782</chNFe><vNF>3200.00</vNF></resNFe>',
          },
        ],
      }
    }

    return {
      cStat: '137',
      xMotivo: 'Nenhum documento localizado para o NSU informado',
      ultNSU: ultNsu,
      maxNSU: ultNsu,
      docs: [],
    }
  }
}

module.exports = DfeAdapter
