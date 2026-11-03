/**
 * Teste de regressão G-E — CFOP Guard & Sugestão de Entrada no Pipeline de NF-e
 * (pocketbase/hooks/nfe_pipeline.js e pocketbase/hooks/nfe_email_inbox.js)
 *
 * Regras contábeis validadas e testadas:
 * (1) Notas com CFOP de origem de venda de produção própria:
 *     - 5102 (interna) ou 6102 (interestadual)
 *     - Variantes com ST: 5405, 6403, 6405
 *     - Históricos: 1102, 2102
 *     São ACEITAS como compra direta e liberadas pelo Guard.
 *     CFOPs de devolução/ajuste/transferência/outros (ex: 5202, 5949, 1949, 6202) são RETIDOS em revisão.
 *
 * (2) O CFOP do emitente é informação de origem e NUNCA é copiado para o CFOP de entrada:
 *     - Destino Revenda -> 1102 (interna) / 2102 (interestadual)
 *       Se com ST (5405/6403/6405) -> 1403 (interna) / 2403 (interestadual)
 *     - Destino Insumo de Produção -> 1101 (interna) / 2101 (interestadual)
 *     - Destino Insumo de Consumo -> 1556 (interna) / 2556 (interestadual)
 *
 * (3) Defaults temporários por fornecedor (substituíveis na F4 por atributo de natureza):
 *     - Jahu Borrachas (CNPJ raiz 61136701 ou nome JAHU) -> revenda
 *     - MEC LAN (CNPJ raiz 62538228 ou nome MEC LAN) -> revenda
 *     - Oxilapa (CNPJ raiz 59417469 ou nome OXILAPA) -> insumo_producao
 *     - Outros fornecedores sem default -> classificacao_pendente
 *
 * (4) Tratamento de Substituição Tributária (ST):
 *     - Alerta de conferência do destaque de ICMS-ST ativado para 5405, 6403, 6405.
 *
 * Execução: npx tsx src/lib/cfopGuardRegression.test.ts
 */

export const ACCEPTED_ORIGIN_CFOPS = ['5102', '6102', '5405', '6403', '6405', '1102', '2102']
export const ST_CFOPS = ['5405', '6403', '6405']

export type DeclaredDestiny =
  | 'revenda'
  | 'insumo_producao'
  | 'insumo_consumo'
  | 'classificacao_pendente'
  | ''

export function resolveSupplierNatureDefault(
  cnpjDigits: unknown,
  suppName: unknown,
): DeclaredDestiny {
  const cnpj = String(cnpjDigits || '').replace(/\D/g, '')
  const name = String(suppName || '').toUpperCase()

  // Jahu Borrachas: CNPJ raiz 61.136.701 (matriz 0001-47, filiais 0007-32 etc.)
  if (cnpj.startsWith('61136701') || name.includes('JAHU')) {
    return 'revenda'
  }
  // MEC LAN: CNPJ 62.538.228/0001-97
  if (cnpj.startsWith('62538228') || name.includes('MEC LAN') || name.includes('MECLAN')) {
    return 'revenda'
  }
  // Oxilapa: CNPJ 59.417.469/0001-73
  if (cnpj.startsWith('59417469') || name.includes('OXILAPA')) {
    return 'insumo_producao'
  }
  return ''
}

export function computeSuggestedEntryCfop(
  originCfop: unknown,
  declaredDestiny: DeclaredDestiny,
): string {
  const oCfop = String(originCfop || '').trim()
  const isInterstate = oCfop.startsWith('6') || oCfop.startsWith('2')
  const hasSt = ST_CFOPS.includes(oCfop)

  if (declaredDestiny === 'insumo_consumo') {
    return isInterstate ? '2556' : '1556'
  }
  if (declaredDestiny === 'insumo_producao') {
    return isInterstate ? '2101' : '1101'
  }
  if (declaredDestiny === 'revenda') {
    if (hasSt) {
      return isInterstate ? '2403' : '1403'
    }
    return isInterstate ? '2102' : '1102'
  }
  // Sem default declarado: sugestão preliminar neutra mantendo regra de ST
  if (hasSt) {
    return isInterstate ? '2403' : '1403'
  }
  return isInterstate ? '2102' : '1102'
}

export interface NfeGuardItem {
  cfop: string
  vProd?: number
  cfop_origem?: string
  cfop_entrada_sugerido?: string
  destino_declarado?: string
  has_st?: boolean
}

export interface NfeGuardInput {
  emitCnpj: string
  emitName: string
  items: NfeGuardItem[]
}

export interface NfeGuardResult {
  isException: boolean
  exceptionReason: string
  hasStAlert: boolean
  supplierNatureDefault: DeclaredDestiny
  enrichedItems: NfeGuardItem[]
}

export function evaluateCfopGuard(parsed: NfeGuardInput): NfeGuardResult {
  let isException = false
  let exceptionReason = ''
  let hasStAlert = false
  const supplierNatureDefault = resolveSupplierNatureDefault(parsed.emitCnpj, parsed.emitName)

  let hasNonPurchaseCfop = false
  let invalidCfop = ''

  for (let c = 0; c < parsed.items.length; c++) {
    const itCfop = String(parsed.items[c].cfop || '').trim()
    if (!ACCEPTED_ORIGIN_CFOPS.includes(itCfop)) {
      hasNonPurchaseCfop = true
      invalidCfop = itCfop
      break
    }
    if (ST_CFOPS.includes(itCfop)) {
      hasStAlert = true
    }
  }

  if (hasNonPurchaseCfop) {
    isException = true
    exceptionReason =
      'CFOP não padrão para compra direta (' +
      invalidCfop +
      '). Devolução, ajuste ou transferência requer revisão manual.'
  }

  const enrichedItems: NfeGuardItem[] = []
  if (!isException) {
    for (let c = 0; c < parsed.items.length; c++) {
      const it = { ...parsed.items[c] }
      const originCfop = String(it.cfop || '').trim()
      const itemDestiny = supplierNatureDefault || 'classificacao_pendente'
      const suggestedEntryCfop = computeSuggestedEntryCfop(originCfop, itemDestiny)
      it.cfop_origem = originCfop
      it.cfop_entrada_sugerido = suggestedEntryCfop
      it.destino_declarado = itemDestiny
      it.has_st = ST_CFOPS.includes(originCfop)
      enrichedItems.push(it)
    }
  }

  return {
    isException,
    exceptionReason,
    hasStAlert,
    supplierNatureDefault,
    enrichedItems,
  }
}

// ============================================================
// Execução dos testes
// ============================================================
let pass = 0
let fail = 0

function assertCheck(name: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (ok) {
    pass++
    console.log(`  ✔ ${name} → ${JSON.stringify(got)}`)
  } else {
    fail++
    console.error(
      `  ✘ ${name}\n      esperado: ${JSON.stringify(expected)}\n      obtido:   ${JSON.stringify(got)}`,
    )
  }
}

console.log('\n=== G-E: Regressão do Guard de CFOP e Sugestão de Entrada (NF-e Pipeline) ===\n')

// 1. Prova 1: Nota 5102 da Jahu é aceita pelo guard e sugere CFOP de entrada 1102 (revenda)
console.log('1. CASO JAHU BORRACHAS (CFOP 5102 - venda produção própria interna):')
const jahuCase = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS E AUTOPECAS LTDA',
  items: [{ cfop: '5102', vProd: 1250.0 }],
})
assertCheck('Jahu 5102 não é exceção', jahuCase.isException, false)
assertCheck('Jahu default é revenda', jahuCase.supplierNatureDefault, 'revenda')
assertCheck('Jahu entrada sugerida é 1102', jahuCase.enrichedItems[0].cfop_entrada_sugerido, '1102')
assertCheck('Jahu CFOP origem preservado como 5102', jahuCase.enrichedItems[0].cfop_origem, '5102')
assertCheck(
  'Jahu CFOP emitente NUNCA copiado para entrada',
  jahuCase.enrichedItems[0].cfop_entrada_sugerido !== jahuCase.enrichedItems[0].cfop_origem,
  true,
)
assertCheck('Jahu sem ST', jahuCase.hasStAlert, false)

// 2. Prova 2: Nota da Oxilapa sugere entrada 1101 (insumo de produção)
console.log('\n2. CASO OXILAPA (CFOP 5102 - insumo de produção):')
const oxilapaCase = evaluateCfopGuard({
  emitCnpj: '59417469000173',
  emitName: 'OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA',
  items: [{ cfop: '5102', vProd: 320.0 }],
})
assertCheck('Oxilapa 5102 não é exceção', oxilapaCase.isException, false)
assertCheck(
  'Oxilapa default é insumo_producao',
  oxilapaCase.supplierNatureDefault,
  'insumo_producao',
)
assertCheck(
  'Oxilapa entrada sugerida é 1101',
  oxilapaCase.enrichedItems[0].cfop_entrada_sugerido,
  '1101',
)
assertCheck(
  'Oxilapa CFOP emitente NUNCA copiado para entrada',
  oxilapaCase.enrichedItems[0].cfop_entrada_sugerido !== '5102',
  true,
)

// 3. Prova 3: Interestadual 6102 -> sugere 2102 (revenda) ou 2101 (insumo)
console.log('\n3. CASO INTERESTADUAL 6102:')
const interstateJahu = evaluateCfopGuard({
  emitCnpj: '61136701000732',
  emitName: 'JAHU BORRACHAS E AUTOPECAS LTDA (FILIAL)',
  items: [{ cfop: '6102', vProd: 500.0 }],
})
assertCheck('Interestadual 6102 não é exceção', interstateJahu.isException, false)
assertCheck(
  'Interestadual 6102 sugere 2102 para revenda',
  interstateJahu.enrichedItems[0].cfop_entrada_sugerido,
  '2102',
)

const interstateOxilapa = evaluateCfopGuard({
  emitCnpj: '59417469000173',
  emitName: 'OXILAPA GASES',
  items: [{ cfop: '6102', vProd: 800.0 }],
})
assertCheck(
  'Interestadual 6102 sugere 2101 para insumo de produção',
  interstateOxilapa.enrichedItems[0].cfop_entrada_sugerido,
  '2101',
)

// 4. Prova 4: Notas com ST (5405 interna / 6405 interestadual) -> entrada 1403 / 2403 + Alerta ST
console.log('\n4. CASO SUBSTITUIÇÃO TRIBUTÁRIA (ST - 5405 e 6405):')
const stCaseInternal = evaluateCfopGuard({
  emitCnpj: '62538228000197',
  emitName: 'MEC LAN INDUSTRIA E COMERCIO LTDA EPP',
  items: [{ cfop: '5405', vProd: 450.0 }],
})
assertCheck('MEC LAN 5405 aceito pelo guard', stCaseInternal.isException, false)
assertCheck('MEC LAN 5405 ativa alerta de conferência de ICMS-ST', stCaseInternal.hasStAlert, true)
assertCheck(
  'MEC LAN 5405 sugere entrada 1403 (revenda com ST interna)',
  stCaseInternal.enrichedItems[0].cfop_entrada_sugerido,
  '1403',
)

const stCaseInterstate = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS',
  items: [{ cfop: '6405', vProd: 900.0 }],
})
assertCheck('ST Interestadual 6405 aceito pelo guard', stCaseInterstate.isException, false)
assertCheck(
  'ST Interestadual 6405 ativa alerta de conferência de ICMS-ST',
  stCaseInterstate.hasStAlert,
  true,
)
assertCheck(
  'ST Interestadual 6405 sugere entrada 2403 (revenda com ST interestadual)',
  stCaseInterstate.enrichedItems[0].cfop_entrada_sugerido,
  '2403',
)

const stCase6403 = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS',
  items: [{ cfop: '6403', vProd: 1100.0 }],
})
assertCheck('ST Interestadual 6403 aceito pelo guard', stCase6403.isException, false)
assertCheck(
  'ST Interestadual 6403 sugere entrada 2403',
  stCase6403.enrichedItems[0].cfop_entrada_sugerido,
  '2403',
)
assertCheck('ST Interestadual 6403 ativa alerta ST', stCase6403.hasStAlert, true)

// 5. Prova 5: Insumo de Consumo (1556 / 2556)
console.log('\n5. CASO INSUMO DE CONSUMO (1556 interna / 2556 interestadual):')
assertCheck(
  'Insumo de consumo interno sugere 1556',
  computeSuggestedEntryCfop('5102', 'insumo_consumo'),
  '1556',
)
assertCheck(
  'Insumo de consumo interestadual sugere 2556',
  computeSuggestedEntryCfop('6102', 'insumo_consumo'),
  '2556',
)

// 6. Prova 6: CFOPs não aceitos (devoluções, remessas, transferências) continuam retidos em revisão
console.log('\n6. CASOS DE EXCEÇÃO (CFOPs não padrão de compra):')
const devoluCase = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS',
  items: [{ cfop: '5202', vProd: 100.0 }],
})
assertCheck('CFOP 5202 de devolução é retido em revisão', devoluCase.isException, true)
assertCheck(
  'Mensagem de exceção contém o CFOP não padrão',
  devoluCase.exceptionReason.includes('5202'),
  true,
)

const remessaCase = evaluateCfopGuard({
  emitCnpj: '11222333000199',
  emitName: 'FORNECEDOR DIVERSO',
  items: [{ cfop: '5949', vProd: 200.0 }],
})
assertCheck('CFOP 5949 de remessa é retido em revisão', remessaCase.isException, true)

// 7. Prova 7: Fornecedor desconhecido / sem default hardcoded
console.log('\n7. CASO FORNECEDOR SEM DEFAULT:')
const unknownSupplierCase = evaluateCfopGuard({
  emitCnpj: '99888777000166',
  emitName: 'PARAFUSOS SILVA LTDA',
  items: [{ cfop: '5102', vProd: 300.0 }],
})
assertCheck('Fornecedor sem default aceito pelo guard', unknownSupplierCase.isException, false)
assertCheck(
  'Destino declarado é classificacao_pendente',
  unknownSupplierCase.enrichedItems[0].destino_declarado,
  'classificacao_pendente',
)
assertCheck(
  'Entrada sugerida preliminar neutra é 1102',
  unknownSupplierCase.enrichedItems[0].cfop_entrada_sugerido,
  '1102',
)

console.log(`\nResultado: ${pass} passaram, ${fail} falharam.\n`)

if (fail > 0) {
  throw new Error(`CFOP guard regression test failed: ${fail} failure(s)`)
}
