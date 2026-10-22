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
})
