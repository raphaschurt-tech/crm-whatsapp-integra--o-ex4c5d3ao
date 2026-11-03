/**
 * Teste de regressão G-E — CFOP Guard & Sugestão de Entrada no Pipeline de NF-e
 * F4 (versão 0.0.266): Natureza por atributo + Motor de Dedupe e Auto-cadastro
 * (pocketbase/hooks/nfe_pipeline.js, pocketbase/hooks/nfe_email_inbox.js e pocketbase/hooks/nfe_supplier_registry.js)
 *
 * Regras contábeis e de fornecedor validadas e testadas:
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
 * (3) F4: Natureza do fornecedor lida do atributo supplier_nature no cadastro:
 *     - Jahu Borrachas (atributo = 'revenda') -> revenda -> 1102 / 2102
 *     - MEC LAN (atributo = 'revenda') -> revenda -> 1102 / 2102 (ou 1403 se ST)
 *     - Oxilapa (atributo = 'insumo_producao') -> insumo_producao -> 1101 / 2101
 *     - Fornecedor sem atributo (vazio) -> 'classificacao_pendente' (classificação no lançamento, nota segue)
 *
 * (4) F4: Motor de Dedupe e Auto-cadastro de fornecedor via XML:
 *     - Cenário 1: CNPJ novo -> cadastra automaticamente com raiz CNPJ, customer_documents e dados do XML
 *     - Cenário 2: Segunda nota do mesmo CNPJ -> vincula ao fornecedor existente SEM duplicar
 *     - Cenário 3: Nota de filial (mesma raiz CNPJ) -> vincula à mesma entidade existente
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

export interface SupplierRecordStub {
  id: string
  name: string
  company?: string
  cnpj?: string
  phone?: string
  email?: string
  customer_type?: string
  supplier_nature?: 'revenda' | 'insumo_producao' | 'insumo_consumo' | ''
  source?: string
  notes?: string
}

export interface CustomerDocumentStub {
  id: string
  customer: string
  document_type: string
  document_number: string
  is_primary?: boolean
}

/**
 * F4: Guard lê supplier_nature do fornecedor (fallback: classificacao_pendente).
 * Não há mais defaults hardcoded por nome ou CNPJ no código do guard.
 */
export function resolveSupplierNatureFromRecord(
  supplier: SupplierRecordStub | null | undefined,
): DeclaredDestiny {
  if (!supplier) return ''
  const nature = supplier.supplier_nature || ''
  if (nature === 'revenda' || nature === 'insumo_producao' || nature === 'insumo_consumo') {
    return nature
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
  supplier?: SupplierRecordStub | null
  items: NfeGuardItem[]
}

export interface NfeGuardResult {
  isException: boolean
  exceptionReason: string
  hasStAlert: boolean
  supplierNature: DeclaredDestiny
  enrichedItems: NfeGuardItem[]
}

export function evaluateCfopGuard(parsed: NfeGuardInput): NfeGuardResult {
  let isException = false
  let exceptionReason = ''
  let hasStAlert = false
  const supplierNature = resolveSupplierNatureFromRecord(parsed.supplier)

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
      const itemDestiny = supplierNature || 'classificacao_pendente'
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
    supplierNature,
    enrichedItems,
  }
}

// ============================================================
// F4: Simulador do Motor de Dedupe & Auto-cadastro
// Reproduz fielmente a lógica de nfe_supplier_registry.js
// ============================================================
export interface DedupeStore {
  customers: SupplierRecordStub[]
  documents: CustomerDocumentStub[]
}

export interface EmitXmlInput {
  cnpj?: string
  name?: string
  fant?: string
  ie?: string
  phone?: string
  email?: string
  address?: string
}

export interface DedupeResolveResult {
  supplier: SupplierRecordStub
  matchedBy: 'cnpj_exact' | 'cnpj_document' | 'cnpj_root' | 'phone_variant' | 'created_new'
  wasCreated: boolean
  matchedEntityId?: string
}

export function cleanDigits(v: unknown): string {
  return String(v || '').replace(/\D/g, '')
}

export function simulateNfeResolveOrCreateSupplier(
  emit: EmitXmlInput,
  store: DedupeStore,
): DedupeResolveResult {
  const cnpjClean = cleanDigits(emit.cnpj)
  const phoneClean = cleanDigits(emit.phone)

  // 1. Busca exata por CNPJ na tabela customers
  if (cnpjClean) {
    const exact = store.customers.find((c) => cleanDigits(c.cnpj) === cnpjClean)
    if (exact) {
      return { supplier: exact, matchedBy: 'cnpj_exact', wasCreated: false }
    }

    // 2. Busca exata por CNPJ em customer_documents
    const docMatch = store.documents.find(
      (d) => d.document_type === 'CNPJ' && cleanDigits(d.document_number) === cnpjClean,
    )
    if (docMatch) {
      const parent = store.customers.find((c) => c.id === docMatch.customer)
      if (parent) {
        return { supplier: parent, matchedBy: 'cnpj_document', wasCreated: false }
      }
    }

    // 3. Raiz do CNPJ (8 dígitos) -> filiais agrupam na mesma entidade
    if (cnpjClean.length === 14) {
      const root8 = cnpjClean.slice(0, 8)
      // Procurar em customers
      const rootCust = store.customers.find((c) => {
        const cClean = cleanDigits(c.cnpj)
        return cClean.length === 14 && cClean.startsWith(root8)
      })
      if (rootCust) {
        // Vincula a nova filial em customer_documents
        store.documents.push({
          id: `doc_${Date.now()}_${Math.random()}`,
          customer: rootCust.id,
          document_type: 'CNPJ',
          document_number: cnpjClean,
          is_primary: false,
        })
        return {
          supplier: rootCust,
          matchedBy: 'cnpj_root',
          wasCreated: false,
          matchedEntityId: rootCust.id,
        }
      }

      // Procurar em customer_documents
      const rootDoc = store.documents.find((d) => {
        const dClean = cleanDigits(d.document_number)
        return dClean.length === 14 && dClean.startsWith(root8)
      })
      if (rootDoc) {
        const parent = store.customers.find((c) => c.id === rootDoc.customer)
        if (parent) {
          store.documents.push({
            id: `doc_${Date.now()}_${Math.random()}`,
            customer: parent.id,
            document_type: 'CNPJ',
            document_number: cnpjClean,
            is_primary: false,
          })
          return {
            supplier: parent,
            matchedBy: 'cnpj_root',
            wasCreated: false,
            matchedEntityId: parent.id,
          }
        }
      }
    }
  }

  // 4. Cruzamento por telefone (se fornecido)
  if (phoneClean && phoneClean.length >= 8) {
    const phoneCust = store.customers.find((c) => {
      const pClean = cleanDigits(c.phone)
      return pClean && pClean.endsWith(phoneClean.slice(-8))
    })
    if (phoneCust) {
      if (cnpjClean) {
        store.documents.push({
          id: `doc_${Date.now()}_${Math.random()}`,
          customer: phoneCust.id,
          document_type: 'CNPJ',
          document_number: cnpjClean,
          is_primary: !phoneCust.cnpj,
        })
      }
      return { supplier: phoneCust, matchedBy: 'phone_variant', wasCreated: false }
    }
  }

  // 5. Não encontrado -> Cadastrar novo fornecedor
  const newId = `supp_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const newRecord: SupplierRecordStub = {
    id: newId,
    name: emit.name || emit.fant || (cnpjClean ? `Fornecedor CNPJ ${cnpjClean}` : 'Fornecedor XML'),
    company: emit.name || '',
    cnpj: cnpjClean || '',
    phone: emit.phone || '',
    email: emit.email || '',
    customer_type: 'Fornecedor',
    supplier_nature: '', // F4: default vazio para classificar no lançamento
    source: 'nfe_pipeline',
    notes: 'Cadastrado automaticamente via motor de dedupe NF-e.',
  }
  store.customers.push(newRecord)

  if (cnpjClean) {
    store.documents.push({
      id: `doc_${Date.now()}_${Math.random()}`,
      customer: newId,
      document_type: 'CNPJ',
      document_number: cnpjClean,
      is_primary: true,
    })
  }

  return { supplier: newRecord, matchedBy: 'created_new', wasCreated: true }
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

console.log('\n=== G-E: Regressão do Guard de CFOP, Natureza por Atributo e Dedupe (NF-e F4) ===\n')

// ------------------------------------------------------------
// PARTE 1: Natureza lida do atributo no cadastro (Jahu, MEC LAN, Oxilapa, sem atributo)
// ------------------------------------------------------------
console.log('--- PARTE 1: NATUREZA DO FORNECEDOR POR ATRIBUTO NO CADASTRO ---')

const jahuSupplier: SupplierRecordStub = {
  id: 'supp_jahu',
  name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
  cnpj: '61136701000147',
  customer_type: 'Fornecedor',
  supplier_nature: 'revenda',
}

const meclanSupplier: SupplierRecordStub = {
  id: 'supp_meclan',
  name: 'MEC LAN INDUSTRIA E COMERCIO LTDA EPP',
  cnpj: '62538228000197',
  customer_type: 'Fornecedor',
  supplier_nature: 'revenda',
}

const oxilapaSupplier: SupplierRecordStub = {
  id: 'supp_oxilapa',
  name: 'OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA',
  cnpj: '59417469000173',
  customer_type: 'Fornecedor',
  supplier_nature: 'insumo_producao',
}

const unknownSupplierNoNature: SupplierRecordStub = {
  id: 'supp_sem_natureza',
  name: 'FORNECEDOR NOVO SEM NATUREZA LTDA',
  cnpj: '11222333000144',
  customer_type: 'Fornecedor',
  supplier_nature: '',
}

// 1.1 Jahu Borrachas: atributo revenda -> entrada 1102
console.log('\n1.1 CASO JAHU BORRACHAS (Atributo supplier_nature = revenda):')
const jahuCase = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS E AUTOPECAS LTDA',
  supplier: jahuSupplier,
  items: [{ cfop: '5102', vProd: 1250.0 }],
})
assertCheck('Jahu 5102 não é exceção', jahuCase.isException, false)
assertCheck('Jahu natureza lida do atributo é revenda', jahuCase.supplierNature, 'revenda')
assertCheck('Jahu entrada sugerida é 1102', jahuCase.enrichedItems[0].cfop_entrada_sugerido, '1102')
assertCheck('Jahu CFOP origem preservado como 5102', jahuCase.enrichedItems[0].cfop_origem, '5102')
assertCheck(
  'Jahu CFOP emitente NUNCA copiado para entrada',
  jahuCase.enrichedItems[0].cfop_entrada_sugerido !== jahuCase.enrichedItems[0].cfop_origem,
  true,
)

// 1.2 MEC LAN: atributo revenda com ST 5405 -> entrada 1403 + alerta ST
console.log('\n1.2 CASO MEC LAN (Atributo supplier_nature = revenda, ST 5405):')
const meclanCase = evaluateCfopGuard({
  emitCnpj: '62538228000197',
  emitName: 'MEC LAN INDUSTRIA E COMERCIO LTDA EPP',
  supplier: meclanSupplier,
  items: [{ cfop: '5405', vProd: 450.0 }],
})
assertCheck('MEC LAN 5405 não é exceção', meclanCase.isException, false)
assertCheck('MEC LAN natureza lida é revenda', meclanCase.supplierNature, 'revenda')
assertCheck('MEC LAN com ST ativa alerta ICMS-ST', meclanCase.hasStAlert, true)
assertCheck(
  'MEC LAN entrada sugerida com ST é 1403',
  meclanCase.enrichedItems[0].cfop_entrada_sugerido,
  '1403',
)

// 1.3 Oxilapa: atributo insumo_producao -> entrada 1101
console.log('\n1.3 CASO OXILAPA (Atributo supplier_nature = insumo_producao):')
const oxilapaCase = evaluateCfopGuard({
  emitCnpj: '59417469000173',
  emitName: 'OXILAPA GASES',
  supplier: oxilapaSupplier,
  items: [{ cfop: '5102', vProd: 320.0 }],
})
assertCheck('Oxilapa 5102 não é exceção', oxilapaCase.isException, false)
assertCheck(
  'Oxilapa natureza lida é insumo_producao',
  oxilapaCase.supplierNature,
  'insumo_producao',
)
assertCheck(
  'Oxilapa entrada sugerida é 1101',
  oxilapaCase.enrichedItems[0].cfop_entrada_sugerido,
  '1101',
)

// 1.4 Interestadual 6102 para Jahu (revenda -> 2102) e Oxilapa (insumo -> 2101)
console.log('\n1.4 CASO INTERESTADUAL 6102 COM ATRIBUTO:')
const jahuInterstate = evaluateCfopGuard({
  emitCnpj: '61136701000732',
  emitName: 'JAHU FILIAL',
  supplier: jahuSupplier,
  items: [{ cfop: '6102', vProd: 500.0 }],
})
assertCheck(
  'Interestadual Jahu sugere 2102',
  jahuInterstate.enrichedItems[0].cfop_entrada_sugerido,
  '2102',
)

const oxilapaInterstate = evaluateCfopGuard({
  emitCnpj: '59417469000173',
  emitName: 'OXILAPA GASES',
  supplier: oxilapaSupplier,
  items: [{ cfop: '6102', vProd: 800.0 }],
})
assertCheck(
  'Interestadual Oxilapa sugere 2101',
  oxilapaInterstate.enrichedItems[0].cfop_entrada_sugerido,
  '2101',
)

// 1.5 Fornecedor sem atributo no cadastro: destino fica 'classificacao_pendente', nota segue sem retenção
console.log('\n1.5 CASO FORNECEDOR SEM ATRIBUTO (Fallback classificacao_pendente):')
const semAtributoCase = evaluateCfopGuard({
  emitCnpj: '11222333000144',
  emitName: 'FORNECEDOR NOVO SEM NATUREZA LTDA',
  supplier: unknownSupplierNoNature,
  items: [{ cfop: '5102', vProd: 300.0 }],
})
assertCheck('Nota de fornecedor sem atributo NÃO é retida', semAtributoCase.isException, false)
assertCheck('Atributo retornado é vazio', semAtributoCase.supplierNature, '')
assertCheck(
  'Destino declarado é classificacao_pendente',
  semAtributoCase.enrichedItems[0].destino_declarado,
  'classificacao_pendente',
)
assertCheck(
  'Entrada sugerida preliminar neutra é 1102',
  semAtributoCase.enrichedItems[0].cfop_entrada_sugerido,
  '1102',
)

// 1.6 Insumo de Consumo declarado
console.log('\n1.6 CASO INSUMO DE CONSUMO (1556 / 2556):')
assertCheck(
  'Consumo interno sugere 1556',
  computeSuggestedEntryCfop('5102', 'insumo_consumo'),
  '1556',
)
assertCheck(
  'Consumo interestadual sugere 2556',
  computeSuggestedEntryCfop('6102', 'insumo_consumo'),
  '2556',
)

// 1.7 CFOPs inválidos continuam retidos
console.log('\n1.7 CFOP NÃO PADRÃO CONTINUA RETIDO:')
const devoluCase = evaluateCfopGuard({
  emitCnpj: '61136701000147',
  emitName: 'JAHU BORRACHAS',
  supplier: jahuSupplier,
  items: [{ cfop: '5202', vProd: 100.0 }],
})
assertCheck('CFOP 5202 de devolução é retido em revisão', devoluCase.isException, true)
assertCheck('Mensagem menciona CFOP inválido', devoluCase.exceptionReason.includes('5202'), true)

// ------------------------------------------------------------
// PARTE 2: Motor de Dedupe e Auto-cadastro de fornecedor via XML
// ------------------------------------------------------------
console.log('\n--- PARTE 2: MOTOR DE DEDUPE & AUTO-CADASTRO DE FORNECEDOR VIA XML ---')

const simStore: DedupeStore = {
  customers: [{ ...jahuSupplier }, { ...meclanSupplier }, { ...oxilapaSupplier }],
  documents: [
    {
      id: 'doc_jahu_matriz',
      customer: 'supp_jahu',
      document_type: 'CNPJ',
      document_number: '61136701000147',
      is_primary: true,
    },
    {
      id: 'doc_meclan',
      customer: 'supp_meclan',
      document_type: 'CNPJ',
      document_number: '62538228000197',
      is_primary: true,
    },
    {
      id: 'doc_oxilapa',
      customer: 'supp_oxilapa',
      document_type: 'CNPJ',
      document_number: '59417469000173',
      is_primary: true,
    },
  ],
}

// 2.1 Cenário 1: Nota de remetente DESCONHECIDO auto-cadastra fornecedor via XML
console.log('\n2.1 CENÁRIO 1: REMETENTE DESCONHECIDO AUTO-CADASTRA FORNECEDOR:')
const initialCustomerCount = simStore.customers.length
const emitNovo: EmitXmlInput = {
  cnpj: '77888999000122',
  name: 'BORRACHAS TROPICAL IND E COM LTDA',
  fant: 'BORRACHAS TROPICAL',
  ie: '123456789',
  phone: '1144445555',
  email: 'nfe@tropical.com.br',
  address: 'RUA DAS PALMEIRAS, 100',
}

const resNovo = simulateNfeResolveOrCreateSupplier(emitNovo, simStore)
assertCheck('Fornecedor foi criado', resNovo.wasCreated, true)
assertCheck('Método de resolução foi created_new', resNovo.matchedBy, 'created_new')
assertCheck(
  'Nome foi preenchido do XML',
  resNovo.supplier.name,
  'BORRACHAS TROPICAL IND E COM LTDA',
)
assertCheck('CNPJ foi gravado limpo', resNovo.supplier.cnpj, '77888999000122')
assertCheck('Telefone foi gravado do XML', resNovo.supplier.phone, '1144445555')
assertCheck('Tipo do cliente é Fornecedor', resNovo.supplier.customer_type, 'Fornecedor')
assertCheck('Natureza inicial nasce vazia', resNovo.supplier.supplier_nature, '')
assertCheck(
  'Documento primário criado em customer_documents',
  simStore.documents.some(
    (d) => d.customer === resNovo.supplier.id && d.document_number === '77888999000122',
  ),
  true,
)
assertCheck(
  'Contagem de customers aumentou em 1',
  simStore.customers.length,
  initialCustomerCount + 1,
)

// E a nota deste fornecedor novo segue no pipeline sem retenção!
const guardNotaNova = evaluateCfopGuard({
  emitCnpj: emitNovo.cnpj!,
  emitName: emitNovo.name!,
  supplier: resNovo.supplier,
  items: [{ cfop: '5102', vProd: 850.0 }],
})
assertCheck('Nota do fornecedor novo NÃO é retida', guardNotaNova.isException, false)
assertCheck(
  'Destino é classificacao_pendente para lançamento',
  guardNotaNova.enrichedItems[0].destino_declarado,
  'classificacao_pendente',
)

// 2.2 Cenário 2: Segunda nota do MESMO CNPJ vincula ao fornecedor existente sem duplicar
console.log('\n2.2 CENÁRIO 2: SEGUNDA NOTA DO MESMO CNPJ VINCULA SEM DUPLICAR:')
const countBeforeSecondNote = simStore.customers.length
const emitSegundaNota: EmitXmlInput = {
  cnpj: '77888999000122',
  name: 'BORRACHAS TROPICAL IND E COM LTDA',
  phone: '1144445555',
}

const resSegunda = simulateNfeResolveOrCreateSupplier(emitSegundaNota, simStore)
assertCheck('Segunda nota NÃO criou novo registro', resSegunda.wasCreated, false)
assertCheck('Método de resolução foi cnpj_exact', resSegunda.matchedBy, 'cnpj_exact')
assertCheck(
  'ID do fornecedor é o mesmo do auto-cadastro',
  resSegunda.supplier.id,
  resNovo.supplier.id,
)
assertCheck('Contagem de customers NÃO aumentou', simStore.customers.length, countBeforeSecondNote)

// 2.3 Cenário 3: Nota de filial (mesma raiz de CNPJ) cai na MESMA entidade do fornecedor
console.log('\n2.3 CENÁRIO 3: NOTA DE FILIAL (MESMA RAIZ) CAI NA MESMA ENTIDADE:')
const countBeforeFilial = simStore.customers.length
// Filial da Jahu Borrachas (raiz 61136701, filial 0007-32)
const emitFilialJahu: EmitXmlInput = {
  cnpj: '61136701000732',
  name: 'JAHU BORRACHAS E AUTOPECAS LTDA - FILIAL CAMPINAS',
  phone: '1933334444',
  address: 'AV BRASIL, 500',
}

const resFilial = simulateNfeResolveOrCreateSupplier(emitFilialJahu, simStore)
assertCheck('Filial NÃO criou novo cliente/fornecedor isolado', resFilial.wasCreated, false)
assertCheck('Método de resolução foi cnpj_root', resFilial.matchedBy, 'cnpj_root')
assertCheck('Entidade retornada é a matriz da Jahu', resFilial.supplier.id, 'supp_jahu')
assertCheck('Contagem de customers NÃO aumentou', simStore.customers.length, countBeforeFilial)
assertCheck(
  'CNPJ da filial foi adicionado em customer_documents vinculado à entidade Jahu',
  simStore.documents.some(
    (d) => d.customer === 'supp_jahu' && d.document_number === '61136701000732',
  ),
  true,
)

// Outra filial: Filial da Borrachas Tropical (raiz 77888999, filial 0002-03)
const emitFilialTropical: EmitXmlInput = {
  cnpj: '77888999000203',
  name: 'BORRACHAS TROPICAL IND E COM LTDA - FILIAL SANTOS',
  phone: '1333332222',
}
const resFilialTropical = simulateNfeResolveOrCreateSupplier(emitFilialTropical, simStore)
assertCheck(
  'Filial Tropical vinculou à entidade raiz',
  resFilialTropical.supplier.id,
  resNovo.supplier.id,
)
assertCheck('Método de resolução foi cnpj_root', resFilialTropical.matchedBy, 'cnpj_root')

console.log(`\nResultado Total: ${pass} passaram, ${fail} falharam.\n`)

if (fail > 0) {
  throw new Error(`CFOP guard & dedupe regression test failed: ${fail} failure(s)`)
}
