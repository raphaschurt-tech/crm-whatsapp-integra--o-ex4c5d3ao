/**
 * Motor Unificado de Deduplicação e Normalização de Contatos
 * Usado por TODOS os caminhos de entrada:
 * - Cadastro manual / edição de contatos
 * - Entrada automática via XML NF-e (DF-e, email, upload)
 * - Import futuro do SOU.IS
 * - WhatsApp / Atendimento (cadastro rápido e reaproveitamento)
 *
 * Regras:
 * (1) Documento único com detecção automática (11 dígitos = CPF, 14 = CNPJ)
 * (2) Fornecedor: dedupe por CNPJ normalizado.
 * (3) Raiz do CNPJ (8 primeiros dígitos) agrupa filiais da mesma razão social (ex: Jahu 61.136.701)
 * (4) Cliente PJ: dedupe por CNPJ
 * (5) Cliente PF: dedupe por CPF se houver; senão por TELEFONE NORMALIZADO
 * (6) Telefone normalizado:
 *     - só dígitos
 *     - garantir DDI+DDD (55 + DDD, total 10–11 dígitos com DDI)
 *     - telefone de 8 dígitos = fixo, tratar com DDD padrão (11 quando SP / região do contato)
 * (7) Nome como fuzzy match APENAS para AVISO, NUNCA para bloqueio automático.
 */

export type DocumentType = 'CPF' | 'CNPJ' | 'UNKNOWN'

export interface ParsedDocument {
  raw: string
  cleanDigits: string
  type: DocumentType
  isValidLength: boolean
  rootCnpj?: string
  formatted: string
}

export interface NormalizedPhone {
  raw: string
  digits: string
  canonicalDdi: string // Ex: "5511963970333" ou "551136190000"
  ddd: string
  corePhone: string // Ex: 8 ou 9 dígitos locais
  isLandline: boolean
  formatted: string
}

export interface CustomerEntityLookup {
  id: string
  name: string
  contact_name?: string
  phone?: string
  cpf?: string
  cnpj?: string
  customer_type?: string
  roles?: string[]
  deleted?: boolean
  company?: string
  documents?: Array<{
    id?: string
    document_type: 'CPF' | 'CNPJ'
    document_number: string
    root_cnpj?: string
    label?: string
    is_primary?: boolean
  }>
}

export interface DedupeMatchResult {
  action: 'match_found' | 'branch_group_found' | 'fuzzy_warning' | 'none'
  matchType?: 'exact_document' | 'branch_root_cnpj' | 'canonical_phone' | 'fuzzy_name'
  existingCustomer?: CustomerEntityLookup
  matchedDocument?: string
  matchedPhone?: string
  warningMessage?: string
  isBlocker: boolean
}

/**
 * Remove qualquer caractere que não seja dígito
 */
export function cleanDigits(val: unknown): string {
  if (!val) return ''
  return String(val).replace(/\D/g, '')
}

/**
 * Detecta tipo de documento e normaliza (11 = CPF, 14 = CNPJ)
 */
export function parseAndNormalizeDocument(input: unknown): ParsedDocument {
  const digits = cleanDigits(input)
  const len = digits.length

  if (len === 11) {
    const formatted = digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    return {
      raw: String(input || ''),
      cleanDigits: digits,
      type: 'CPF',
      isValidLength: true,
      formatted,
    }
  }

  if (len === 14) {
    const formatted = digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    return {
      raw: String(input || ''),
      cleanDigits: digits,
      type: 'CNPJ',
      isValidLength: true,
      rootCnpj: digits.slice(0, 8),
      formatted,
    }
  }

  return {
    raw: String(input || ''),
    cleanDigits: digits,
    type: 'UNKNOWN',
    isValidLength: false,
    formatted: digits,
  }
}

/**
 * Formata CPF ou CNPJ com máscara padrão
 */
export function formatDocumentDisplay(input: unknown): string {
  const parsed = parseAndNormalizeDocument(input)
  return parsed.formatted
}

/**
 * Normaliza telefone para formato canônico DDI+DDD (55 + DDD + número)
 * Trata os 4 formatos reais da base:
 * - 11947518805 (sem DDI) -> 5511947518805
 * - 5511954747695 (com DDI) -> 5511954747695
 * - (11) 91245-2830 (formatado) -> 5511912452830
 * - 1136190000 (fixo 10 dígitos) -> 551136190000
 * - 36190000 (fixo 8 dígitos puro) -> 55 + defaultDdd (11) + 36190000 = 551136190000
 */
export function normalizePhone(rawPhone: unknown, defaultDdd = '11'): NormalizedPhone {
  const s = String(rawPhone || '').trim()
  const digits = cleanDigits(s)

  if (!digits || digits.length < 8) {
    return {
      raw: s,
      digits,
      canonicalDdi: '',
      ddd: '',
      corePhone: '',
      isLandline: false,
      formatted: s,
    }
  }

  let canonical = digits

  // Caso 1: Fixo de 8 dígitos puro (ex: 36190000)
  if (canonical.length === 8) {
    canonical = `55${defaultDdd}${canonical}`
  }
  // Caso 2: Fixo de 10 dígitos com DDD sem DDI (ex: 1136190000)
  else if (canonical.length === 10 && !canonical.startsWith('55')) {
    canonical = `55${canonical}`
  }
  // Caso 3: Celular de 9 dígitos sem DDD
  else if (canonical.length === 9) {
    canonical = `55${defaultDdd}${canonical}`
  }
  // Caso 4: Celular de 11 dígitos com DDD sem DDI (ex: 11947518805)
  else if (canonical.length === 11 && !canonical.startsWith('55')) {
    canonical = `55${canonical}`
  }
  // Caso 5: Se tem 12 dígitos e começa com 55 (ex: 551136190000 - fixo com DDI)
  // Caso 6: Se tem 13 dígitos e começa com 55 (ex: 5511954747695 - celular com DDI)

  // Extrair componentes a partir do formato canonical que começa com 55 (quando nacional)
  let ddd = defaultDdd
  let core = canonical
  let isLandline = false

  if (canonical.startsWith('55') && canonical.length >= 12) {
    ddd = canonical.slice(2, 4)
    core = canonical.slice(4)
    isLandline = core.length === 8
  } else if (canonical.length === 10 || canonical.length === 11) {
    ddd = canonical.slice(0, 2)
    core = canonical.slice(2)
    isLandline = core.length === 8
  }

  // Formatação visual amigável
  let formatted = canonical
  if (canonical.startsWith('55') && (canonical.length === 12 || canonical.length === 13)) {
    const localDdd = canonical.slice(2, 4)
    const rest = canonical.slice(4)
    if (rest.length === 9) {
      formatted = `(${localDdd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    } else if (rest.length === 8) {
      formatted = `(${localDdd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
    }
  }

  return {
    raw: s,
    digits,
    canonicalDdi: canonical,
    ddd,
    corePhone: core,
    isLandline,
    formatted,
  }
}

/**
 * Chave canônica de comparação de telefone:
 * DDD + 8 dígitos finais (elimina variação de nono dígito móvel e DDI)
 */
export function getPhoneComparisonKey(rawPhone: unknown, defaultDdd = '11'): string {
  const norm = normalizePhone(rawPhone, defaultDdd)
  if (!norm.canonicalDdi) return ''

  let withoutDdi = norm.canonicalDdi
  if (withoutDdi.startsWith('55') && withoutDdi.length >= 12) {
    withoutDdi = withoutDdi.slice(2)
  }

  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    // DDD + 8 dígitos finais
    return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
  }
  if (withoutDdi.length === 10) {
    return withoutDdi
  }
  return withoutDdi
}

/**
 * Similaridade simples (Levenshtein ratio) para Fuzzy Match de Nomes (Apenas para AVISO)
 */
export function calculateNameSimilarity(nameA: string, nameB: string): number {
  const a = (nameA || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const b = (nameB || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!a || !b) return 0
  if (a === b) return 1

  // Se um contém o outro com tamanho relevante (> 4 letras)
  if ((a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b))) {
    return 0.85
  }

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1),
        )
      }
    }
  }

  const distance = matrix[b.length][a.length]
  const maxLen = Math.max(a.length, b.length)
  return 1 - distance / maxLen
}

/**
 * Função Central de Deduplicação Unificada
 *
 * Avalia se o contato a ser cadastrado/importado já existe na base:
 * 1. Se CNPJ informado (PJ / Fornecedor):
 *    a) Casou CNPJ exato -> Bloqueio/Reaproveitamento com match exato
 *    b) Casou raiz do CNPJ (8 primeiros dígitos) com fornecedor de mesma razão ->
 *       Agrupamento filial/unidade (mesma entidade)
 * 2. Se CPF informado (PF):
 *    -> Casou CPF exato -> Bloqueio/Reaproveitamento com match exato
 * 3. Se Cliente PF sem CPF (ou em paralelo):
 *    -> Casou Telefone normalizado canônico -> Reaproveitamento ou bloqueio de duplicidade
 * 4. Fuzzy match de nome (>= 0.80):
 *    -> APENAS aviso, NUNCA bloqueio automático (isBlocker = false)
 */
export function findDuplicateContact(
  input: {
    document?: string
    phone?: string
    name?: string
    customerType?: string
    excludeCustomerId?: string
  },
  existingList: CustomerEntityLookup[],
): DedupeMatchResult {
  const parsedDoc = parseAndNormalizeDocument(input.document)
  const inputPhoneKey = getPhoneComparisonKey(input.phone)
  const isSupplier =
    (input.customerType || '').toLowerCase() === 'fornecedor' ||
    (input.customerType || '').toLowerCase() === 'ambos'

  // 1. Verificação por CNPJ
  if (parsedDoc.type === 'CNPJ' && parsedDoc.isValidLength) {
    for (const cust of existingList) {
      if (cust.deleted) continue
      if (input.excludeCustomerId && cust.id === input.excludeCustomerId) continue

      // CNPJs cadastrados diretamente ou via subdocumentos
      const knownCnpjs: string[] = []
      if (cust.cnpj) knownCnpjs.push(cleanDigits(cust.cnpj))
      if (cust.documents) {
        for (const d of cust.documents) {
          if (d.document_type === 'CNPJ') knownCnpjs.push(cleanDigits(d.document_number))
        }
      }

      // (1a) CNPJ exato (14 dígitos idênticos)
      if (knownCnpjs.includes(parsedDoc.cleanDigits)) {
        return {
          action: 'match_found',
          matchType: 'exact_document',
          existingCustomer: cust,
          matchedDocument: parsedDoc.cleanDigits,
          isBlocker: true,
          warningMessage: `Já existe um ${isSupplier ? 'fornecedor' : 'cliente'} cadastrado com este CNPJ (${parsedDoc.formatted}): ${cust.name}`,
        }
      }

      // (1b) Raiz do CNPJ (8 primeiros dígitos idêntica) - Agrupamento de filiais
      if (parsedDoc.rootCnpj) {
        const hasRootMatch = knownCnpjs.some((cnpj) => cnpj.slice(0, 8) === parsedDoc.rootCnpj)
        if (hasRootMatch) {
          return {
            action: 'branch_group_found',
            matchType: 'branch_root_cnpj',
            existingCustomer: cust,
            matchedDocument: parsedDoc.cleanDigits,
            isBlocker: false,
            warningMessage: `Esta unidade (${parsedDoc.formatted}) pertence à mesma empresa/matriz de ${cust.name} (CNPJ raiz ${parsedDoc.rootCnpj}). O documento será vinculado à mesma entidade.`,
          }
        }
      }
    }
  }

  // 2. Verificação por CPF
  if (parsedDoc.type === 'CPF' && parsedDoc.isValidLength) {
    for (const cust of existingList) {
      if (cust.deleted) continue
      if (input.excludeCustomerId && cust.id === input.excludeCustomerId) continue

      const knownCpfs: string[] = []
      if (cust.cpf) knownCpfs.push(cleanDigits(cust.cpf))
      if (cust.documents) {
        for (const d of cust.documents) {
          if (d.document_type === 'CPF') knownCpfs.push(cleanDigits(d.document_number))
        }
      }

      if (knownCpfs.includes(parsedDoc.cleanDigits)) {
        return {
          action: 'match_found',
          matchType: 'exact_document',
          existingCustomer: cust,
          matchedDocument: parsedDoc.cleanDigits,
          isBlocker: true,
          warningMessage: `Já existe um cliente cadastrado com este CPF (${parsedDoc.formatted}): ${cust.name}`,
        }
      }
    }
  }

  // 3. Verificação por Telefone Normalizado (chave principal para cliente PF e atendimento)
  if (inputPhoneKey) {
    for (const cust of existingList) {
      if (cust.deleted) continue
      if (input.excludeCustomerId && cust.id === input.excludeCustomerId) continue

      const existingPhoneKey = getPhoneComparisonKey(cust.phone)
      if (existingPhoneKey && existingPhoneKey === inputPhoneKey) {
        return {
          action: 'match_found',
          matchType: 'canonical_phone',
          existingCustomer: cust,
          matchedPhone: cust.phone,
          isBlocker: true,
          warningMessage: `Já existe um ${isSupplier ? 'fornecedor' : 'cliente'} cadastrado com este telefone: ${cust.name}`,
        }
      }
    }
  }

  // 4. Fuzzy match de Nome (Aviso apenas, NUNCA bloqueio)
  if (input.name && input.name.trim().length >= 4) {
    for (const cust of existingList) {
      if (cust.deleted) continue
      if (input.excludeCustomerId && cust.id === input.excludeCustomerId) continue

      const similarity = calculateNameSimilarity(input.name, cust.name)
      if (similarity >= 0.82) {
        return {
          action: 'fuzzy_warning',
          matchType: 'fuzzy_name',
          existingCustomer: cust,
          isBlocker: false,
          warningMessage: `Atenção: nome similar ao contato existente "${cust.name}". Verifique se trata-se da mesma pessoa ou empresa.`,
        }
      }
    }
  }

  return {
    action: 'none',
    isBlocker: false,
  }
}
