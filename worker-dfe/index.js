/**
 * worker-dfe/index.js
 * Ponto de entrada do Worker Externo Node.js para Distribuição DFe (Fase 2)
 *
 * GUARDS IMPLEMENTADAS:
 * D1 — FLUXO ÚNICO: Ingestão empurra XML bruto ao CRM no MESMO pipeline de NF-e.
 * D2 — NSU-START: Na inicialização, define o ponteiro sem criar contas/pauta/lançamentos (CF-2c).
 * D3 — PONTEIRO À PROVA DE FALHA: Avança no CRM somente após persistência confirmada.
 * D3-b / CF-2: cStat 656 tratado (não avança ponteiro, pausa ciclo).
 * D4 — SÓ MOD 55: Apenas NF-e mod 55 processa; outros apenas logados.
 * D5 — EVENTO-CANCEL: Cancelamentos processados marcam contas "NÃO PAGAR" e alertam painel.
 * D6 — XML-COMPLETO: Só processa com XML completo; resumos vão para backlog/fila.
 * D7, D8, D9 — CERTIFICADO A1: Senha e PFX seguros no worker; verificação de CNPJ da empresa e validade (<30 dias alerta, vencido aborta).
 * D10 — POLL: Ciclo horário (configurável) com semáforo contra concorrência e fuso Brasília.
 * CF-1b — O WORKER É O CHAMADOR: Poll na fila de comandos para "consultar agora".
 * CF-1c — TOKEN DEDICADO DFe: Autenticação via header X-DFe-Token.
 * CF-1d — OBSERVABILIDADE: Relatório de status e última consulta com sucesso para evitar silenciamento.
 *
 * FIX HEAP-OOM + NSU PERSISTENTE (base 0.0.272, guards D1–D10/CF-1b–1d intocadas):
 * 1 — DOCUMENTOS UM POR VEZ: processamento SEQUENCIAL doc a doc; cada referência é
 *     descartada após o ingest no CRM (sem acumular array de docs processados em memória).
 * 2 — LOTE LIMITADO: no máximo MAX_DOCS_PER_CYCLE (= 10) documentos por ciclo; o resto
 *     do backlog é retomado no ciclo seguinte (SEFAZ permite retomada pelo NSU incremental).
 * 3 — PONTEIRO PERSISTENTE LOCAL: state.json (ao lado do config.json) gravado após cada
 *     ciclo bem-sucedido e lido no boot; nunca volta ao NSU-START após restart/crash.
 *     Sem arquivo de estado, usa o valor do config como fallback e LOGA isso.
 * 4 — RETRY NO INGEST: timeout 30s → 90s + 2 tentativas com espera de 30s (crmClient).
 *     CRM-INGEST-ERR timeout NÃO descarta documento: ciclo encerra, ponteiro não avança,
 *     documento reprocessado no próximo ciclo (dedupe por chave de acesso no CRM).
 * 5 — OBSERVABILIDADE DE MEMÓRIA: process.memoryUsage().heapUsed logado a cada ciclo.
 */

const fs = require('fs')
const path = require('path')
const cron = require('node-cron')
const tls = require('tls')
const crypto = require('crypto')
let axios = null
try {
  axios = require('axios')
} catch (_) {}
const CrmClient = require('./crmClient')
const DfeAdapter = require('./dfeAdapter')
const { readCertInfo } = require('./certUtils')
const {
  applyIcpBrasilTlsTrust,
  appendPemToBundle,
  loadPersistedPointer,
  persistPointer,
  persistBackoff,
  describeStateHistory,
} = (() => {
  // stateStore carregado com tolerância: ausência dele não derruba o worker
  try {
    return {
      applyIcpBrasilTlsTrust: require('./dfeAdapter').applyIcpBrasilTlsTrust,
      appendPemToBundle: require('./dfeAdapter').appendPemToBundle,
      ...require('./stateStore'),
    }
  } catch (e) {
    console.warn(`[STATE-STORE-WARN] stateStore indisponível: ${e.message}`)
    return {
      applyIcpBrasilTlsTrust: require('./dfeAdapter').applyIcpBrasilTlsTrust,
      appendPemToBundle: require('./dfeAdapter').appendPemToBundle,
    }
  }
})()

// FIX HEAP-OOM (item 2): lote máximo de documentos processados por ciclo.
const MAX_DOCS_PER_CYCLE = 10
// FIX HEAP-OOM (item 4): limite de tempo de processamento de UM documento no ingest.
const SINGLE_DOC_TIMEOUT_MS = 90000
const MAX_BACKLOG_PAGES_PER_CYCLE = 25 // Guard de segurança anti-loop infinito de paginação

/**
 * Requisito 3: Mascarar senhaCertificado em QUALQUER saída de log do worker.
 * O [ValidateEnvironment] da lib imprime a senha em aberto.
 * Sanitizar a saída no boot do worker interceptando os métodos de log do console
 * e substituindo o valor real da senha por ****** em qualquer linha ou argumento
 * que contenha "senhaCertificado", sem desligar os demais logs da lib.
 */
function installPasswordLogSanitizer(rawPassword) {
  if (console.__dfePasswordSanitizerInstalled) return
  console.__dfePasswordSanitizerInstalled = true

  const passStr = rawPassword ? String(rawPassword).trim() : ''
  const passRegex =
    passStr && passStr.length >= 2
      ? new RegExp(passStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : null

  // Regexes para capturar padrões comuns como:
  // "senhaCertificado": "minhasenha" ou senhaCertificado: 'minhasenha' ou senhaCertificado = minhasenha
  const keyValRegex = /([`"']?senhaCertificado[`"']?\s*[:=]\s*[`"'])([^`"'\r\n]+)([`"'])/gi
  const plainKeyRegex = /(senhaCertificado\s*[:=]\s*)([^\s,}{;]+)/gi

  function sanitizeString(str) {
    if (typeof str !== 'string') return str
    let sanitized = str

    // Se contiver a chave "senhaCertificado"
    if (/senhaCertificado/i.test(sanitized)) {
      sanitized = sanitized.replace(keyValRegex, '$1******$3')
      sanitized = sanitized.replace(plainKeyRegex, '$1******')
    }

    // Se a senha real estiver presente na saída, mesmo em outro formato
    if (passRegex && passRegex.test(sanitized)) {
      sanitized = sanitized.replace(passRegex, '******')
    }

    return sanitized
  }

  function sanitizeArg(arg) {
    if (typeof arg === 'string') {
      return sanitizeString(arg)
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        // Se for um objeto com senhaCertificado, clona raso ou formata
        const json = JSON.stringify(arg)
        if (/senhaCertificado/i.test(json) || (passRegex && passRegex.test(json))) {
          return JSON.parse(sanitizeString(json))
        }
      } catch (_) {
        // Fallback caso JSON.stringify falhe (ciclos)
      }
    }
    return arg
  }

  const origLog = console.log.bind(console)
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)
  const origInfo = console.info ? console.info.bind(console) : origLog
  const origDebug = console.debug ? console.debug.bind(console) : origLog

  console.log = function (...args) {
    origLog(...args.map(sanitizeArg))
  }
  console.warn = function (...args) {
    origWarn(...args.map(sanitizeArg))
  }
  console.error = function (...args) {
    origError(...args.map(sanitizeArg))
  }
  if (console.info) {
    console.info = function (...args) {
      origInfo(...args.map(sanitizeArg))
    }
  }
  if (console.debug) {
    console.debug = function (...args) {
      origDebug(...args.map(sanitizeArg))
    }
  }

  // Interceptar também process.stdout.write e process.stderr.write por blindagem total contra saídas diretas da lib
  try {
    const origStdoutWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = function (chunk, encoding, callback) {
      if (typeof chunk === 'string') {
        return origStdoutWrite(sanitizeString(chunk), encoding, callback)
      } else if (Buffer.isBuffer(chunk)) {
        const text = chunk.toString(encoding || 'utf8')
        if (/senhaCertificado/i.test(text) || (passRegex && passRegex.test(text))) {
          const sanitized = sanitizeString(text)
          return origStdoutWrite(Buffer.from(sanitized, encoding || 'utf8'), encoding, callback)
        }
      }
      return origStdoutWrite(chunk, encoding, callback)
    }

    const origStderrWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = function (chunk, encoding, callback) {
      if (typeof chunk === 'string') {
        return origStderrWrite(sanitizeString(chunk), encoding, callback)
      } else if (Buffer.isBuffer(chunk)) {
        const text = chunk.toString(encoding || 'utf8')
        if (/senhaCertificado/i.test(text) || (passRegex && passRegex.test(text))) {
          const sanitized = sanitizeString(text)
          return origStderrWrite(Buffer.from(sanitized, encoding || 'utf8'), encoding, callback)
        }
      }
      return origStderrWrite(chunk, encoding, callback)
    }
  } catch (_) {}
}

// Helper para verificar se um retorno SEFAZ ou erro é cStat 656/496 ou mensagem "Consumo Indevido"
function isRateLimitResponse(cStat, xMotivo, rawErrorMsg) {
  const code = String(cStat || '').trim()
  const motivo = String(xMotivo || '').toLowerCase()
  const err = String(rawErrorMsg || '').toLowerCase()

  if (code === '656' || code === '496') return true
  if (motivo.includes('consumo indevido')) return true
  if (err.includes('consumo indevido') || err.includes('656') || err.includes('496')) return true

  return false
}

// 1. Inicializar imediatamente a confiança TLS da cadeia ICP-Brasil + SEFAZ SSL e interceptador universal no boot do worker
// DEVE rodar antes de qualquer require ou chamada de bibliotecas externas (nfewizard-io / @nfewizard/shared)
applyIcpBrasilTlsTrust()

// Helper para log em formato Brasília (UTC-3)
function getBrasiliaTimestamp() {
  const d = new Date(Date.now() - 3 * 3600 * 1000)
  return d.toISOString().replace('Z', '-03:00')
}

// FIX HEAP-OOM (item 5): log de memória do processo a cada ciclo
function logMemoryUsage(stage) {
  try {
    const mem = process.memoryUsage()
    const toMb = (bytes) => (bytes / 1024 / 1024).toFixed(1)
    console.log(
      `[DFE-MEM] ${stage} | heapUsed: ${toMb(mem.heapUsed)} MB | heapTotal: ${toMb(mem.heapTotal)} MB | rss: ${toMb(mem.rss)} MB | external: ${toMb(mem.external)} MB`,
    )
  } catch (_) {}
}

// FIX HEAP-OOM (item 1): liberação de referências para o GC, doc processado e descartado
function releaseDocReferences(obj) {
  try {
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        try {
          obj[key] = null
        } catch (_) {}
      }
    }
  } catch (_) {}
  try {
    if (global.gc && typeof global.gc === 'function') {
      global.gc()
    }
  } catch (_) {}
}

// Carregar configurações
let config = {}
const configPath = path.resolve(__dirname, 'config.json')
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    console.error(`[CONFIG-ERR] Falha ao ler config.json: ${e.message}`)
  }
}

const CRM_URL = process.env.CRM_URL || config.CRM_URL || 'http://127.0.0.1:8090'
const CRM_DFE_TOKEN = process.env.CRM_DFE_TOKEN || config.CRM_DFE_TOKEN || ''
const CERT_PFX_PATH = process.env.CERT_PFX_PATH || config.CERT_PFX_PATH || './certs/certificado.pfx'
const CERT_PASSWORD = process.env.CERT_PASSWORD || config.CERT_PASSWORD || ''
const COMPANY_CNPJ = (process.env.COMPANY_CNPJ || config.COMPANY_CNPJ || '').replace(/\D/g, '')
const SEFAZ_AMBIENTE = String(process.env.SEFAZ_AMBIENTE || config.SEFAZ_AMBIENTE || '1')
const SEFAZ_UF = String(process.env.SEFAZ_UF || config.SEFAZ_UF || '35')
const COMMAND_POLL_INTERVAL_SEC = parseInt(
  process.env.COMMAND_POLL_INTERVAL_SECONDS || config.COMMAND_POLL_INTERVAL_SECONDS || '30',
  10,
)

// Requisito 3: Instalar sanitizador de logs com a senha do certificado logo após ler a configuração
installPasswordLogSanitizer(CERT_PASSWORD)

if (!CRM_DFE_TOKEN) {
  console.warn(
    `[DFE-WARN] CRM_DFE_TOKEN não configurado. O worker tentará conectar ao CRM, mas as rotas exigem token.`,
  )
}

const crm = new CrmClient(CRM_URL, CRM_DFE_TOKEN)
const dfeAdapter = new DfeAdapter({
  certPfxPath: CERT_PFX_PATH,
  certPassword: CERT_PASSWORD,
  cnpj: COMPANY_CNPJ,
  ambiente: SEFAZ_AMBIENTE,
  uf: SEFAZ_UF,
})

let isCycleRunning = false

// Estado em memória do Backoff para cStat 656 / Consumo Indevido (Fase 2)
let backoffUntil = 0 // Timestamp ms em que o backoff expira
const BACKOFF_DURATION_MS = 60 * 60 * 1000 // 60 minutos regulamentares da SEFAZ NT 2014.002
let activePollIntervalHours = 1 // Último intervalo válido conhecido (mínimo 1h, D10)
let scheduledCronJob = null // Referência ao job cron ativo para reagendamento dinâmico
let commandPollCount = 0 // Contador de polls de comandos para log periódico de memória

// FIX HEAP-OOM (item 3): ponteiro NSU persistido localmente (state.json)
// Fix HEAP-OOM 05/11: em falha de leitura do status no boot ou no ciclo, o último
// ponteiro válido conhecido (local) é preservado — nunca voltar ao NSU-START.
let currentPersistedUltNsu = null // Último NSU conhecido localmente (state.json ou config)
let currentPersistedInitialized = null // is_initialized local (null = desconhecido)

function loadPersistedPointerAtBoot() {
  try {
    const persisted = loadPersistedPointer(__dirname, config.ULT_NSU || '')
    currentPersistedUltNsu = persisted.ultNsu
    currentPersistedInitialized = persisted.isInitialized
    if (persisted.backoffUntil && persisted.backoffUntil > Date.now()) {
      backoffUntil = persisted.backoffUntil
      const remMin = Math.ceil((backoffUntil - Date.now()) / 60000)
      console.warn(
        `[DFE-STATE-BOOT] Backoff cStat 656 PERSISTIDO ativo no boot (${remMin} min restantes até ${new Date(backoffUntil).toISOString()}). ` +
          `A consulta à SEFAZ no boot/startup será PULADA para proteger a janela de consumo indevido.`,
      )
    }
    const historyPreview = describeStateHistory(__dirname, 3)
    console.log(
      `[DFE-STATE-BOOT] Ponteiro local carregado | origem: ${persisted.source} | ultNSU: ${persisted.ultNsu}` +
        `${persisted.savedAt ? ` | gravado em: ${persisted.savedAt}` : ''}` +
        `${historyPreview.length ? ` | histórico recente: ${historyPreview.map((h) => h.ult_nsu).join(' -> ')}` : ''}`,
    )
    if (persisted.source === 'state_file') {
      console.log(
        `[DFE-STATE-BOOT] Retomada garantida do ultNSU PERSISTIDO (${persisted.ultNsu}) — NÃO retorna ao NSU-START após restart/crash.`,
      )
    }
    return persisted
  } catch (err) {
    console.warn(
      `[DFE-STATE-BOOT-WARN] Falha ao ler ponteiro persistido: ${err.message}. Usando ponteiro do CRM no ciclo.`,
    )
    return null
  }
}

/**
 * PROBE TLS DE BOOT (Item 3 do FIX):
 * Conecta via tls.connect em www1.nfe.fazenda.gov.br:443 com validação estrita (rejectUnauthorized: true).
 * Registra o log [DFE-TLS-CHAIN] com a cadeia apresentada pelo servidor (folha à raiz).
 * Se o servidor apresentar certificados intermediários válidos, anexa ao bundle em memória.
 */
async function probeSefazTlsChain() {
  const host = 'www1.nfe.fazenda.gov.br'
  const port = 443

  return new Promise((resolve) => {
    console.log(`[DFE-TLS-PROBE] Iniciando probe TLS em ${host}:${port} com validação estrita...`)
    const learnedPems = []
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: true,
        timeout: 10000,
      },
      () => {
        try {
          const peerCert = socket.getPeerCertificate(true)
          if (peerCert) {
            const chain = []
            let curr = peerCert
            const seen = new Set()
            while (curr && curr.fingerprint256 && !seen.has(curr.fingerprint256)) {
              seen.add(curr.fingerprint256)
              const subjectCN = curr.subject ? curr.subject.CN || curr.subject.O || 'N/A' : 'N/A'
              const issuerCN = curr.issuer ? curr.issuer.CN || curr.issuer.O || 'N/A' : 'N/A'
              const validTo = curr.valid_to || 'N/A'
              chain.push({ subjectCN, issuerCN, validTo })

              // Extrair certificado RAW de TODOS os níveis da cadeia (Item 1 do FIX)
              // Converter DER para PEM com crypto.X509Certificate (com fallback base64 DER)
              if (curr.raw) {
                try {
                  const derBuf = Buffer.from(curr.raw)
                  let pemStr = ''
                  try {
                    const x509 = new crypto.X509Certificate(derBuf)
                    pemStr = x509.toString().trim()
                  } catch (_) {
                    pemStr =
                      `-----BEGIN CERTIFICATE-----\n` +
                      derBuf
                        .toString('base64')
                        .match(/.{1,64}/g)
                        .join('\n') +
                      `\n-----END CERTIFICATE-----`
                  }

                  if (pemStr && pemStr.includes('-----BEGIN CERTIFICATE-----')) {
                    learnedPems.push(pemStr)
                    if (typeof appendPemToBundle === 'function') {
                      appendPemToBundle(pemStr)
                    }
                  }
                } catch (rawErr) {
                  console.warn(
                    `[DFE-TLS-CHAIN-WARN] Falha ao converter nível RAW DER: ${rawErr.message}`,
                  )
                }
              }

              if (curr.issuerCertificate && curr.issuerCertificate !== curr) {
                curr = curr.issuerCertificate
              } else {
                break
              }
            }

            console.log(
              `[DFE-TLS-CHAIN] Handshake TLS OK com ${host}:443 | Cadeia (${chain.length} níveis):`,
            )
            chain.forEach((node, idx) => {
              console.log(
                `   [Level ${idx}] Subject: "${node.subjectCN}" | Issuer: "${node.issuerCN}" | Validade: ${node.validTo}`,
              )
            })

            // Item 3 do FIX - PERSISTÊNCIA: Append da cadeia aprendida em icp-brasil-ca.pem
            if (learnedPems.length > 0) {
              try {
                const caFilePath = path.resolve(__dirname, 'icp-brasil-ca.pem')
                let existingContent = ''
                if (fs.existsSync(caFilePath)) {
                  existingContent = fs.readFileSync(caFilePath, 'utf8')
                }
                const toAppend = []
                for (const pem of learnedPems) {
                  if (!existingContent.includes(pem.trim())) {
                    toAppend.push(pem.trim())
                  }
                }
                if (toAppend.length > 0) {
                  fs.appendFileSync(caFilePath, '\n\n' + toAppend.join('\n\n') + '\n', 'utf8')
                  console.log(
                    `[DFE-TLS-PERSIST] ${toAppend.length} certs da cadeia aprendida persistidos em icp-brasil-ca.pem.`,
                  )
                }
              } catch (persistErr) {
                console.warn(
                  `[DFE-TLS-PERSIST-WARN] Falha ao persistir cadeia em icp-brasil-ca.pem: ${persistErr.message}`,
                )
              }
            }
          } else {
            console.log(`[DFE-TLS-CHAIN] Conexão TLS estabelecida sem getPeerCertificate.`)
          }
        } catch (chainErr) {
          console.warn(
            `[DFE-TLS-CHAIN-WARN] Falha ao inspecionar cadeia do servidor: ${chainErr.message}`,
          )
        } finally {
          socket.destroy()
          resolve({ ok: true })
        }
      },
    )

    socket.on('error', (err) => {
      console.error(
        `[DFE-TLS-PROBE-FAIL] Falha no probe TLS com ${host}:${port}: ${err.message} (${err.code || 'UNKNOWN'})`,
      )
      socket.destroy()
      resolve({ ok: false, error: err.message, code: err.code })
    })

    socket.on('timeout', () => {
      console.warn(`[DFE-TLS-PROBE-TIMEOUT] Timeout conectando em ${host}:${port}.`)
      socket.destroy()
      resolve({ ok: false, error: 'TIMEOUT' })
    })
  })
}

/**
 * PROBE HTTP DE FECHAMENTO (Item 5 do FIX):
 * Após o probe TLS, realiza 1 request HTTPS via axios usando O MESMO defaults/agent que a lib vai usar.
 * Loga [DFE-TLS-PROBE-HTTP] ok/erro com detalhes.
 */
async function probeSefazHttpViaAxios() {
  const url = 'https://www1.nfe.fazenda.gov.br/'
  if (!axios) {
    console.log(`[DFE-TLS-PROBE-HTTP] axios não disponível no momento para probe HTTP.`)
    return { ok: false, error: 'axios_not_found' }
  }

  try {
    console.log(`[DFE-TLS-PROBE-HTTP] Testando requisição HTTPS via axios em ${url}...`)
    // Timeout curto de 10s e accept de qualquer status HTTP (inclusive 200, 302, 403, 404, 405)
    // O que prova o TLS é o handshake HTTPS sem erro de certificado!
    const res = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true,
    })
    console.log(
      `[DFE-TLS-PROBE-HTTP] ok | Status: ${res.status} | TLS Handshake HTTPS via axios validado com sucesso!`,
    )
    return { ok: true, status: res.status }
  } catch (err) {
    console.error(
      `[DFE-TLS-PROBE-HTTP] erro | Falha no request HTTPS via axios: ${err.message} (${err.code || 'ERR'})`,
    )
    return { ok: false, error: err.message, code: err.code }
  }
}

/**
 * Validação de Certificado A1 (Guards D7, D8, D9)
 */
function validateCert(companyCnpjFromCrm) {
  const resolvedPfxPath = path.resolve(__dirname, CERT_PFX_PATH)
  if (!fs.existsSync(resolvedPfxPath)) {
    return {
      ok: false,
      error: `[D7] Certificado digital A1 não configurado ou arquivo não encontrado: ${resolvedPfxPath}`,
    }
  }

  const certInfo = readCertInfo(resolvedPfxPath, CERT_PASSWORD)
  if (!certInfo.valid && certInfo.isExpired) {
    return {
      ok: false,
      certInfo,
      error: `[D9] CERTIFICADO A1 VENCIDO em ${certInfo.notAfter}! Captura DFe interrompida para evitar falhas silenciosas.`,
    }
  }

  if (certInfo.error) {
    return {
      ok: false,
      certInfo,
      error: `[D7/D9] Erro ao ler certificado: ${certInfo.error}`,
    }
  }

  // D8: CERT-É-A-EMPRESA
  const expectedCnpj = (companyCnpjFromCrm || COMPANY_CNPJ || '').replace(/\D/g, '')
  if (expectedCnpj && certInfo.extractedCnpj) {
    const certCnpjClean = certInfo.extractedCnpj.replace(/\D/g, '')
    if (certCnpjClean !== expectedCnpj) {
      return {
        ok: false,
        certInfo,
        error: `[D8] Divergência de CNPJ: Certificado (${certCnpjClean}) != Empresa no CRM (${expectedCnpj}). Ciclo abortado.`,
      }
    }
  }

  if (certInfo.daysRemaining < 30) {
    console.warn(
      `[DFE-ALERT] Certificado A1 expira em breve: ${certInfo.daysRemaining} dias restantes (D9).`,
    )
  }

  return { ok: true, certInfo }
}

/**
 * FIX HEAP-OOM (item 3): persiste o ponteiro localmente (state.json) após ciclo bem-sucedido.
 * Falha de persistência NUNCA derruba o ciclo — o ponteiro local continua em memória.
 */
function persistLocalPointer(pointerData) {
  try {
    const ok = persistPointer(__dirname, pointerData)
    if (ok) {
      currentPersistedUltNsu = String(pointerData.ult_nsu || '').trim()
      currentPersistedInitialized = Boolean(pointerData.is_initialized)
    }
    return ok
  } catch (err) {
    console.warn(
      `[DFE-STATE-WARN] Falha ao persistir ponteiro local: ${err.message}. Ponteiro mantido em memória.`,
    )
    return false
  }
}

/**
 * Processa UM documento por vez (FIX HEAP-OOM, item 1): ingest, histórico e descarte
 * de referências antes do próximo doc — nenhum XML de doc processado permanece vivo.
 * Retorna um resumo mínimo: { kind: 'processed'|'duplicate'|'event'|'summary'|'ignored'|'error', error? }
 */
async function processSingleDoc(doc) {
  let summary = { kind: 'ignored' }
  try {
    // D4: SÓ MOD 55
    if (doc.model && doc.model !== '55') {
      console.log(
        `[DFE-MOD-IGNORE] Documento modelo ${doc.model} ignorado para compras (D4). Apenas mod 55 processado.`,
      )
      summary = { kind: 'ignored' }
      return summary
    }

    // D5: EVENTOS (Cancelamento, CC-e)
    if (doc.isEvent) {
      console.log(
        `[DFE-EVENT] Evento SEFAZ recebido (tipo: ${doc.eventType}, chave: ${doc.accessKey}). Encaminhando para tratamento (D5)...`,
      )
      const evRes = await crm.recordEvent({
        access_key: doc.accessKey,
        nsu: doc.nsu,
        event_type: doc.eventType,
        event_desc: doc.eventType === '110111' ? 'Cancelamento de NF-e' : 'Carta de Correção',
        protocol: doc.protocol,
        justification: doc.justification,
        raw_xml: doc.rawXml,
      })
      console.log(`[DFE-EVENT-RESULT] ${JSON.stringify(evRes)}`)
      summary = { kind: 'event' }
      return summary
    }

    // D6: XML COMPLETO vs RESUMO
    if (doc.isSummary && !doc.isFullNfe) {
      console.log(
        `[DFE-SUMMARY] Resumo de NF-e recebido (chave: ${doc.accessKey}). Registrando no histórico DFe (D6 - sem itens, não processa contas).`,
      )
      await crm.recordHistory({
        access_key: doc.accessKey,
        nsu: doc.nsu && String(doc.nsu).trim() ? String(doc.nsu).trim() : '0',
        schema: doc.schema,
        model: doc.model,
        emitter_cnpj: doc.emitterCnpj,
        emitter_name: doc.emitterName,
        issue_date: doc.issueDate,
        total_amount: doc.totalAmount,
        nfe_number: doc.nfeNumber,
        document_type: 'resumo',
        is_backlog: false,
        raw_xml: doc.rawXml,
      })
      summary = { kind: 'summary' }
      return summary
    }

    // NF-e COMPLETA: Ingestão no pipeline oficial (D1, CF-3b)
    if (doc.isFullNfe && doc.rawXml) {
      console.log(
        `[DFE-INGEST] Enviando NF-e completa para pipeline oficial CRM (Chave: ${doc.accessKey}, NSU: ${doc.nsu})...`,
      )
      const ingestRes = await crm.ingestXml(doc.rawXml, doc.nsu)
      if (ingestRes.duplicate) {
        console.log(
          `[DFE-DEDUPE] Chave ${doc.accessKey} já existia no CRM (deduplicada entre canais - D1).`,
        )
        summary = { kind: 'duplicate' }
      } else {
        console.log(
          `[DFE-PROCESSED] NF-e ${doc.accessKey} processada com sucesso no CRM: ${JSON.stringify(ingestRes)}`,
        )
        summary = { kind: 'processed' }
      }

      // Registrar no histórico DFe como importada
      await crm.recordHistory({
        access_key: doc.accessKey,
        nsu: doc.nsu && String(doc.nsu).trim() ? String(doc.nsu).trim() : '0',
        schema: doc.schema,
        model: doc.model,
        emitter_cnpj: doc.emitterCnpj,
        emitter_name: doc.emitterName,
        issue_date: doc.issueDate,
        total_amount: doc.totalAmount,
        nfe_number: doc.nfeNumber,
        document_type: 'nfe_completa',
        is_backlog: false,
        raw_xml: doc.rawXml,
      })
    }
  } catch (docErr) {
    console.error(
      `[DFE-DOC-ERR] Falha ao processar documento (Chave: ${doc.accessKey || 'N/A'}, NSU: ${doc.nsu || 'N/A'}): ${docErr.message}`,
    )
    summary = { kind: 'error', error: docErr.message }
    throw docErr
  } finally {
    // FIX HEAP-OOM (item 1): liberar as referências do doc — o XML não fica vivo na memória
    releaseDocReferences(doc)
    summary = null
  }
}

/**
 * Executa o ciclo principal de captura DFe (Guards D1, D2, D3, CF-2, CF-2c, CF-3)
 * FIX HEAP-OOM: processamento sequencial doc a doc + lote limitado a MAX_DOCS_PER_CYCLE
 * + ponteiro local persistido (state.json) + log de heapUsed a cada ciclo.
 */
async function runDfeCycle(trigger = 'cron') {
  if (isCycleRunning) {
    console.log(
      `[DFE-POLL] Ciclo anterior ainda em execução. Pulando execução paralela (D10). [${getBrasiliaTimestamp()}]`,
    )
    return
  }

  isCycleRunning = true
  console.log(`\n======================================================`)
  console.log(`[DFE-POLL-START] Início do ciclo (${trigger}) em ${getBrasiliaTimestamp()}`)
  logMemoryUsage('inicio-do-ciclo')

  let crmStatus = null
  try {
    crmStatus = await crm.getStatus()
  } catch (err) {
    console.error(`[DFE-POLL-ERR] Falha ao comunicar com CRM (CF-2d): ${err.message}`)
    // FIX HEAP-OOM: em falha do status, preservar último ponteiro local válido
    if (currentPersistedUltNsu) {
      console.warn(
        `[DFE-POLL-ERR] Preservando último ponteiro local válido: ultNSU=${currentPersistedUltNsu} (não volta ao NSU-START).`,
      )
    }
    logMemoryUsage('fim-do-ciclo-falha')
    isCycleRunning = false
    return
  }

  const { dfe_enabled, company_cnpj, pointer, poll_interval_hours } = crmStatus
  const currentModeInfo = dfeAdapter.getMode()

  // Atualizar/reagendar cron se o intervalo configurado no CRM mudou (D10)
  if (poll_interval_hours !== undefined && poll_interval_hours !== null) {
    applyConfiguredPollInterval(poll_interval_hours, 'ciclo')
  }

  // Toggle DFe ligado/desligado (D7)
  if (!dfe_enabled && trigger === 'cron') {
    console.log(
      `[DFE-POLL] Captura DFe DESLIGADA no painel de configurações (D7). Ciclo cron suspenso.`,
    )
    isCycleRunning = false
    return
  }

  // Verificação de Janela de Backoff ativa (cStat 656)
  const now = Date.now()
  if (backoffUntil > now && (trigger === 'cron' || trigger === 'startup')) {
    const minutesRemaining = Math.ceil((backoffUntil - now) / 60000)
    console.warn(
      `[DFE-RATE-LIMIT] Janela de backoff cStat 656 ainda ativa (${minutesRemaining} min restantes). Pulando ciclo ${trigger} para evitar consumo indevido na SEFAZ pós-crash/restart.`,
    )
    try {
      await crm.updatePointer({
        success: true,
        cstat_last: '656',
        worker_status: 'backoff_656',
        worker_mode: currentModeInfo.mode,
      })
    } catch (_) {}
    isCycleRunning = false
    return
  }

  // Validação de Certificado
  const certValidation = validateCert(company_cnpj)
  if (!certValidation.ok) {
    console.error(`[DFE-CERT-ERROR] ${certValidation.error}`)
    try {
      await crm.updatePointer({
        error: certValidation.error,
        worker_status: 'error',
        worker_mode: currentModeInfo.mode,
        cert_cnpj: certValidation.certInfo ? certValidation.certInfo.extractedCnpj : '',
        cert_valid_until: certValidation.certInfo ? certValidation.certInfo.notAfter : '',
        cert_days_remaining: certValidation.certInfo ? certValidation.certInfo.daysRemaining : 0,
      })
    } catch (_) {}
    isCycleRunning = false
    return
  }

  const cert = certValidation.certInfo
  // FIX HEAP-OOM (item 3): ponteiro de partida = CRM, com validação cruzada contra o estado local.
  // O local (state.json) é a memória do worker; o CRM pode ter sido resetado após um crash.
  let currentUltNsu = pointer && pointer.ult_nsu ? String(pointer.ult_nsu).trim() : '0'
  let isInitialized = pointer ? Boolean(pointer.is_initialized) : false

  if (currentPersistedUltNsu) {
    const persistedNum = parseInt(currentPersistedUltNsu, 10)
    const crmNum = parseInt(currentUltNsu, 10)
    if (!isNaN(persistedNum) && !isNaN(crmNum) && persistedNum > crmNum) {
      console.warn(
        `[DFE-STATE-GUARD] Ponteiro local (${currentPersistedUltNsu}) À FRENTE do ponteiro do CRM (${currentUltNsu}). ` +
          `Usando o ponteiro LOCAL para evitar revarrimento do backlog (loop OOM).`,
      )
      currentUltNsu = currentPersistedUltNsu
      if (currentPersistedInitialized !== null) {
        isInitialized = currentPersistedInitialized || isInitialized
      }
    } else if (!isNaN(persistedNum) && !isNaN(crmNum) && persistedNum === crmNum) {
      // Coerentes — reforça is_initialized local se conhecido
      if (currentPersistedInitialized === true) isInitialized = true
    }
    // Se o CRM está à frente do local (ex.: outro worker avançou), o CRM prevalece (safe).
  }

  let isBacklogResume = false
  if (currentPersistedUltNsu && currentPersistedUltNsu !== '0') {
    const persistedNum = parseInt(currentPersistedUltNsu, 10)
    const crmNum = parseInt(currentUltNsu, 10)
    if (!isNaN(persistedNum) && !isNaN(crmNum) && persistedNum === crmNum && crmNum > 2) {
      isBacklogResume = true
    }
  }

  console.log(
    `[DFE-POLL-STATE] ultNSU atual: ${currentUltNsu} | Inicializado (NSU-START): ${isInitialized}` +
      `${isBacklogResume ? ' | RETOMADA de backlog: ponteiro local e CRM coerentes — processando incrementamente (max ' + MAX_DOCS_PER_CYCLE + ' docs/ciclo)' : ''}`,
  )

  // Loop de paginação da SEFAZ (CF-2: 50 por consulta) — LOTE LIMITADO a MAX_DOCS_PER_CYCLE
  let keepPaging = true
  let totalDocsReceived = 0
  let totalProcessed = 0
  let totalDuplicates = 0
  let totalEvents = 0
  let totalPagesFetched = 0 // Guard anti-loop: max páginas por ciclo

  try {
    while (keepPaging) {
      totalPagesFetched++
      if (totalPagesFetched > MAX_BACKLOG_PAGES_PER_CYCLE) {
        console.warn(
          `[DFE-BACKLOG-GUARD] Limite de páginas por ciclo atingido (${MAX_BACKLOG_PAGES_PER_CYCLE}). Retomando no próximo ciclo a partir de ultNSU=${currentUltNsu}.`,
        )
        break
      }

      let sefazRes = null
      try {
        sefazRes = await dfeAdapter.consultarPorUltNsu(currentUltNsu)
      } catch (pollErr) {
        // Se a lib lançou exceção com "Consumo Indevido" ou cStat 656/496 (Requisitos 1 e 2)
        if (isRateLimitResponse('', '', pollErr.message)) {
          backoffUntil = Date.now() + BACKOFF_DURATION_MS
          console.warn(
            `[DFE-RATE-LIMIT] Aguardando janela SEFAZ (1h) | Regra de ritmo NT 2014.002 (cStat 656/496 / Consumo Indevido). Backoff até ${new Date(backoffUntil).toISOString()}. Ciclo encerrado com sucesso até a próxima hora.`,
          )
          await crm.updatePointer({
            success: true,
            cstat_last: '656',
            worker_status: 'backoff_656',
            worker_mode: dfeAdapter.getMode().mode,
            cert_cnpj: cert.extractedCnpj,
            cert_valid_until: cert.notAfter,
            cert_days_remaining: cert.daysRemaining,
          })
          keepPaging = false
          break
        }
        // Se for outro erro, relança para tratamento no catch do ciclo
        throw pollErr
      }

      // FIX HEAP-OOM (item 2): a resposta da SEFAZ traz até 50 docs por página.
      // Para limitar o LOTE a MAX_DOCS_PER_CYCLE sem processar a página inteira,
      // o ciclo processa só a fatia necessária e REFAZ a consulta no próximo ciclo
      // a partir do último NSU processado (SEFAZ permite retomada pelo NSU incremental).
      const { cStat, xMotivo, ultNSU, maxNSU, docs } = sefazRes

      console.log(
        `[DFE-POLL-RESPONSE] cStat: ${cStat} (${xMotivo}) | Retornado ultNSU: ${ultNSU} | maxNSU: ${maxNSU} | Docs: ${docs.length}`,
      )

      // Requisitos 1 e 2: Classificar "Consumo Indevido" como ESPERA NORMAL
      // Casar pela MENSAGEM ("Consumo Indevido") E pelo código cStat 656 (aceitar também 496).
      // Ativa backoff temporário de 60 min, atualiza worker_status = 'backoff_656' no CRM.
      if (isRateLimitResponse(cStat, xMotivo)) {
        backoffUntil = Date.now() + BACKOFF_DURATION_MS
        console.warn(
          `[DFE-RATE-LIMIT] Aguardando janela SEFAZ (1h) | cStat ${cStat} (${xMotivo || 'Consumo Indevido'}). Backoff ativo até ${new Date(backoffUntil).toISOString()}. Ciclo encerrado em repouso programado.`,
        )
        // Persistir deadline em state.json para sobreviver a crash/restart
        if (typeof persistBackoff === 'function') {
          persistBackoff(__dirname, backoffUntil, `cstat_${cStat || '656'}`)
        }
        await crm.updatePointer({
          success: true,
          cstat_last: cStat || '656',
          worker_status: 'backoff_656',
          worker_mode: dfeAdapter.getMode().mode,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })
        keepPaging = false
        break
      }

      // Ao obter retorno com sucesso (137 ou 138), zerar a janela de backoff (memória e disco)
      if (backoffUntil > 0) {
        backoffUntil = 0
        if (typeof persistBackoff === 'function') {
          persistBackoff(__dirname, 0, '')
        }
      }

      // cStat 137: Nenhum documento localizado
      if (cStat === '137' || docs.length === 0) {
        keepPaging = false
        // Atualizar ponteiro com sucesso mesmo sem novos docs
        await crm.updatePointer({
          success: true,
          ult_nsu: ultNSU || currentUltNsu,
          max_nsu: maxNSU || currentUltNsu,
          is_initialized: true,
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })
        persistLocalPointer({
          ult_nsu: ultNSU || currentUltNsu,
          max_nsu: maxNSU || currentUltNsu,
          is_initialized: true,
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
        })
        break
      }

      // FIX HEAP-OOM (item 2): fatia do lote — no máximo MAX_DOCS_PER_CYCLE docs por ciclo
      const pageNsuList = docs
        .map((d) => parseInt(String(d.nsu || '0'), 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b)
      const batchLimit = MAX_DOCS_PER_CYCLE - totalDocsReceived
      const alreadyCovered =
        pageNsuList.length > 0 &&
        currentUltNsu &&
        pageNsuList[pageNsuList.length - 1] <= parseInt(currentUltNsu, 10)

      if (batchLimit <= 0 || alreadyCovered) {
        console.log(
          `[DFE-BATCH-LIMIT] Lote do ciclo esgotado (${totalDocsReceived}/${MAX_DOCS_PER_CYCLE} docs). Retomando o restante no próximo ciclo a partir de ultNSU=${currentUltNsu}.`,
        )
        break
      }

      const docsBatch = docs.slice(0, batchLimit)
      totalDocsReceived += docsBatch.length
      console.log(
        `[DFE-BATCH] Lote deste ciclo: ${docsBatch.length}/${MAX_DOCS_PER_CYCLE} (docs na página: ${docs.length}) — processamento SEQUENCIAL um por vez.`,
      )

      // D2 / CF-2c: Se AINDA NÃO INICIALIZADO (1ª consulta / NSU-START zero-impacto)
      if (!isInitialized) {
        console.log(
          `[DFE-NSU-START] ATIVAÇÃO ZERO-IMPACTO (D2/CF-2c): Gravando documento(s) apenas no histórico/backlog. NENHUM lançamento, pauta ou conta criada!`,
        )
        for (const doc of docsBatch) {
          await crm.recordHistory({
            access_key: doc.accessKey,
            nsu: doc.nsu && String(doc.nsu).trim() ? String(doc.nsu).trim() : '0',
            schema: doc.schema,
            model: doc.model,
            emitter_cnpj: doc.emitterCnpj,
            emitter_name: doc.emitterName,
            issue_date: doc.issueDate,
            total_amount: doc.totalAmount,
            nfe_number: doc.nfeNumber,
            document_type: doc.isSummary
              ? 'resumo'
              : doc.isFullNfe
                ? 'nfe_completa'
                : doc.isEvent
                  ? 'evento'
                  : 'outro',
            is_backlog: true,
            raw_xml: doc.rawXml,
          })
          releaseDocReferences(doc) // FIX HEAP-OOM: descarta referência após ingest
        }

        // Ponteiro avança página a página no CRM (CF-2c)
        await crm.updatePointer({
          success: true,
          ult_nsu: ultNSU,
          max_nsu: maxNSU,
          is_initialized: ultNSU >= maxNSU, // Finaliza bootstrap se chegou no maxNSU
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })

        currentUltNsu = ultNSU
        persistLocalPointer({
          ult_nsu: ultNSU,
          max_nsu: maxNSU,
          is_initialized: ultNSU >= maxNSU,
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
        })
        if (ultNSU >= maxNSU) {
          isInitialized = true
          keepPaging = false
          console.log(
            `[DFE-NSU-START-COMPLETE] Bootstrap paginado concluído com sucesso. ultNSU definido em ${ultNSU} sem criar passivos fantasma (D2).`,
          )
        }
      } else {
        // FLUXO NORMAL (D1 — Captura em regime) — UM DOC POR VEZ (FIX HEAP-OOM, item 1)
        let cycleAborted = false
        for (const doc of docsBatch) {
          try {
            const res = await processSingleDoc(doc)
            if (res && res.kind === 'processed') totalProcessed++
            else if (res && res.kind === 'duplicate') totalDuplicates++
            else if (res && res.kind === 'event') totalEvents++
          } catch (docErr) {
            // FIX HEAP-OOM (item 4): CRM-INGEST-ERR NÃO descarta documento.
            // Ponteiro NÃO avança para o NSU do doc falho — o documento é
            // reprocessado no PRÓXIMO ciclo a partir de currentUltNsu.
            console.warn(
              `[DFE-BATCH-STOP] Processamento interrompido neste ponto. Ponteiro permanece em ultNSU=${currentUltNsu} — documento será reprocessado no próximo ciclo (dedupe por chave de acesso no CRM).`,
            )
            cycleAborted = true
            break
          }
          releaseDocReferences(doc) // FIX HEAP-OOM: descarta referência após ingest
        }

        logMemoryUsage('pos-lote-de-docs')

        if (cycleAborted) {
          // Persiste o ponteiro ANTERIOR (seguro) e encerra o ciclo.
          try {
            await crm.updatePointer({
              success: true,
              ult_nsu: currentUltNsu,
              max_nsu: maxNSU || currentUltNsu,
              is_initialized: true,
              cstat_last: cStat === '138' ? '138' : cStat,
              worker_mode: dfeAdapter.getMode().mode,
              worker_status: 'batch_interrompido',
              cert_cnpj: cert.extractedCnpj,
              cert_valid_until: cert.notAfter,
              cert_days_remaining: cert.daysRemaining,
            })
          } catch (_) {}
          persistLocalPointer({
            ult_nsu: currentUltNsu,
            max_nsu: maxNSU || currentUltNsu,
            is_initialized: true,
            cstat_last: cStat === '138' ? '138' : cStat,
            worker_mode: dfeAdapter.getMode().mode,
          })
          keepPaging = false
          break
        }

        // FIX HEAP-OOM (item 2): se ainda há docs na página, o ciclo termina com o lote
        // e retoma no próximo ciclo a partir do NSU do ÚLTIMO doc processado deste lote
        // (SEFAZ permite retomada pelo NSU incremental). O ponteiro avança doc a doc.
        const batchLastNsu = String(docsBatch[docsBatch.length - 1].nsu || '').trim()
        const reachedPageEnd =
          docsBatch.length === docs.length && String(ultNSU).trim() === String(maxNSU).trim()
        const effectiveUltNsu =
          batchLastNsu && /^\d+$/.test(batchLastNsu) && batchLastNsu !== '0' ? batchLastNsu : ultNSU

        // D3: PONTEIRO SÓ AVANÇA APÓS LOTE CONFIRMADO E PERSISTIDO
        await crm.updatePointer({
          success: true,
          ult_nsu: effectiveUltNsu,
          max_nsu: maxNSU,
          is_initialized: true,
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })
        persistLocalPointer({
          ult_nsu: effectiveUltNsu,
          max_nsu: maxNSU,
          is_initialized: true,
          cstat_last: cStat,
          worker_mode: dfeAdapter.getMode().mode,
        })

        currentUltNsu = effectiveUltNsu

        if (batchLastNsu && batchLastNsu !== ultNSU && totalDocsReceived < MAX_DOCS_PER_CYCLE) {
          // Ainda há docs nesta página para o próximo ciclo — encerra este ciclo
          console.log(
            `[DFE-BATCH-RESUME] Página tinha ${docs.length} docs; lote limitado a ${totalDocsReceived} neste ciclo. Retomada no próximo ciclo a partir de ultNSU=${currentUltNsu}.`,
          )
          keepPaging = false
          break
        }

        if (reachedPageEnd) {
          keepPaging = false
        }
      }
    }

    console.log(`[DFE-POLL] Ciclo concluído com sucesso. [${getBrasiliaTimestamp()}]`)
    console.log(
      `[DFE-POLL-SUMMARY] Recebidos: ${totalDocsReceived} | Processados: ${totalProcessed} | Duplicados: ${totalDuplicates} | Eventos: ${totalEvents} | ultNSU: ${currentUltNsu}`,
    )
    logMemoryUsage('fim-do-ciclo-sucesso')
    releaseDocReferences(null) // GC hint pós-ciclo
  } catch (cycleErr) {
    console.error(`[DFE-POLL-FAIL] Erro durante o ciclo DFe: ${cycleErr.message}`)
    // D3: Não avança o ponteiro em falha!
    try {
      await crm.updatePointer({
        error: cycleErr.message,
        worker_mode: dfeAdapter.getMode().mode,
        cstat_last: 'FALHA',
      })
    } catch (_) {}
    // FIX HEAP-OOM (item 3): em falha, preserva o último ponteiro local válido
    if (currentPersistedUltNsu) {
      console.warn(
        `[DFE-POLL-FAIL] Ponteiro local PRESERVADO: ultNSU=${currentPersistedUltNsu} — retomada incremental no próximo ciclo (não volta ao NSU-START).`,
      )
    }
    logMemoryUsage('fim-do-ciclo-falha')
  } finally {
    isCycleRunning = false
  }
}

/**
 * Fila de comandos do CRM (CF-1b) - Verificação em intervalo curto (<= 30s)
 */
async function checkCommandQueue() {
  commandPollCount++
  if (commandPollCount % 10 === 0) {
    logMemoryUsage(`observador-comandos-poll-${commandPollCount}`)
  }

  try {
    const res = await crm.getPendingCommands()
    if (res && res.commands && res.commands.length > 0) {
      for (const cmd of res.commands) {
        console.log(
          `[DFE-COMMAND] Comando pendente recebido do CRM: ${cmd.command} (ID: ${cmd.id})`,
        )
        await crm.acknowledgeCommand(cmd.id, 'em_execucao', 'Executando comando no worker')

        if (cmd.command === 'consultar_agora') {
          // Comando manual bypassa temporariamente backoff de cron se o operador solicitar
          backoffUntil = 0
          if (typeof persistBackoff === 'function') {
            persistBackoff(__dirname, 0, '')
          }
          await runDfeCycle('comando_manual')
          await crm.acknowledgeCommand(cmd.id, 'concluido', 'Consulta manual executada com sucesso')
        } else if (cmd.command === 'importacao_retroativa') {
          // Importação retroativa com janela configurável (D2)
          console.log(`[DFE-COMMAND-RETRO] Executando importação retroativa...`)
          backoffUntil = 0
          if (typeof persistBackoff === 'function') {
            persistBackoff(__dirname, 0, '')
          }
          await runDfeCycle('importacao_retroativa')
          await crm.acknowledgeCommand(cmd.id, 'concluido', 'Importação retroativa finalizada')
        } else if (cmd.command === 'busca_por_chave') {
          // Consumo de comando busca_por_chave (DANFE PDF / chave individual de 44 dígitos)
          const accessKey = String(cmd.params?.access_key || cmd.params?.chave || '').replace(
            /\D/g,
            '',
          )
          const auditTrail = cmd.params?.audit_trail || cmd.params?.audit || {}
          console.log(`[DFE-COMMAND-KEY] Executando busca_por_chave para a chave ${accessKey}...`)

          if (!accessKey || accessKey.length !== 44) {
            await crm.acknowledgeCommand(
              cmd.id,
              'erro',
              `Chave de acesso inválida (${accessKey}): deve conter 44 dígitos.`,
            )
            continue
          }

          try {
            const keyRes = await dfeAdapter.consultarPorChave(accessKey)
            const fullDoc =
              (keyRes.docs || []).find((d) => d.isFullNfe && d.rawXml) || (keyRes.docs || [])[0]

            if (fullDoc && fullDoc.rawXml && fullDoc.isFullNfe) {
              await crm.reportKeyDownload({
                access_key: accessKey,
                xml: fullDoc.rawXml,
                command_id: cmd.id,
                audit_trail: auditTrail,
              })
              await crm.acknowledgeCommand(
                cmd.id,
                'concluido',
                `XML obtido da SEFAZ com sucesso para a chave ${accessKey} e processado no CRM.`,
              )
            } else {
              // SEFAZ não retornou o XML completo (pode ser resumo ou não autorizado)
              const reason =
                keyRes.xMotivo || 'XML completo não retornado pela SEFAZ para a chave consultada.'
              await crm.reportKeyDownload({
                access_key: accessKey,
                failed: true,
                error: reason,
                command_id: cmd.id,
                audit_trail: auditTrail,
              })
              await crm.acknowledgeCommand(
                cmd.id,
                'erro',
                `SEFAZ não retornou XML completo: ${reason}`,
              )
            }
          } catch (keyErr) {
            console.error(
              `[DFE-COMMAND-KEY-ERR] Falha na busca por chave ${accessKey}:`,
              keyErr.message,
            )
            await crm.reportKeyDownload({
              access_key: accessKey,
              failed: true,
              error: keyErr.message,
              command_id: cmd.id,
              audit_trail: auditTrail,
            })
            await crm.acknowledgeCommand(
              cmd.id,
              'erro',
              `Erro ao consultar chave na SEFAZ: ${keyErr.message}`,
            )
          }
        } else {
          await crm.acknowledgeCommand(cmd.id, 'erro', `Comando desconhecido: ${cmd.command}`)
        }
      }
    }
  } catch (err) {
    // Silencia ou registra aviso sem travar o worker
  }
}

/**
 * Inicialização do serviço do Worker
 */
function startWorker() {
  console.log(`======================================================`)
  console.log(`  RPA AUTO PEÇAS — WORKER EXTERNO DF-e (FASE 2)`)
  console.log(`  Horário de Brasília: ${getBrasiliaTimestamp()}`)
  console.log(`  Node.js: ${process.version}`)
  console.log(`  CRM URL: ${CRM_URL}`)
  console.log(`======================================================\n`)

  // FIX HEAP-OOM (item 3): leitura do state.json no boot — retomada do ponteiro persistido
  loadPersistedPointerAtBoot()
  logMemoryUsage('boot')

  // 1. Iniciar poll curto da fila de comandos (CF-1b - cada 30 segundos)
  setInterval(checkCommandQueue, COMMAND_POLL_INTERVAL_SEC * 1000)
  console.log(
    `[INIT] Observador de comandos do CRM ativo (intervalo: ${COMMAND_POLL_INTERVAL_SEC}s).`,
  )

  // 2. Leitura do status no boot para sincronizar intervalo real e agendar cron
  setTimeout(async () => {
    try {
      const bootStatus = await crm.getStatus()
      if (bootStatus && bootStatus.poll_interval_hours !== undefined) {
        applyConfiguredPollInterval(bootStatus.poll_interval_hours, 'boot')
      } else {
        scheduleDfeCron(activePollIntervalHours)
      }
    } catch (bootErr) {
      console.warn(
        `[INIT-WARN] Falha ao ler status do CRM no boot: ${bootErr.message}. Mantendo último intervalo válido conhecido (${activePollIntervalHours}h).`,
      )
      if (!scheduledCronJob) {
        scheduleDfeCron(activePollIntervalHours)
      }
    }

    if (process.env.NODE_ENV !== 'test') {
      try {
        await probeSefazTlsChain()
        await probeSefazHttpViaAxios()
      } catch (_) {}
      runDfeCycle('startup')
    }
  }, 1000)
}

/**
 * Converte intervalo em horas (>= 1) em expressão cron válida
 */
function getCronExpressionForHours(hours) {
  const safeHours = Math.max(1, Math.floor(Number(hours) || 1))
  if (safeHours === 1) {
    return '0 * * * *' // A cada hora
  }
  return `0 */${safeHours} * * *` // A cada N horas
}

/**
 * Agenda ou reagenda o cron job periódico do worker DF-e
 */
function scheduleDfeCron(intervalHours) {
  const safeHours = Math.max(1, Math.floor(Number(intervalHours) || 1))
  const cronExpr = getCronExpressionForHours(safeHours)

  if (scheduledCronJob) {
    try {
      scheduledCronJob.stop()
      if (typeof scheduledCronJob.destroy === 'function') {
        scheduledCronJob.destroy()
      }
    } catch (_) {}
    scheduledCronJob = null
  }

  scheduledCronJob = cron.schedule(cronExpr, () => {
    console.log(`[CRON] Disparando ciclo periódico DFe (intervalo configurado: ${safeHours}h)...`)
    runDfeCycle('cron')
  })

  activePollIntervalHours = safeHours
  console.log(
    `[CRON-SCHEDULE] intervalo configurado: ${safeHours}h — cron reagendado (${cronExpr})`,
  )
  return safeHours
}

/**
 * Aplica o intervalo configurado com guard de mínimo 1h e preservação do último valor conhecido em falha
 */
function applyConfiguredPollInterval(newIntervalRaw, context = 'ciclo') {
  const parsed = Number(newIntervalRaw)

  if (isNaN(parsed) || parsed <= 0) {
    console.warn(
      `[POLL-INTERVAL-WARN] Valor de intervalo inválido recebido do CRM (${JSON.stringify(newIntervalRaw)}). Mantendo último intervalo válido conhecido (${activePollIntervalHours}h).`,
    )
    return activePollIntervalHours
  }

  // Guard contra valor menor que 1 hora para evitar cStat 656 da SEFAZ
  const safeHours = Math.max(1, Math.floor(parsed))

  if (safeHours !== activePollIntervalHours || !scheduledCronJob) {
    const previous = activePollIntervalHours
    scheduleDfeCron(safeHours)
    console.log(
      `[POLL-INTERVAL-UPDATED] [${context}] Intervalo DF-e alterado de ${previous}h para ${safeHours}h sem restart do worker.`,
    )
  }

  return safeHours
}

module.exports = {
  startWorker,
  runDfeCycle,
  checkCommandQueue,
  isRateLimitResponse,
  installPasswordLogSanitizer,
  getCronExpressionForHours,
  scheduleDfeCron,
  applyConfiguredPollInterval,
  // FIX HEAP-OOM: exports para testes/observabilidade
  MAX_DOCS_PER_CYCLE,
  loadPersistedPointerAtBoot,
  getCurrentPersistedUltNsu: () => currentPersistedUltNsu,
  setCurrentPersistedUltNsu: (val) => {
    currentPersistedUltNsu = val
  },
  getCurrentPersistedInitialized: () => currentPersistedInitialized,
  setCurrentPersistedInitialized: (val) => {
    currentPersistedInitialized = val
  },
  getActivePollIntervalHours: () => activePollIntervalHours,
  setActivePollIntervalHours: (val) => {
    activePollIntervalHours = val
  },
  getScheduledCronJob: () => scheduledCronJob,
  getBackoffUntil: () => backoffUntil,
  setBackoffUntil: (val) => {
    backoffUntil = val
  },
}

// Iniciar apenas se executado diretamente
if (require.main === module) {
  startWorker()
}
