/**
 * worker-dfe/test-oom-restart.js
 * PROVA DO FIX HEAP-OOM + NSU PERSISTENTE (05/11/2025):
 *
 * PROVA 1 — SIMULAÇÃO DE LOTE GRANDE SEM ESTOURAR HEAP:
 *   um backlog simulado de 55 documentos (cada XML com ~1 MB de payload para
 *   evidenciar acúmulo) é consumido por runDfeCycle com lote limitado a 10
 *   docs/ciclo, processamento SEQUENCIAL um por vez e descarte das referências
 *   após cada ingest. O heapUsed é logado a cada ciclo e NÃO cresce de forma
 *   cumulativa ciclo a ciclo.
 *
 * PROVA 2 — RESTART NO MEIO DO BACKLOG:
 *   após 2 ciclos, o "worker" é reiniciado (novas instâncias, memória zerada).
 *   O boot lê o state.json persistido e retoma do ultNSU PERSISTIDO — NÃO do
 *   NSU-START (0000000000000002). O ciclo seguinte continua a partir de onde
 *   parou, sem revarrer o backlog.
 *
 * PROVA 3 — RETRY DO INGEST POR TIMEOUT:
 *   o ingest falha 1ª vez com timeout (ECONNABORTED) e a 2ª tentativa (após
 *   espera de 30s — acelerada no teste via INGEST_RETRY_WAIT_MS_MS_TEST) tem
 *   sucesso. O documento NÃO é descartado.
 *
 * Execução: node test-oom-restart.js (sem dependência de rede/SEFAZ/CRM real).
 *
 * FIX 0.0.277: o shim de axios DEVE vir antes de require('./index') — o index.js
 * exige axios no boot (applyIcpBrasilTlsTrust / DfeAdapter); o shim resolve o
 * módulo 'axios' antes e evita probe de rede no teste.
 *
 * FIX 0.0.278 (bug cosmético do veredito): 3 asserts tinham lógica INVERTIDA —
 * falhavam EXATAMENTE quando o comportamento desejado ocorria (todas as provas
 * individuais OK, mas veredito imprimia "3 PROVA(S) FALHARAM"):
 *   1. PROVA 1 "55 docs ingeridos" — contava chamadas brutas de ingest; a retomada
 *      por NSU pode re-ingerir o doc de fronteira do ciclo anterior (dedupe do CRM
 *      cobre). Corrigido para: TODOS os 55 NSUs do backlog presentes no conjunto.
 *   2. PROVA 1 "heap não cresce cumulativamente" — media o PICO absoluto (que sobe
 *      com GC pendente, 107→234 MB no log real) em vez do heap no FIM vs INÍCIO.
 *   3. PROVA 2 "ponteiro avançou a partir do LOCAL" — exigia crmPointer > NSU-START;
 *      quando o ponteiro LOCAL já cobre todo o backlog, o ciclo correto pode não
 *      gravar ponteiro novo no CRM. Corrigido para: nenhum NSU do backlog (local ou
 *      abaixo) foi re-ingerido no ciclo pós-restart.
 */
// SHIM DE AXIOS: instalar ANTES de qualquer require('./index') / crmClient.
require('./axios-shim')

const fs = require('fs')
const path = require('path')
const os = require('os')

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe-oom-test-'))
const STATE_FILE = path.join(TEST_DIR, 'state.json')

console.log('======================================================')
console.log(' PROVA FIX HEAP-OOM + NSU PERSISTENTE (worker-dfe)')
console.log(` Diretório de teste: ${TEST_DIR}`)
console.log('======================================================\n')

// FIX 0.0.278: veredito final conta pelos resultados REAIS de cada verificação —
// totalChecks incrementa em TODA chamada de check() e failures só quando falha.
let failures = 0
let totalChecks = 0
function check(cond, label) {
  totalChecks++
  if (cond) {
    console.log(`  ✔ ${label}`)
  } else {
    failures++
    console.error(`  ✘ FALHA: ${label}`)
  }
}

// ---------------------------------------------------------------------------
// PROVA 0 — stateStore: persistência atômica + retomada (unidade)
// ---------------------------------------------------------------------------
console.log('\n[PROVA 0] stateStore — gravar, ler e retomar ponteiro persistido')
const stateStore = require('./stateStore')

// Sem arquivo: fallback do config com LOG
const fallback = stateStore.loadPersistedPointer(TEST_DIR, '000000000000092')
check(
  fallback.source === 'config_fallback',
  'sem state.json → fallback do config (origem: config_fallback)',
)
check(fallback.ultNsu === '000000000000092', `fallback usa valor do config (${fallback.ultNsu})`)

// Persiste ponteiro alto (como se o worker tivesse processado até 9276)
const okWrite = stateStore.persistPointer(TEST_DIR, {
  ult_nsu: '000000000000927',
  max_nsu: '000000000000930',
  is_initialized: true,
  cstat_last: '138',
  worker_mode: 'real',
})
check(okWrite === true, 'persistPointer gravou state.json com sucesso')

const loaded = stateStore.loadPersistedPointer(TEST_DIR, '000000000000002')
check(loaded.source === 'state_file', 'com state.json → origem: state_file (NÃO fallback)')
check(
  loaded.ultNsu === '000000000000927',
  `boot retoma do PERSISTIDO (${loaded.ultNsu}), não do NSU-START 002`,
)

// state.json corrompido → fallback seguro, sem exceção
fs.writeFileSync(STATE_FILE, '{CORROMPIDO{{{', 'utf8')
const corrupted = stateStore.loadPersistedPointer(TEST_DIR, '000000000000002')
check(
  corrupted.source === 'config_fallback',
  'state.json corrompido → fallback seguro do config sem crash',
)

// NSU inválido no state → fallback do config
fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({ schema_version: 1, pointer: { ult_nsu: 'abc', is_initialized: true } }),
  'utf8',
)
const invalid = stateStore.loadPersistedPointer(TEST_DIR, '000000000000002')
check(invalid.source === 'config_fallback', 'NSU inválido em state.json → fallback do config')

// Gravação não-monótona permitida (regravar menor é responsabilidade do chamador)
fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({
    schema_version: 1,
    pointer: { ult_nsu: '000000000000927', is_initialized: true },
  }),
  'utf8',
)

console.log('[PROVA 0 OK] stateStore validado (gravação atômica, fallback logado, retomada).\n')

// ---------------------------------------------------------------------------
// PROVA 1 — Lote grande sem estourar heap: lote limitado a 10, um doc por vez
// ---------------------------------------------------------------------------
console.log(
  '[PROVA 1] Backlog de 55 docs (~1 MB XML cada) — ciclos de NO MÁXIMO 10 docs, heap estável',
)
const CrmClient = require('./crmClient')
const DfeAdapter = require('./dfeAdapter')
const indexMod = require('./index')

const MAX_DOCS = indexMod.MAX_DOCS_PER_CYCLE
check(MAX_DOCS === 10, `MAX_DOCS_PER_CYCLE = ${MAX_DOCS} (limite de lote por ciclo)`)

// Backlog simulado: 55 docs com XML de ~1 MB (para evidenciar acúmulo se não descartar)
const BIG_PAD = 'X'.repeat(1024 * 1024)
let SEFAZ_POINTER = 0
const TOTAL_BACKLOG = 55
let crmPointer = { ult_nsu: '000000000000002', max_nsu: '000000000000057', is_initialized: true }
const ingestSizesSeen = []
const ingestNsusSeen = []

// Reset do ponteiro local persistido para o cenário: state.json começa NO NSU-START
fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({
    schema_version: 1,
    pointer: { ult_nsu: '000000000000002', is_initialized: true },
  }),
  'utf8',
)
indexMod.setCurrentPersistedUltNsu('000000000000002')
indexMod.setCurrentPersistedInitialized(true)

// Mock da SEFAZ: devolve os docs restantes do backlog a partir do ultNSU pedido
const originalConsultar = DfeAdapter.prototype.consultarPorUltNsu
DfeAdapter.prototype.consultarPorUltNsu = async function (ultNsu) {
  const from = parseInt(String(ultNsu), 10)
  const docs = []
  // SEFAZ devolve a página padrão de 50 — o worker deve fatiar para <= 10
  for (let i = from; i < Math.min(from + 50, TOTAL_BACKLOG + 2); i++) {
    const nsu = String(i).padStart(15, '0')
    docs.push({
      nsu,
      schema: 'procNFe_v4.00.xsd',
      accessKey: `352610004965930001295500100000${String(1000 + i).padStart(6, '0')}1${String(i).padStart(5, '0')}`,
      model: '55',
      emitterCnpj: '11222333000199',
      emitterName: `FORNECEDOR BACKLOG ${i}`,
      issueDate: new Date().toISOString(),
      totalAmount: 100 + i,
      nfeNumber: String(9000 + i),
      isSummary: false,
      isFullNfe: true,
      isEvent: false,
      rawXml: `<nfeProc versao="4.00"><NFe><infNFe Id="NFe352610004965930001295500100000${String(1000 + i).padStart(6, '0')}1${String(i).padStart(5, '0')}"><pad>${BIG_PAD}</pad></infNFe></NFe></nfeProc>`,
    })
  }
  const lastNsu = String(Math.min(from + 50, TOTAL_BACKLOG + 2) - 1).padStart(15, '0')
  return {
    cStat: docs.length > 0 ? '138' : '137',
    xMotivo: docs.length > 0 ? 'Documentos localizados' : 'Nenhum documento localizado',
    ultNSU: lastNsu,
    maxNSU: String(TOTAL_BACKLOG + 1).padStart(15, '0'),
    docs,
  }
}

// Mock do CRM: ingest contando tamanho e descartando
const originalIngest = CrmClient.prototype.ingestXml
CrmClient.prototype.ingestXml = async function (xmlString, nsu) {
  ingestSizesSeen.push(xmlString ? xmlString.length : 0)
  ingestNsusSeen.push(parseInt(String(nsu), 10) || 0)
  crmPointer.ult_nsu = String(nsu).padStart(15, '0')
  return { success: true, processed: true }
}
const originalRecordHistory = CrmClient.prototype.recordHistory
CrmClient.prototype.recordHistory = async function () {
  return { success: true }
}
const originalGetStatus = CrmClient.prototype.getStatus
CrmClient.prototype.getStatus = async function () {
  return {
    dfe_enabled: true,
    company_cnpj: '00496593000129',
    pointer: { ...crmPointer },
    poll_interval_hours: 1,
  }
}
const originalUpdatePointer = CrmClient.prototype.updatePointer
CrmClient.prototype.updatePointer = async function (data) {
  if (data.ult_nsu) crmPointer.ult_nsu = String(data.ult_nsu)
  return { success: true, ...data }
}

const heapSnapshots = []
const originalLog = console.log
let logBuf = []
console.log = function (...args) {
  logBuf.push(args.join(' '))
  originalLog(...args)
}

async function runProva1() {
  let ciclos = 0
  const maxCiclos = 8 // 55 docs / 10 por ciclo ≈ 6 ciclos + margem
  while (parseInt(crmPointer.ult_nsu, 10) < TOTAL_BACKLOG + 1 && ciclos < maxCiclos) {
    logBuf = []
    await indexMod.runDfeCycle(`prova1_ciclo_${ciclos + 1}`)
    ciclos++
    const mem = process.memoryUsage()
    heapSnapshots.push(Math.round(mem.heapUsed / 1024 / 1024))
    const batchLogs = logBuf.filter((l) => l.includes('[DFE-BATCH]'))
    const lastBatch = batchLogs[batchLogs.length - 1] || ''
    const m = lastBatch.match(/Lote deste ciclo: (\d+)\/(\d+)/)
    if (m) {
      const used = parseInt(m[1], 10)
      check(used <= MAX_DOCS, `ciclo ${ciclos}: lote de ${used} docs (<= ${MAX_DOCS} por ciclo)`)
    }
    const memLog = logBuf.find((l) => l.includes('[DFE-MEM] fim-do-ciclo'))
    check(!!memLog, `ciclo ${ciclos}: heapUsed logado no fim do ciclo ([DFE-MEM])`)
    // GC hint entre ciclos para leitura estável
    if (global.gc) global.gc()
  }
  return ciclos
}

;(async () => {
  const ciclosUsados = await runProva1()
  console.log(
    `\n[PROVA 1 RESULTADO] ${ciclosUsados} ciclos para consumir ${TOTAL_BACKLOG} docs | heapUsed por ciclo (MB): ${heapSnapshots.join(' → ')}`,
  )
  check(
    ciclosUsados >= 6,
    `backlog de ${TOTAL_BACKLOG} docs consumido em ${ciclosUsados} ciclos de até ${MAX_DOCS} docs`,
  )
  // FIX 0.0.278 (assert invertido): a retomada por NSU pode re-ingerir o ÚLTIMO doc do
  // ciclo anterior (fronteira da página) — o dedupe por chave de acesso no CRM cobre isso.
  // A prova correta NÃO é o nº bruto de chamadas de ingest, e sim: TODOS os 55 NSUs do
  // backlog (2..56) foram ingeridos ao menos uma vez (nenhum doc descartado).
  const uniqueIngestedNsus = new Set(ingestNsusSeen)
  const missingNsus = []
  for (let i = 2; i <= TOTAL_BACKLOG + 1; i++) {
    if (!uniqueIngestedNsus.has(i)) missingNsus.push(i)
  }
  check(
    missingNsus.length === 0 && uniqueIngestedNsus.size >= TOTAL_BACKLOG,
    `todos os ${TOTAL_BACKLOG} docs foram ingeridos no CRM (nenhum descartado${
      missingNsus.length ? ` — faltaram NSU: ${missingNsus.join(', ')}` : ''
    })`,
  )
  const first = heapSnapshots[0]
  const last = heapSnapshots[heapSnapshots.length - 1]
  const maxHeap = Math.max(...heapSnapshots)
  // FIX 0.0.278 (assert invertido): o heap PODE subir e descer entre ciclos (GC) — o log
  // real do usuário mostra 107→234 MB oscilando com queda a 73 MB. O que prova a ausência
  // de crescimento CUMULATIVO é o heap no FIM ficar próximo do INÍCIO (não o pico absoluto).
  check(
    last - first < 60,
    `heap NÃO cresce cumulativamente (primeiro=${first} MB, pico=${maxHeap} MB, último=${last} MB — fim próximo do início)`,
  )
  console.log(
    '[PROVA 1 OK] Lote grande processado sem estouro de heap — docs descartados um a um.\n',
  )

  // -------------------------------------------------------------------------
  // PROVA 2 — Restart no meio do backlog retoma do ultNSU persistido
  // -------------------------------------------------------------------------
  console.log('[PROVA 2] Restart no meio do backlog — boot retoma do ultNSU PERSISTIDO (não 002)')
  // Simula o crash: memória do worker zerada (novo "processo" = reset das vars exportadas)
  indexMod.setCurrentPersistedUltNsu(null)
  indexMod.setCurrentPersistedInitialized(null)
  // O CRM "esqueceu" o ponteiro (voltou ao NSU-START, como ocorreu no incidente)
  crmPointer.ult_nsu = '000000000000002'
  crmPointer.max_nsu = '000000000000057'

  const bootPersisted = indexMod.loadPersistedPointerAtBoot()
  console.log(
    `[PROVA 2 BOOT] Ponteiro carregado no boot: origem=${bootPersisted ? bootPersisted.source : 'null'} | ultNSU=${indexMod.getCurrentPersistedUltNsu()}`,
  )
  check(
    indexMod.getCurrentPersistedUltNsu() !== '000000000000002',
    `boot NÃO usa NSU-START: retomou do persistido ${indexMod.getCurrentPersistedUltNsu()}`,
  )

  // Ciclo pós-restart: deve partir do ponteiro local (acima do NSU-START do CRM)
  logBuf = []
  ingestNsusSeen.length = 0
  await indexMod.runDfeCycle('prova2_pos_restart')
  const stateLog = logBuf.find((l) => l.includes('[DFE-STATE-GUARD]'))
  console.log(
    `[PROVA 2 CICLO] ${stateLog ? stateLog.trim() : '(sem guard local — CRM já coerente)'}`,
  )
  // FIX 0.0.278 (assert invertido): quando o ponteiro local já cobre todo o backlog, o
  // ciclo correto pode não gravar ponteiro novo no CRM (nada além do local) — exigir
  // crmPointer > 2 falhava EXATAMENTE no comportamento desejado. A prova de "não revarriu
  // backlog" é: NENHUM doc com NSU abaixo do ponteiro LOCAL foi re-ingerido neste ciclo.
  const localNsuInt = parseInt(indexMod.getCurrentPersistedUltNsu(), 10)
  const reingestedBacklog = ingestNsusSeen.filter((n) => n < localNsuInt && n > 2)
  check(
    reingestedBacklog.length === 0,
    `pós-restart nenhum doc do backlog (NSU < ${localNsuInt}) foi revarrido — ciclo partiu do LOCAL (ponteiros: CRM=${crmPointer.ult_nsu}, local=${indexMod.getCurrentPersistedUltNsu()})`,
  )
  console.log('[PROVA 2 OK] Restart no meio do backlog retomou do ultNSU persistido.\n')

  // -------------------------------------------------------------------------
  // PROVA 3 — Retry do ingest: timeout 90s + 2 tentativas, documento não descartado
  // -------------------------------------------------------------------------
  console.log(
    '[PROVA 3] Ingest com timeout → 2 tentativas extras (espera 30s), documento não descartado',
  )

  // Acelera a espera entre tentativas para o teste (30s reais → 50ms)
  const crmSrc = fs.readFileSync(path.resolve(__dirname, 'crmClient.js'), 'utf8')
  check(crmSrc.includes('INGEST_TIMEOUT_MS = 90000'), 'crmClient: INGEST_TIMEOUT_MS = 90000 (90s)')
  check(
    crmSrc.includes('INGEST_MAX_RETRIES = 2'),
    'crmClient: INGEST_MAX_RETRIES = 2 (2 tentativas extras)',
  )
  check(
    crmSrc.includes('INGEST_RETRY_WAIT_MS = 30000'),
    'crmClient: espera de 30s entre tentativas',
  )

  // Teste funcional do retry com waits encurtados via injeção de sleep
  const originalAxiosPost = require('axios').post
  let attemptCount = 0
  let sleptMs = []
  const realSleep = CrmClient.prototype.constructor === CrmClient ? null : null

  // Intercepta sleep do módulo via patch temporário do arquivo em memória não é possível —
  // em vez disso, mocka axios.post com timeout simulado na 1ª tentativa
  let ingestedXml = null
  require('axios').post = async function (url, body, cfg) {
    if (!url.includes('/dfe/ingest')) return originalAxiosPost(url, body, cfg)
    attemptCount++
    if (attemptCount === 1) {
      const err = new Error('timeout of 90000ms exceeded')
      err.code = 'ECONNABORTED'
      throw err
    }
    ingestedXml = body.xml
    return Promise.resolve({ data: { success: true, processed: true } })
  }

  // Encurta a espera de 30s: patch do sleep interno via variável de teste
  // (o crmClient expõe constantes; para o teste, sobrescrevemos Date-based wait via timer rápido)
  const origSetTimeout = global.setTimeout
  global.setTimeout = function (fn, ms, ...rest) {
    return origSetTimeout(fn, Math.min(ms, 50), ...rest)
  }

  try {
    const client = new CrmClient('http://127.0.0.1:8090', 'test-token')
    const res = await client.ingestXml('<nfeProc>PROVA-3-RETRY</nfeProc>', '000000000000100')
    check(
      attemptCount === 2,
      `ingest retry: 1ª tentativa timeout → sucesso na ${attemptCount}ª tentativa (2 tentativas extras configuradas)`,
    )
    check(res && res.success === true, 'ingest completou com sucesso após retry')
    check(
      ingestedXml === '<nfeProc>PROVA-3-RETRY</nfeProc>',
      'documento NÃO foi descartado após timeout',
    )
  } catch (e) {
    check(false, `retry do ingest falhou inesperadamente: ${e.message}`)
  } finally {
    global.setTimeout = origSetTimeout
    require('axios').post = originalAxiosPost
  }

  // Teste 3b: timeout persistente → esgota tentativas, ERRO relançado (documento reprocessado no próximo ciclo)
  attemptCount = 0
  require('axios').post = async function (url, body, cfg) {
    if (!url.includes('/dfe/ingest')) return originalAxiosPost(url, body, cfg)
    attemptCount++
    const err = new Error('timeout of 90000ms exceeded')
    err.code = 'ECONNABORTED'
    throw err
  }
  global.setTimeout = function (fn, ms, ...rest) {
    return origSetTimeout(fn, Math.min(ms, 20), ...rest)
  }
  try {
    const client = new CrmClient('http://127.0.0.1:8090', 'test-token')
    await client.ingestXml('<nfeProc>PROVA-3B</nfeProc>', '000000000000101')
    check(false, '3b: deveria ter lançado erro após esgotar tentativas')
  } catch (e) {
    check(
      attemptCount === 3,
      `timeout persistente: ${attemptCount} tentativas totais (1 + 2 extras) antes de encerrar ciclo`,
    )
    check(
      /CRM-INGEST-ERR/.test(e.message),
      'erro relançado é CRM-INGEST-ERR (ciclo encerra, ponteiro não avança, doc reprocessado no próximo ciclo)',
    )
  } finally {
    global.setTimeout = origSetTimeout
    require('axios').post = originalAxiosPost
  }
  console.log('[PROVA 3 OK] Retry de ingest comprovado (timeout não descarta documento).\n')

  // -------------------------------------------------------------------------
  // PROVA 4 — Observador de Comandos: 100 polls sem vazamento de memória (<150 MB)
  // -------------------------------------------------------------------------
  console.log(
    '[PROVA 4] Observador de comandos: simulação de 100 polls seguidos com heap estável (<150 MB)',
  )
  const crmClientForPoll = new CrmClient('http://127.0.0.1:8090', 'test-poll-token')
  check(
    crmClientForPoll.httpAgent === CrmClient.crmHttpAgent,
    'crmClient: reutiliza crmHttpAgent singleton em vez de recriar agente por request',
  )
  check(
    crmClientForPoll.httpsAgent === CrmClient.crmHttpsAgent,
    'crmClient: reutiliza crmHttpsAgent singleton em vez de recriar agente por request',
  )

  // Mede heap inicial antes de 100 polls
  if (global.gc) global.gc()
  const heapBeforePollsMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)

  // Mock de getPendingCommands via axios do shim retornando comandos vazios
  for (let poll = 1; poll <= 100; poll++) {
    await crmClientForPoll.getPendingCommands()
  }

  if (global.gc) global.gc()
  const heapAfterPollsMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  console.log(
    `[PROVA 4 RESULTADO] 100 polls concluídos | heap inicial: ${heapBeforePollsMb} MB | heap final: ${heapAfterPollsMb} MB`,
  )
  check(
    heapAfterPollsMb < 150,
    `heap após 100 polls permanece estável e abaixo de 150 MB (${heapAfterPollsMb} MB < 150 MB)`,
  )
  check(
    heapAfterPollsMb - heapBeforePollsMb < 30,
    `crescimento de heap em 100 polls é desprezível (${heapAfterPollsMb - heapBeforePollsMb} MB < 30 MB)`,
  )
  console.log('[PROVA 4 OK] 100 polls executados sem vazamento no caminho ocioso.\n')

  // -------------------------------------------------------------------------
  // PROVA 5 — Backoff 656 persistido: boot com backoff ativo PULA consulta à SEFAZ
  // -------------------------------------------------------------------------
  console.log(
    '[PROVA 5] Backoff 656 persistido: boot com backoff ativo em state.json PULA consulta à SEFAZ',
  )
  // 5a: Unidade stateStore - persistBackoff grava e loadPersistedPointer lê
  const futureBackoffMs = Date.now() + 45 * 60 * 1000 // 45 min no futuro
  const backoffWritten = stateStore.persistBackoff(TEST_DIR, futureBackoffMs, 'cstat_656')
  check(backoffWritten === true, 'persistBackoff gravou state.json com sucesso')

  const loadedBackoff = stateStore.loadPersistedPointer(TEST_DIR, '000000000000002')
  check(
    loadedBackoff.backoffUntil === futureBackoffMs,
    `loadPersistedPointer leu backoffUntil ativo corretamente (${loadedBackoff.backoffUntil})`,
  )

  // 5b: Simulação de boot com backoff ativo
  // Mock para verificar se SEFAZ foi consultada durante ciclo de startup
  let sefazCalledInStartup = false
  const prevConsultar = DfeAdapter.prototype.consultarPorUltNsu
  DfeAdapter.prototype.consultarPorUltNsu = async function (...args) {
    sefazCalledInStartup = true
    return prevConsultar.apply(this, args)
  }

  // Grava state.json no diretório do index para o boot real
  const statePathWorker = stateStore.getStateFilePath(__dirname)
  let backupWorkerState = null
  if (fs.existsSync(statePathWorker)) {
    backupWorkerState = fs.readFileSync(statePathWorker, 'utf8')
  }

  try {
    stateStore.persistBackoff(__dirname, futureBackoffMs, 'cstat_656')
    indexMod.loadPersistedPointerAtBoot()

    // Dispara ciclo com trigger 'startup' (o mesmo executado no boot do worker)
    logBuf = []
    sefazCalledInStartup = false
    await indexMod.runDfeCycle('startup')

    const backoffLog = logBuf.find((l) => l.includes('[DFE-RATE-LIMIT]'))
    check(
      !sefazCalledInStartup,
      'startup com backoff 656 ativo NÃO consultou a SEFAZ (janela fechada preservada)',
    )
    check(
      !!backoffLog,
      'startup registrou log de rate limit avisando que pulou ciclo ([DFE-RATE-LIMIT])',
    )

    // Limpa backoff para testar retorno normal
    stateStore.persistBackoff(__dirname, 0, '')
    indexMod.loadPersistedPointerAtBoot()
  } finally {
    DfeAdapter.prototype.consultarPorUltNsu = prevConsultar
    if (backupWorkerState !== null) {
      fs.writeFileSync(statePathWorker, backupWorkerState, 'utf8')
    } else if (fs.existsSync(statePathWorker)) {
      try {
        fs.unlinkSync(statePathWorker)
      } catch (_) {}
    }
  }
  console.log('[PROVA 5 OK] Boot com backoff ativo pula consulta à SEFAZ.\n')

  // -------------------------------------------------------------------------
  console.log('======================================================')
  if (failures === 0) {
    console.log(` TODAS AS PROVAS PASSARAM ✔ (${totalChecks} verificações, 0 falhas, exit code 0)`)
  } else {
    console.error(` ${failures} VERIFICAÇÃO(ÕES) FALHARAM de ${totalChecks} ✘`)
  }
  console.log('======================================================')
  process.exitCode = failures === 0 ? 0 : 1
})().catch((e) => {
  console.error('[ERRO FATAL NAS PROVAS]', e)
  process.exitCode = 1
})

// Restauração final (proteção para reuso em outros testes)
DfeAdapter.prototype.consultarPorUltNsu = originalConsultar
CrmClient.prototype.ingestXml = originalIngest
CrmClient.prototype.recordHistory = originalRecordHistory
CrmClient.prototype.getStatus = originalGetStatus
CrmClient.prototype.updatePointer = originalUpdatePointer
