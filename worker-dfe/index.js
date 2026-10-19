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
 */

const fs = require('fs')
const path = require('path')
const cron = require('node-cron')
const CrmClient = require('./crmClient')
const DfeAdapter = require('./dfeAdapter')
const { readCertInfo } = require('./certUtils')

// Helper para log em formato Brasília (UTC-3)
function getBrasiliaTimestamp() {
  const d = new Date(Date.now() - 3 * 3600 * 1000)
  return d.toISOString().replace('Z', '-03:00')
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
const SEFAZ_AMBIENTE = process.env.SEFAZ_AMBIENTE || config.SEFAZ_AMBIENTE || 2
const SEFAZ_UF = process.env.SEFAZ_UF || config.SEFAZ_UF || 35
const COMMAND_POLL_INTERVAL_SEC = parseInt(
  process.env.COMMAND_POLL_INTERVAL_SECONDS || config.COMMAND_POLL_INTERVAL_SECONDS || '30',
  10,
)

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
 * Executa o ciclo principal de captura DFe (Guards D1, D2, D3, CF-2, CF-2c, CF-3)
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

  let crmStatus = null
  try {
    crmStatus = await crm.getStatus()
  } catch (err) {
    console.error(`[DFE-POLL-ERR] Falha ao comunicar com CRM (CF-2d): ${err.message}`)
    isCycleRunning = false
    return
  }

  const { dfe_enabled, company_cnpj, pointer } = crmStatus

  // Toggle DFe ligado/desligado (D7)
  if (!dfe_enabled && trigger === 'cron') {
    console.log(
      `[DFE-POLL] Captura DFe DESLIGADA no painel de configurações (D7). Ciclo cron suspenso.`,
    )
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
        cert_cnpj: certValidation.certInfo ? certValidation.certInfo.extractedCnpj : '',
        cert_valid_until: certValidation.certInfo ? certValidation.certInfo.notAfter : '',
        cert_days_remaining: certValidation.certInfo ? certValidation.certInfo.daysRemaining : 0,
      })
    } catch (_) {}
    isCycleRunning = false
    return
  }

  const cert = certValidation.certInfo
  let currentUltNsu = pointer && pointer.ult_nsu ? pointer.ult_nsu : '0'
  let isInitialized = pointer ? Boolean(pointer.is_initialized) : false

  console.log(
    `[DFE-POLL-STATE] ultNSU atual: ${currentUltNsu} | Inicializado (NSU-START): ${isInitialized}`,
  )

  // Loop de paginação da SEFAZ (CF-2: 50 por consulta, loop até ultNSU == maxNSU)
  let keepPaging = true
  let totalDocsReceived = 0
  let totalProcessed = 0
  let totalDuplicates = 0
  let totalEvents = 0

  try {
    while (keepPaging) {
      const sefazRes = await dfeAdapter.consultarPorUltNsu(currentUltNsu)
      const { cStat, xMotivo, ultNSU, maxNSU, docs } = sefazRes

      console.log(
        `[DFE-POLL-RESPONSE] cStat: ${cStat} (${xMotivo}) | Retornado ultNSU: ${ultNSU} | maxNSU: ${maxNSU} | Docs: ${docs.length}`,
      )

      // CF-2 / D3-b: Tratamento de Consumo Indevido (cStat 656)
      if (cStat === '656') {
        console.warn(
          `[DFE-POLL] [656] Consumo indevido detectado pela SEFAZ. Ponteiro mantido. Ciclo abortado respeitando intervalo mínimo (CF-2).`,
        )
        await crm.updatePointer({
          cstat_last: '656',
          error: 'cStat 656: Consumo indevido SEFAZ. Aguardando próximo ciclo de 1 hora.',
        })
        keepPaging = false
        break
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
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })
        break
      }

      totalDocsReceived += docs.length

      // D2 / CF-2c: Se AINDA NÃO INICIALIZADO (1ª consulta / NSU-START zero-impacto)
      if (!isInitialized) {
        console.log(
          `[DFE-NSU-START] ATIVAÇÃO ZERO-IMPACTO (D2/CF-2c): Gravando ${docs.length} documento(s) apenas no histórico/backlog. NENHUM lançamento, pauta ou conta criada!`,
        )
        for (const doc of docs) {
          await crm.recordHistory({
            access_key: doc.accessKey,
            nsu: doc.nsu,
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
        }

        // Ponteiro avança página a página no CRM (CF-2c)
        await crm.updatePointer({
          success: true,
          ult_nsu: ultNSU,
          max_nsu: maxNSU,
          is_initialized: ultNSU >= maxNSU, // Finaliza bootstrap se chegou no maxNSU
          cstat_last: cStat,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })

        currentUltNsu = ultNSU
        if (ultNSU >= maxNSU) {
          isInitialized = true
          keepPaging = false
          console.log(
            `[DFE-NSU-START-COMPLETE] Bootstrap paginado concluído com sucesso. ultNSU definido em ${ultNSU} sem criar passivos fantasma (D2).`,
          )
        }
      } else {
        // FLUXO NORMAL (D1 — Captura em regime)
        for (const doc of docs) {
          // D4: SÓ MOD 55
          if (doc.model && doc.model !== '55') {
            console.log(
              `[DFE-MOD-IGNORE] Documento modelo ${doc.model} ignorado para compras (D4). Apenas mod 55 processado.`,
            )
            continue
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
            totalEvents++
            console.log(`[DFE-EVENT-RESULT] ${JSON.stringify(evRes)}`)
            continue
          }

          // D6: XML COMPLETO vs RESUMO
          if (doc.isSummary && !doc.isFullNfe) {
            console.log(
              `[DFE-SUMMARY] Resumo de NF-e recebido (chave: ${doc.accessKey}). Registrando no histórico DFe (D6 - sem itens, não processa contas).`,
            )
            await crm.recordHistory({
              access_key: doc.accessKey,
              nsu: doc.nsu,
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
            continue
          }

          // NF-e COMPLETA: Ingestão no pipeline oficial (D1, CF-3b)
          if (doc.isFullNfe && doc.rawXml) {
            console.log(
              `[DFE-INGEST] Enviando NF-e completa para pipeline oficial CRM (Chave: ${doc.accessKey})...`,
            )
            const ingestRes = await crm.ingestXml(doc.rawXml)
            if (ingestRes.duplicate) {
              totalDuplicates++
              console.log(
                `[DFE-DEDUPE] Chave ${doc.accessKey} já existia no CRM (deduplicada entre canais - D1).`,
              )
            } else {
              totalProcessed++
              console.log(
                `[DFE-PROCESSED] NF-e ${doc.accessKey} processada com sucesso no CRM: ${JSON.stringify(ingestRes)}`,
              )
            }

            // Registrar no histórico DFe como importada
            await crm.recordHistory({
              access_key: doc.accessKey,
              nsu: doc.nsu,
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
        }

        // D3: PONTEIRO SÓ AVANÇA APÓS LOTE CONFIRMADO E PERSISTIDO
        await crm.updatePointer({
          success: true,
          ult_nsu: ultNSU,
          max_nsu: maxNSU,
          is_initialized: true,
          cstat_last: cStat,
          cert_cnpj: cert.extractedCnpj,
          cert_valid_until: cert.notAfter,
          cert_days_remaining: cert.daysRemaining,
        })

        currentUltNsu = ultNSU
        if (ultNSU >= maxNSU) {
          keepPaging = false
        }
      }
    }

    console.log(`[DFE-POLL] Ciclo concluído com sucesso. [${getBrasiliaTimestamp()}]`)
    console.log(
      `[DFE-POLL-SUMMARY] Recebidos: ${totalDocsReceived} | Processados: ${totalProcessed} | Duplicados: ${totalDuplicates} | Eventos: ${totalEvents} | ultNSU: ${currentUltNsu}`,
    )
  } catch (cycleErr) {
    console.error(`[DFE-POLL-FAIL] Erro durante o ciclo DFe: ${cycleErr.message}`)
    // D3: Não avança o ponteiro em falha!
    try {
      await crm.updatePointer({
        error: cycleErr.message,
        cstat_last: 'FALHA',
      })
    } catch (_) {}
  } finally {
    isCycleRunning = false
  }
}

/**
 * Fila de comandos do CRM (CF-1b) - Verificação em intervalo curto (<= 30s)
 */
async function checkCommandQueue() {
  try {
    const res = await crm.getPendingCommands()
    if (res && res.commands && res.commands.length > 0) {
      for (const cmd of res.commands) {
        console.log(
          `[DFE-COMMAND] Comando pendente recebido do CRM: ${cmd.command} (ID: ${cmd.id})`,
        )
        await crm.acknowledgeCommand(cmd.id, 'em_execucao', 'Executando comando no worker')

        if (cmd.command === 'consultar_agora') {
          await runDfeCycle('comando_manual')
          await crm.acknowledgeCommand(cmd.id, 'concluido', 'Consulta manual executada com sucesso')
        } else if (cmd.command === 'importacao_retroativa') {
          // Importação retroativa com janela configurável (D2)
          console.log(`[DFE-COMMAND-RETRO] Executando importação retroativa...`)
          await runDfeCycle('importacao_retroativa')
          await crm.acknowledgeCommand(cmd.id, 'concluido', 'Importação retroativa finalizada')
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

  // 1. Iniciar poll curto da fila de comandos (CF-1b - cada 30 segundos)
  setInterval(checkCommandQueue, COMMAND_POLL_INTERVAL_SEC * 1000)
  console.log(
    `[INIT] Observador de comandos do CRM ativo (intervalo: ${COMMAND_POLL_INTERVAL_SEC}s).`,
  )

  // 2. Iniciar agendador cron periódico (D10, CF-2: a cada 60 min)
  cron.schedule('0 * * * *', () => {
    console.log(`[CRON] Disparando ciclo periódico DFe horário...`)
    runDfeCycle('cron')
  })
  console.log(`[INIT] Cron SEFAZ DFe agendado para rodar a cada hora (0 * * * *).`)

  // 3. Execução imediata inicial de handshake
  setTimeout(() => {
    runDfeCycle('startup')
  }, 3000)
}

// Iniciar
startWorker()
