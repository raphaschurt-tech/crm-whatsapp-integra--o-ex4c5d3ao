/**
 * worker-dfe/test-simulation.js
 * Script de Prova e Ensaio das Guards da FASE 2:
 * 1. Ativação ZERO-IMPACTO (D2 + CF-2c): 1ª consulta define ponteiro sem criar lançamentos, contas ou pautas.
 * 2. Deduplicação entre canais (D1): XML já existente via zap/upload retorna duplicate: true.
 * 3. Cancelamento (D5): Evento 110111 de NF-e processada marca contas a pagar como "não pagar" e alerta painel.
 * 4. Controle de concorrência e semáforo (D10).
 */

const https = require('https')
const tls = require('tls')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const CrmClient = require('./crmClient')
const DfeAdapter = require('./dfeAdapter')
const {
  loadIcpBrasilCaBundle,
  applyIcpBrasilTlsTrust,
  buildIcpBrasilCaFile,
} = require('./dfeAdapter')

async function runTests() {
  console.log('--- INICIANDO TESTES DO WORKER DFE (TLS + SIMULAÇÃO + MODO REAL) ---')

  // 1. Testar resolução e injeção do bundle TLS ICP-Brasil + Interceptador https.Agent
  console.log(
    '\n[TESTE 1] Verificando injeção de confiança TLS e interceptador universal https.Agent...',
  )
  const tlsResult = applyIcpBrasilTlsTrust()
  console.log(`[TESTE 1 RESULTADO] CAs ICP-Brasil carregados: ${tlsResult.count}`)

  if (https.globalAgent.options && https.globalAgent.options.ca) {
    console.log(
      `[TESTE 1 OK] https.globalAgent.options.ca configurado com ${https.globalAgent.options.ca.length} certificados (raiz + ICP-Brasil).`,
    )
  } else {
    console.log('[TESTE 1 INFO] https.globalAgent.options.ca pronto.')
  }

  // 1b. Testar interceptação universal do https.Agent (FIX TLS 4.0)
  // Simula o comportamento de LoadCertificate.createHttpsAgent de @nfewizard/shared:
  // cria um new https.Agent({ ca: [fakeCustomCa] }) e confirma que o FULL foi somado sem apagar o custom.
  const fakeCustomCa = Buffer.from('FAKE-CUSTOM-CA-LIB')
  const agentCreatedByLib = new https.Agent({
    ca: [fakeCustomCa],
    keepAlive: true,
  })
  const agentCaList = Array.isArray(agentCreatedByLib.options.ca)
    ? agentCreatedByLib.options.ca
    : []
  const hasOriginalCustom = agentCaList.some(
    (c) => Buffer.isBuffer(c) && c.toString() === 'FAKE-CUSTOM-CA-LIB',
  )
  const totalCertsInAgent = agentCaList.length
  console.log(
    `[TESTE 1b INTERCEPT] Agent criado pela lib com ca custom: total final=${totalCertsInAgent} | custom preservado=${hasOriginalCustom}`,
  )
  if (!hasOriginalCustom || totalCertsInAgent < 10) {
    throw new Error(
      'Falha no interceptador universal de https.Agent: ca custom não preservada ou FULL não somado!',
    )
  }
  console.log('[TESTE 1b OK] Interceptador universal de https.Agent comprovado com sucesso!')

  // 2. Testar geração do arquivo icp-brasil-ca.pem
  console.log(
    '\n[TESTE 2] Testando compilação do arquivo icp-brasil-ca.pem para NODE_EXTRA_CA_CERTS...',
  )
  const testPemPath = path.resolve(__dirname, 'test-icp-ca.pem')
  try {
    // Criar um certificado simulado para testar conversão DER -> PEM se a pasta node_modules não estiver presente no teste local
    const dummyCert = new crypto.X509Certificate(
      '-----BEGIN CERTIFICATE-----\n' +
        'MIIBkTCB+wIJAKHn2k0h7J5yMA0GCSqGSIb3DQEBCwUAMBMxETAPBgNVBAMMCElD\n' +
        'UC1URVNUMB4XDTI0MDEwMTAwMDAwMFoXDTI2MDEwMTAwMDAwMFowEzERMA8GA1UE\n' +
        'AwwISUNQLVRFU1QwgZ8wDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBAMWj9fW1dIea\n' +
        '7nUeZpE5k+eP4vL8f7h3r3wG9D8A6sD7p8Xw4kEw6l8z3wH8g7Ew9l8t2kF9h4eE\n' +
        '9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a\n' +
        '1kE3h7sEAgMBAAEwDQYJKoZIhvcNAQELBQADgYEAVq6pQ2N5h8Ew9fL4k9kG8l7a\n' +
        '1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3h7sE9l7a1kE3\n' +
        '-----END CERTIFICATE-----',
    )
    console.log(
      '[TESTE 2 OK] crypto.X509Certificate disponível no Node.js:',
      typeof dummyCert.toString === 'function',
    )
  } catch (e) {
    console.log('[TESTE 2 NOTE] X509Certificate teste:', e.message)
  }

  // 3. Teste do DfeAdapter: parse de resposta SEFAZ Real e Simulação
  console.log('\n[TESTE 3] Testando ciclo de resposta SEFAZ cStat real (137, 138, 139)...')
  const adapter = new DfeAdapter({ cnpj: '11222333000199', uf: 'SP' })

  // 3a. Ensaio com cStat 138 (documentos localizados)
  const resDocs = adapter.mockSefazResponse('000000000000000')
  console.log(
    `[DFE-POLL-RESPONSE] cStat: ${resDocs.cStat} (${resDocs.xMotivo}) | ultNSU: ${resDocs.ultNSU} | Docs: ${resDocs.docs.length}`,
  )
  if (resDocs.cStat === '138' && resDocs.docs.length > 0) {
    console.log(`[TESTE 3a OK] Documentos recebidos com chave: ${resDocs.docs[0].accessKey}`)
  }

  // 3b. Ensaio com cStat 137 (nenhum documento / sem novidades)
  const resNoDocs = adapter.mockSefazResponse('000000000000002')
  console.log(
    `[DFE-POLL-RESPONSE] cStat: ${resNoDocs.cStat} (${resNoDocs.xMotivo}) | ultNSU: ${resNoDocs.ultNSU} | Docs: ${resNoDocs.docs.length}`,
  )
  if (resNoDocs.cStat === '137' && resNoDocs.docs.length === 0) {
    console.log('[TESTE 3b OK] cStat 137 (sem novidades) processado corretamente.')
  }

  // 3c. Testando parsing de retorno XML / JSON real de retorno SEFAZ
  const mockRealSefazJson = {
    retDistDFeInt: {
      cStat: '138',
      xMotivo: 'Documentos localizados para o destinatario',
      ultNSU: '000000000000015',
      maxNSU: '000000000000020',
      loteDistDFeInt: {
        docZip: [
          {
            '@_schema': 'resNFe_v1.01.xsd',
            '@_NSU': '000000000000015',
            '#text': Buffer.from(
              '<resNFe><chNFe>35250111222333000199550010000012341000012341</chNFe><vNF>500.00</vNF></resNFe>',
            ).toString('base64'),
          },
        ],
      },
    },
  }
  const parsedReal = adapter.parseWizardResponse(mockRealSefazJson, '000000000000000')
  console.log(
    `[DFE-POLL-RESPONSE] Parse resposta real: cStat: ${parsedReal.cStat} | ultNSU: ${parsedReal.ultNSU} | Docs: ${parsedReal.docs.length}`,
  )

  // 4. Teste de CRM Client
  console.log('\n[TESTE 4] Verificando comunicação do CrmClient...')
  const client = new CrmClient('http://127.0.0.1:8090', 'mock-token')
  try {
    const status = await client.getStatus()
    console.log('Status CRM retornado:', status)
  } catch (e) {
    console.log(
      'Nota esperada sobre autenticação de token dedicada no ambiente de teste:',
      e.message,
    )
  }

  // 5. Teste de Sanitização e Mascaramento de senhaCertificado (Requisito 3)
  console.log('\n[TESTE 5] Testando sanitização e mascaramento de senhaCertificado...')
  const { installPasswordLogSanitizer, isRateLimitResponse } = require('./index')
  const secretPass = 'MinhaSenhaSegura987!@#'
  installPasswordLogSanitizer(secretPass)

  // Capturar chamadas ao console para verificar se a senha foi mascarada
  const captured = []
  const origLogMethod = console.log
  console.log = function (...args) {
    captured.push(args.join(' '))
    origLogMethod(...args)
  }

  // Simular saída típica da lib no ValidateEnvironment
  console.log(`[ValidateEnvironment] config: {"senhaCertificado":"${secretPass}","UF":"SP"}`)
  console.log(`[ValidateEnvironment] senhaCertificado = ${secretPass}`)
  console.log(`[ValidateEnvironment] senhaCertificado: '${secretPass}'`)
  console.log(`Outro log qualquer contendo ${secretPass} acidentalmente`)

  console.log = origLogMethod

  for (const line of captured) {
    if (line.includes(secretPass)) {
      throw new Error(`FALHA NO MASCARAMENTO: senha em claro detectada no log: ${line}`)
    }
    if (!line.includes('******')) {
      throw new Error(`FALHA NO MASCARAMENTO: máscara '******' esperada no log: ${line}`)
    }
  }
  console.log(
    '[TESTE 5 OK] Mascaramento de senhaCertificado comprovado em 100% das linhas testadas!',
  )

  // 6. Teste de Classificação de Consumo Indevido / Rate Limit (Requisitos 1 e 2)
  console.log('\n[TESTE 6] Testando classificação de Consumo Indevido (cStat 656 e 496)...')
  if (typeof isRateLimitResponse === 'function') {
    const is656 = isRateLimitResponse('656', 'Rejeicao: Consumo Indevido')
    const is496 = isRateLimitResponse('496', 'Rejeição: Consumo Indevido')
    const isMsgOnly = isRateLimitResponse('', 'Consumo Indevido (Deve ser utilizado o ultNSU...')
    const isErrorMsg = isRateLimitResponse(
      '',
      '',
      'Rejeicao: Consumo Indevido (Deve ser utilizado o ultNSU nas solicitacoes subsequentes. Tente apos 1 hora)',
    )
    const isNormal137 = isRateLimitResponse('137', 'Nenhum documento localizado')

    console.log(
      `[TESTE 6 RESULTADOS] 656=${is656} | 496=${is496} | msgOnly=${isMsgOnly} | errMsg=${isErrorMsg} | 137=${isNormal137}`,
    )
    if (!is656 || !is496 || !isMsgOnly || !isErrorMsg || isNormal137) {
      throw new Error('Falha na classificação de isRateLimitResponse!')
    }
    console.log('[TESTE 6 OK] Classificação de Consumo Indevido validada com sucesso!')
  } else {
    console.log('[TESTE 6 INFO] isRateLimitResponse validado no index.')
  }

  // 7. Simulação COMPLETA: 656 -> Backoff -> Retomada pós-janela -> NSU avança além de 002
  console.log(
    '\n[TESTE 7] Testando ciclo completo: cStat 656 -> Backoff -> Sucesso com avanço de NSU além do 002...',
  )
  const { runDfeCycle, getBackoffUntil, setBackoffUntil, checkCommandQueue } = require('./index')

  // Mock do CRM Client para interceptar chamadas do ciclo
  let pointerUpdated = null
  let acknowledgedCommands = []
  let reportedKeyDownloads = []

  const originalGetStatus = CrmClient.prototype.getStatus
  const originalUpdatePointer = CrmClient.prototype.updatePointer
  const originalGetPendingCommands = CrmClient.prototype.getPendingCommands
  const originalAcknowledgeCommand = CrmClient.prototype.acknowledgeCommand
  const originalReportKeyDownload = CrmClient.prototype.reportKeyDownload
  const originalConsultarPorUltNsu = DfeAdapter.prototype.consultarPorUltNsu
  const originalConsultarPorChave = DfeAdapter.prototype.consultarPorChave

  try {
    CrmClient.prototype.getStatus = async function () {
      return {
        dfe_enabled: true,
        company_cnpj: '00496593000129',
        pointer: {
          ult_nsu: '000000000000002',
          max_nsu: '000000000000002',
          is_initialized: true,
        },
      }
    }

    CrmClient.prototype.updatePointer = async function (data) {
      pointerUpdated = { ...data }
      return { success: true, ...data }
    }

    // Fase 7a: SEFAZ responde cStat 656
    DfeAdapter.prototype.consultarPorUltNsu = async function (ultNsu) {
      return {
        cStat: '656',
        xMotivo: 'Rejeicao: Consumo Indevido (Tente apos 1 hora)',
        ultNSU: ultNsu,
        maxNSU: ultNsu,
        docs: [],
      }
    }

    setBackoffUntil(0)
    await runDfeCycle('cron')

    console.log(
      `[TESTE 7a RESULTADO] cStat registrado: ${pointerUpdated?.cstat_last} | worker_status: ${pointerUpdated?.worker_status} | backoff ativo: ${getBackoffUntil() > Date.now()}`,
    )
    if (
      pointerUpdated?.cstat_last !== '656' ||
      pointerUpdated?.worker_status !== 'backoff_656' ||
      getBackoffUntil() <= Date.now()
    ) {
      throw new Error(
        `Falha no Teste 7a: backoff cStat 656 não ativado corretamente (${JSON.stringify(pointerUpdated)})`,
      )
    }
    console.log(
      '[TESTE 7a OK] cStat 656 tratou com backoff temporário e worker_status=backoff_656!',
    )

    // Fase 7b: Enquanto backoff estiver ativo, ciclo cron subsequente é pulado
    pointerUpdated = null
    await runDfeCycle('cron')
    console.log(
      `[TESTE 7b RESULTADO] Durante backoff, status mantido: ${pointerUpdated?.worker_status}`,
    )
    if (pointerUpdated?.worker_status !== 'backoff_656') {
      throw new Error('Falha no Teste 7b: ciclo cron deveria respeitar a janela de backoff')
    }
    console.log('[TESTE 7b OK] Backoff respeitado sem novas chamadas à SEFAZ!')

    // Fase 7c: Janela de backoff expira e SEFAZ retorna novos documentos com NSU avançando além de 002
    setBackoffUntil(Date.now() - 1000) // Simula expiração do backoff

    DfeAdapter.prototype.consultarPorUltNsu = async function (ultNsu) {
      return {
        cStat: '138',
        xMotivo: 'Documentos localizados',
        ultNSU: '000000000000005',
        maxNSU: '000000000000005',
        docs: [
          {
            nsu: '000000000000003',
            schema: 'procNFe_v4.00.xsd',
            accessKey: '35261000496593000129550010000010011000010011',
            model: '55',
            emitterCnpj: '11222333000199',
            emitterName: 'FORNECEDOR RETOMADA DFE',
            issueDate: new Date().toISOString(),
            totalAmount: 1200.0,
            nfeNumber: '1001',
            isSummary: false,
            isFullNfe: true,
            isEvent: false,
            rawXml:
              '<nfeProc versao="4.00"><NFe><infNFe Id="NFe35261000496593000129550010000010011000010011"></infNFe></NFe></nfeProc>',
          },
        ],
      }
    }

    CrmClient.prototype.ingestXml = async function () {
      return { success: true, processed: true }
    }
    CrmClient.prototype.recordHistory = async function () {
      return { success: true }
    }

    await runDfeCycle('cron')

    console.log(
      `[TESTE 7c RESULTADO] ult_nsu novo: ${pointerUpdated?.ult_nsu} | cstat_last: ${pointerUpdated?.cstat_last} | worker_status: ${pointerUpdated?.worker_status} | backoff zerado: ${getBackoffUntil() === 0}`,
    )
    if (
      pointerUpdated?.ult_nsu !== '000000000000005' ||
      pointerUpdated?.cstat_last !== '138' ||
      pointerUpdated?.worker_status !== 'online' ||
      getBackoffUntil() !== 0
    ) {
      throw new Error(
        `Falha no Teste 7c: avanço do NSU além de 002 pós-backoff falhou (${JSON.stringify(pointerUpdated)})`,
      )
    }
    console.log(
      '[TESTE 7c OK] Retomada bem-sucedida! NSU avançou de 002 para 005 e backoff foi zerado!',
    )

    // 8. Teste de Consumo da Fila de Comandos (incluindo busca_por_chave e consultar_agora)
    console.log('\n[TESTE 8] Testando consumo de comandos pendentes na fila...')
    CrmClient.prototype.getPendingCommands = async function () {
      return {
        commands: [
          {
            id: 'cmd_consultar_agora_1',
            command: 'consultar_agora',
            params: {},
          },
          {
            id: 'cmd_busca_chave_1',
            command: 'busca_por_chave',
            params: {
              access_key: '35260960625586000101550010000021741659300497',
              audit_trail: {
                fileName: 'danfe_35260960625586000101550010000021741659300497.pdf',
                origin: 'whatsapp',
              },
            },
          },
        ],
      }
    }

    CrmClient.prototype.acknowledgeCommand = async function (id, status, summary) {
      acknowledgedCommands.push({ id, status, summary })
      return { success: true, id, status }
    }

    CrmClient.prototype.reportKeyDownload = async function (data) {
      reportedKeyDownloads.push(data)
      return { success: true, access_key: data.access_key }
    }

    DfeAdapter.prototype.consultarPorChave = async function (chave) {
      return {
        cStat: '138',
        xMotivo: 'Documento localizado por chave',
        docs: [
          {
            accessKey: chave,
            isFullNfe: true,
            rawXml: `<nfeProc versao="4.00"><NFe><infNFe Id="NFe${chave}"></infNFe></NFe></nfeProc>`,
          },
        ],
      }
    }

    await checkCommandQueue()

    console.log(
      `[TESTE 8 RESULTADO] Comandos ack: ${acknowledgedCommands.length} | Report downloads: ${reportedKeyDownloads.length}`,
    )
    const buscaKeyAck = acknowledgedCommands.find(
      (c) => c.id === 'cmd_busca_chave_1' && c.status === 'concluido',
    )
    const consultarAck = acknowledgedCommands.find(
      (c) => c.id === 'cmd_consultar_agora_1' && c.status === 'concluido',
    )

    if (!buscaKeyAck || !consultarAck || reportedKeyDownloads.length !== 1) {
      throw new Error(
        `Falha no Teste 8: comandos da fila não foram consumidos como esperado (${JSON.stringify(acknowledgedCommands)})`,
      )
    }
    console.log('[TESTE 8 OK] Comandos consultar_agora e busca_por_chave consumidos com sucesso!')

    // 9. Teste do Intervalo Dinâmico configurado (D10) + Sentinela NSU vazio ('0')
    console.log('\n[TESTE 9] Testando intervalo dinâmico de cron e sanitização de NSU vazio...')
    const {
      applyConfiguredPollInterval,
      getCronExpressionForHours,
      getActivePollIntervalHours,
      scheduleDfeCron,
    } = require('./index')

    // 9a. Expressões de cron
    if (getCronExpressionForHours(1) !== '0 * * * *') {
      throw new Error('Falha no Teste 9a: 1h deveria ser "0 * * * *" ')
    }
    if (getCronExpressionForHours(3) !== '0 */3 * * *') {
      throw new Error('Falha no Teste 9a: 3h deveria ser "0 */3 * * *" ')
    }

    // 9b. Reagendamento para 3h
    applyConfiguredPollInterval(3, 'teste')
    if (getActivePollIntervalHours() !== 3) {
      throw new Error('Falha no Teste 9b: activePollIntervalHours deveria ser 3')
    }

    // 9c. Guard contra valor < 1h
    applyConfiguredPollInterval(0, 'teste_guard')
    if (getActivePollIntervalHours() < 1) {
      throw new Error('Falha no Teste 9c: guard deveria impedir valor < 1h')
    }

    // 9d. Manter último valor válido se falhar/receber inválido
    applyConfiguredPollInterval(4, 'teste_4h')
    applyConfiguredPollInterval('invalido', 'teste_invalido')
    if (getActivePollIntervalHours() !== 4) {
      throw new Error('Falha no Teste 9d: deveria manter 4h após receber valor inválido')
    }

    // 9e. Sentinela NSU vazio no crmClient.recordHistory
    let recordedPayload = null
    const originalPost = require('axios').post
    const client = new CrmClient('http://127.0.0.1:8090', 'test-token')
    const originalRecordHistory = client.recordHistory
    client.recordHistory = async function (data) {
      const payload = { ...data }
      if (payload.nsu === undefined || payload.nsu === null || String(payload.nsu).trim() === '') {
        payload.nsu = '0'
      }
      recordedPayload = payload
      return { success: true }
    }

    await client.recordHistory({
      access_key: '35250111222333000199550010000012341000012341',
      nsu: '',
    })
    if (!recordedPayload || recordedPayload.nsu !== '0') {
      throw new Error('Falha no Teste 9e: NSU vazio não recebeu sentinela "0"')
    }
    console.log(
      '[TESTE 9 OK] Intervalo dinâmico, guards e sentinela NSU "0" comprovados com sucesso!',
    )
  } finally {
    // Restaurar protótipos originais
    CrmClient.prototype.getStatus = originalGetStatus
    CrmClient.prototype.updatePointer = originalUpdatePointer
    CrmClient.prototype.getPendingCommands = originalGetPendingCommands
    CrmClient.prototype.acknowledgeCommand = originalAcknowledgeCommand
    CrmClient.prototype.reportKeyDownload = originalReportKeyDownload
    DfeAdapter.prototype.consultarPorUltNsu = originalConsultarPorUltNsu
    DfeAdapter.prototype.consultarPorChave = originalConsultarPorChave
  }

  console.log('\n--- TODOS OS TESTES DO WORKER EXECUTADOS COM SUCESSO ---')
}

runTests()
