/**
 * worker-dfe/dfeAdapter.js
 * Interface com a SEFAZ (NT 2014.002 - NFeDistribuicaoDFe) utilizando a API oficial de classe NFeWizard-io.
 * Causa raiz resolvida: nfewizard-io v1.0.0+ exporta uma classe default (NFeWizard = require('nfewizard-io').default || require('nfewizard-io')).
 * Métodos: wizard.NFE_LoadEnvironment({ config: ... }) e wizard.NFE_DistribuicaoDFePorNSU({ cUFAutor, CNPJ, distNSU: { ultNSU } }).
 *
 * MODO REAL AUTOMÁTICO:
 * - Sempre que a biblioteca carregar com sucesso, opera em modo 'real'.
 * - Fallback para 'simulacao' APENAS se o require/inicialização falhar, com log alto e visível:
 *   [DFE-MODE] real  ou  [DFE-MODE] simulacao (com motivo).
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const tls = require('tls')
const https = require('https')
const crypto = require('crypto')
const { XMLParser } = require('fast-xml-parser')

/**
 * Cache global da cadeia ICP-Brasil em memória
 */
let icpBrasilCertsCache = null
let icpBrasilPemBundleCache = null

/**
 * Resolve os possíveis diretórios onde a cadeia ICP-Brasil reside no ambiente
 */
function resolveIcpBrasilCertsDirs() {
  const candidates = [
    // 1. Pacote @nfewizard/shared instalado em node_modules
    path.resolve(process.cwd(), 'node_modules/@nfewizard/shared/resources/certs'),
    path.resolve(__dirname, 'node_modules/@nfewizard/shared/resources/certs'),
    path.resolve(__dirname, '../node_modules/@nfewizard/shared/resources/certs'),
    // 2. Pasta local resources/certs caso copiada no worker
    path.resolve(__dirname, 'resources/certs'),
    path.resolve(process.cwd(), 'resources/certs'),
    // 3. Fallback para require.resolve caso disponível
  ]

  try {
    const sharedPkgPath = require.resolve('@nfewizard/shared/package.json')
    const sharedDir = path.dirname(sharedPkgPath)
    candidates.unshift(path.resolve(sharedDir, 'resources/certs'))
  } catch (_) {}

  return candidates
}

/**
 * Carrega e converte certificados da cadeia ICP-Brasil para PEM
 * Converte DER (.crt/.cer binário) ou lê PEM (.pem/.crt texto)
 * Utiliza crypto.X509Certificate (suporta Buffer DER e string PEM)
 */
function loadIcpBrasilCaBundle() {
  if (icpBrasilCertsCache !== null) {
    return {
      certs: icpBrasilCertsCache,
      pemBundle: icpBrasilPemBundleCache,
      count: icpBrasilCertsCache.length,
    }
  }

  const dirs = resolveIcpBrasilCertsDirs()
  let targetDir = null
  for (const dir of dirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      targetDir = dir
      break
    }
  }

  const loadedCerts = []
  const pemParts = []

  if (targetDir) {
    try {
      const files = fs.readdirSync(targetDir).filter((f) => !f.startsWith('.'))
      for (const file of files) {
        const filePath = path.join(targetDir, file)
        try {
          const buf = fs.readFileSync(filePath)
          let pemString = ''

          // Se já for PEM legível
          const text = buf.toString('utf8')
          if (text.includes('-----BEGIN CERTIFICATE-----')) {
            pemString = text
          } else {
            // Conversão DER -> PEM via crypto.X509Certificate
            const x509 = new crypto.X509Certificate(buf)
            pemString = x509.toString()
          }

          if (pemString && pemString.includes('-----BEGIN CERTIFICATE-----')) {
            loadedCerts.push(Buffer.from(pemString))
            pemParts.push(pemString.trim())
          }
        } catch (err) {
          // Erro silencioso em arquivo individual corrompido ou não certificado
        }
      }
    } catch (readErr) {
      console.warn(
        `[DFE-TLS-WARN] Falha ao varrer diretório de certificados (${targetDir}): ${readErr.message}`,
      )
    }
  }

  // Também verificar se existe arquivo consolidado local icp-brasil-ca.pem
  const localPemPath = path.resolve(__dirname, 'icp-brasil-ca.pem')
  if (loadedCerts.length === 0 && fs.existsSync(localPemPath)) {
    try {
      const localPem = fs.readFileSync(localPemPath, 'utf8')
      const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
      const matches = localPem.match(regex) || []
      for (const m of matches) {
        loadedCerts.push(Buffer.from(m))
        pemParts.push(m)
      }
    } catch (_) {}
  }

  icpBrasilCertsCache = loadedCerts
  icpBrasilPemBundleCache = pemParts.join('\n\n')

  return {
    certs: icpBrasilCertsCache,
    pemBundle: icpBrasilPemBundleCache,
    count: icpBrasilCertsCache.length,
    dirUsed: targetDir,
  }
}

/**
 * Injeta o bundle ICP-Brasil na confiança TLS global do processo Node.js
 * e configura https.globalAgent.options.ca
 */
function applyIcpBrasilTlsTrust() {
  const { certs, count } = loadIcpBrasilCaBundle()

  // Log diagnóstico OBRIGATÓRIO (Item 4 do FIX)
  console.log(`[DFE-TLS] CAs ICP-Brasil carregados: ${count}`)

  if (count > 0) {
    try {
      const rootCerts = (tls.rootCertificates || []).map((c) => Buffer.from(c))
      const combinedBundle = [...rootCerts, ...certs]

      // 1. Injetar no globalAgent padrão do https
      if (!https.globalAgent.options) {
        https.globalAgent.options = {}
      }
      https.globalAgent.options.ca = combinedBundle

      // 2. Garantir que NODE_EXTRA_CA_CERTS seja apontado caso exista o pem
      const pemPath = path.resolve(__dirname, 'icp-brasil-ca.pem')
      if (fs.existsSync(pemPath) && !process.env.NODE_EXTRA_CA_CERTS) {
        process.env.NODE_EXTRA_CA_CERTS = pemPath
      }
    } catch (e) {
      console.warn(`[DFE-TLS-WARN] Falha ao configurar https.globalAgent.options.ca: ${e.message}`)
    }
  } else {
    console.warn(
      `[DFE-TLS-WARN] Nenhum certificado ICP-Brasil foi carregado de @nfewizard/shared/resources/certs. ` +
        `Certifique-se de executar 'npm install' no worker.`,
    )
  }

  return { count, certs }
}

/**
 * Constrói ou atualiza o arquivo icp-brasil-ca.pem para ser usado via NODE_EXTRA_CA_CERTS
 */
function buildIcpBrasilCaFile(targetPath) {
  const outPath = targetPath || path.resolve(__dirname, 'icp-brasil-ca.pem')
  const { pemBundle, count } = loadIcpBrasilCaBundle()
  if (count > 0 && pemBundle) {
    fs.writeFileSync(outPath, pemBundle, 'utf8')
    console.log(`[DFE-TLS] Arquivo bundle gerado com sucesso: ${outPath} (${count} certificados)`)
    return true
  }
  return false
}

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
    this.cleanCnpj = String(this.config.cnpj || '').replace(/\D/g, '')

    const ufMap = {
      11: 'RO',
      12: 'AC',
      13: 'AM',
      14: 'RR',
      15: 'PA',
      16: 'AP',
      17: 'TO',
      21: 'MA',
      22: 'PI',
      23: 'CE',
      24: 'RN',
      25: 'PB',
      26: 'PE',
      27: 'AL',
      28: 'SE',
      29: 'BA',
      31: 'MG',
      32: 'ES',
      33: 'RJ',
      35: 'SP',
      41: 'PR',
      42: 'SC',
      43: 'RS',
      50: 'MS',
      51: 'MT',
      52: 'GO',
      53: 'DF',
    }
    const siglaMap = Object.entries(ufMap).reduce((acc, [code, sigla]) => {
      acc[sigla] = Number(code)
      return acc
    }, {})

    let ufSigla = 'SP'
    let cUfAutor = 35
    const rawUf = this.config.uf || this.config.sefazUf || '35'
    if (typeof rawUf === 'number' || /^\d+$/.test(String(rawUf).trim())) {
      cUfAutor = Number(rawUf)
      ufSigla = ufMap[cUfAutor] || 'SP'
    } else {
      ufSigla = String(rawUf).trim().toUpperCase()
      cUfAutor = siglaMap[ufSigla] || 35
    }
    this.ufSigla = ufSigla
    this.cUfAutor = cUfAutor
  }

  /**
   * Tenta carregar e instanciar o NFeWizard-io (API de classe v1.0.0+)
   */
  async initWizard() {
    if (this.isWizardLoaded && this.wizardInstance) {
      return true
    }

    // Injeção de confiança TLS da cadeia ICP-Brasil ANTES de inicializar o NFeWizard (FIX Itens 1, 2 e 4)
    const { certs, count } = applyIcpBrasilTlsTrust()

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
      const ambienteNum = Number(this.config.ambiente || '1') // 1 = Produção

      // Objeto de configuração do NFeWizard com as opções aceitas pela lib
      const nfeConfig = {
        dfe: {
          baixarXMLDistribuicao: true,
          pathXMLDistribuicao: tmpDistDir,
          armazenarXMLDistribuicao: true,
          armazenarRetornoEmJSON: true,
          pathRetornoEmJSON: tmpDistDir,
          pathCertificado: pfxPath,
          senhaCertificado: this.config.certPassword || '',
          UF: this.ufSigla,
          CPFCNPJ: cleanCnpj,
        },
        nfe: {
          ambiente: ambienteNum,
          versaoDF: '4.00',
        },
        lib: {
          useOpenSSL: false,
          useForSchemaValidation: 'validateSchemaJsBased',
          connection: {
            timeout: 30000,
            ...(count > 0 && {
              ca: [...tls.rootCertificates.map((c) => Buffer.from(c)), ...certs],
            }),
          },
          log: { exibirLogNoConsole: true, armazenarLogs: false },
        },
      }

      await wizard.NFE_LoadEnvironment({
        config: nfeConfig,
      })

      // Reforço TLS: Se o environment instanciou um agent próprio (Environment.agent),
      // garantir que as opções do agent recebam a cadeia completa ICP-Brasil
      try {
        const env = wizard.environment || (wizard.getEnvironment && wizard.getEnvironment())
        if (env && env.agent && env.agent.options) {
          const rootCerts = (tls.rootCertificates || []).map((c) => Buffer.from(c))
          env.agent.options.ca = [...rootCerts, ...certs]
        }
      } catch (_) {}

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
          `[DFE-POLL-QUERY] Consultando SEFAZ Nacional via NFeWizard (ultNSU: ${formattedNsu}, cUFAutor: ${this.cUfAutor || 35}, CNPJ: ${this.cleanCnpj})...`,
        )

        // Payload estruturado estritamente segundo o schema da NT 2014.002 / NFeDistribuicaoDFe
        // Schema espera: cUFAutor (Number), CNPJ (String 14 dígitos), distNSU { ultNSU (String 15 dígitos) }
        const payload = {
          cUFAutor: Number(this.cUfAutor || 35),
          CNPJ: String(this.cleanCnpj || '').replace(/\D/g, ''),
          distNSU: {
            ultNSU: formattedNsu,
          },
        }

        let result = null
        try {
          if (typeof this.wizardInstance.NFE_DistribuicaoDFePorNSU === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFePorNSU(payload)
          } else if (typeof this.wizardInstance.NFE_DistribuicaoDFePorUltNSU === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFePorUltNSU(payload)
          } else if (typeof this.wizardInstance.NFE_DistribuicaoDFe === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFe(payload)
          } else {
            throw new Error('Nenhum método compatível de Distribuição DFe encontrado no NFeWizard.')
          }
        } catch (callErr) {
          // Se NFE_DistribuicaoDFePorNSU rejeitou a assinatura ou schema, tentar NFE_DistribuicaoDFePorUltNSU ou NFE_DistribuicaoDFe genérico
          if (
            typeof this.wizardInstance.NFE_DistribuicaoDFePorUltNSU === 'function' &&
            callErr.message &&
            !callErr.message.includes('cStat')
          ) {
            console.warn('[DFE-RETRY] Tentando via NFE_DistribuicaoDFePorUltNSU...')
            result = await this.wizardInstance.NFE_DistribuicaoDFePorUltNSU(payload)
          } else if (
            typeof this.wizardInstance.NFE_DistribuicaoDFe === 'function' &&
            callErr.message &&
            !callErr.message.includes('cStat')
          ) {
            console.warn('[DFE-RETRY] Tentando via NFE_DistribuicaoDFe...')
            result = await this.wizardInstance.NFE_DistribuicaoDFe(payload)
          } else {
            throw callErr
          }
        }

        return this.parseWizardResponse(result, formattedNsu)
      }

      // Fallback para simulação
      return this.mockSefazResponse(formattedNsu)
    } catch (err) {
      console.error('[DFE-SEFAZ-ERR]', err.message)
      if (
        err.message &&
        (err.message.includes('unable to get local issuer certificate') ||
          err.message.includes('CERT_HAS_EXPIRED') ||
          err.message.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
          err.message.includes('self signed certificate'))
      ) {
        console.error(
          '[DFE-TLS-DIAGNOSTIC] Falha no handshake TLS com a SEFAZ. ' +
            'IMPORTANTE: NODE_TLS_REJECT_UNAUTHORIZED=0 JAMAIS deve ser usado (dados fiscais exigem validação estrita). ' +
            'Verifique se a cadeia ICP-Brasil está completa em @nfewizard/shared/resources/certs e no icp-brasil-ca.pem.',
        )
      }
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
module.exports.loadIcpBrasilCaBundle = loadIcpBrasilCaBundle
module.exports.applyIcpBrasilTlsTrust = applyIcpBrasilTlsTrust
module.exports.buildIcpBrasilCaFile = buildIcpBrasilCaFile
module.exports.resolveIcpBrasilCertsDirs = resolveIcpBrasilCertsDirs
