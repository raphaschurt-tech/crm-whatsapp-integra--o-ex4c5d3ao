/**
 * Testes Unitários dos Gates DF-e (G1, G2, G3, G4, G5, G6, G8 e D5) e Adapter
 */
import { describe, it, expect } from 'vitest'
import DfeAdapter from '../../worker-dfe/dfeAdapter.js'

describe('DF-e Adapter & Real/Simulacao Mode', () => {
  it('instancia DfeAdapter e cai em simulação de forma controlada e transparente quando a lib ou certificado não estão no ambiente local de build', async () => {
    const adapter = new DfeAdapter({
      cnpj: '00496593000129',
      certPfxPath: './nao-existe.pfx',
      ambiente: '1',
    })

    const modeInfo = adapter.getMode()
    expect(modeInfo.mode).toBe('simulacao')

    const res = await adapter.consultarPorUltNsu('000000000000002')
    expect(res).toBeDefined()
    expect(res.cStat).toBe('137')
    expect(res.docs).toEqual([])
  })

  it('exporta funções e bundles de certificados SEFAZ SSL e ICP-Brasil', () => {
    const { loadIcpBrasilCaBundle, appendPemToBundle } = DfeAdapter
    expect(typeof loadIcpBrasilCaBundle).toBe('function')
    expect(typeof appendPemToBundle).toBe('function')

    const bundleInfo = loadIcpBrasilCaBundle()
    expect(bundleInfo.count).toBeGreaterThan(0)
    expect(bundleInfo.pemBundle).toContain('Autoridade Certificadora do SERPRO SSL')
  })

  it('analisa corretamente XML descompactado de NF-e completa, resumo e evento', () => {
    const adapter = new DfeAdapter({})

    // XML de Resumo
    const resXml =
      '<resNFe><chNFe>35250111222333000199550010000012341000012341</chNFe><vNF>1850.50</vNF></resNFe>'
    const parsedRes = adapter.analyzeUnzippedDoc(resXml, 'resNFe_v1.01.xsd', '000000000000001')
    expect(parsedRes.isSummary).toBe(true)
    expect(parsedRes.accessKey).toBe('35250111222333000199550010000012341000012341')
    expect(parsedRes.totalAmount).toBe(1850.5)

    // XML de Evento de Cancelamento
    const eventXml =
      '<procEventoNFe><infEvento><chNFe>35250111222333000199550010000012341000012341</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xJust>Erro de digitacao</xJust></infEvento></procEventoNFe>'
    const parsedEvent = adapter.analyzeUnzippedDoc(
      eventXml,
      'procEventoNFe_v1.00.xsd',
      '000000000000003',
    )
    expect(parsedEvent.isEvent).toBe(true)
    expect(parsedEvent.eventType).toBe('110111')
    expect(parsedEvent.eventSeq).toBe(1)
    expect(parsedEvent.justification).toBe('Erro de digitacao')
  })

  it('valida conversão de intervalo em expressão cron e guards de mínimo 1h', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workerModule = await import('../../worker-dfe/index.js')
    const { getCronExpressionForHours, applyConfiguredPollInterval, getActivePollIntervalHours } =
      workerModule.default || workerModule

    expect(getCronExpressionForHours(1)).toBe('0 * * * *')
    expect(getCronExpressionForHours(2)).toBe('0 */2 * * *')
    expect(getCronExpressionForHours(6)).toBe('0 */6 * * *')

    // Guard contra valor zero ou negativo (mínimo 1h)
    expect(getCronExpressionForHours(0)).toBe('0 * * * *')
    expect(getCronExpressionForHours(-5)).toBe('0 * * * *')

    // Aplicar intervalo 2h
    applyConfiguredPollInterval(2, 'test-unit')
    expect(getActivePollIntervalHours()).toBe(2)

    // Guard ao receber valor menor que 1h
    applyConfiguredPollInterval(0, 'test-guard')
    expect(getActivePollIntervalHours()).toBeGreaterThanOrEqual(1)

    // Se receber inválido, mantém o último válido conhecido
    applyConfiguredPollInterval(5, 'test-5h')
    expect(getActivePollIntervalHours()).toBe(5)
    applyConfiguredPollInterval('not-a-number', 'test-fail')
    expect(getActivePollIntervalHours()).toBe(5)
  })
})
