/**
 * Teste unitário da lógica de busca e relevância da ferramenta buscar_produtos da IA.
 * Valida os requisitos:
 * 1. Tokenização com remoção de stopwords em português
 * 2. Tratamento de anos (4 dígitos "1991", 2 dígitos "91" casando com faixa "88/97" e preservando "d21")
 * 3. Ordenação por relevância: "bucha amortecedor d21 1991" ranqueia SKU 8722 em primeiro lugar
 */

interface MockProduct {
  sku: string
  name: string
  brand: string
  barcode: string
  description: string
  stock_quantity: number
  price: number
}

const STOP_WORDS_SET: Record<string, boolean> = {
  de: true,
  do: true,
  da: true,
  dos: true,
  das: true,
  para: true,
  em: true,
  um: true,
  uma: true,
  tem: true,
  temos: true,
  você: true,
  voce: true,
  qual: true,
  quanto: true,
  custa: true,
  o: true,
  a: true,
  e: true,
  é: true,
  ano: true,
  anos: true,
  modelo: true,
  peca: true,
  peça: true,
  pecas: true,
  peças: true,
  pra: true,
  pro: true,
}

export function removeAccents(str: string | null | undefined): string {
  if (!str) return ''
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function extractAiTokensAndYears(rawTerm: string) {
  const rawWords = removeAccents(rawTerm)
    .toLowerCase()
    .replace(/[?!,;:()[\]{}"'\\/]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)

  const usefulTokens: string[] = []
  const detectedYears: number[] = []

  for (let wi = 0; wi < rawWords.length; wi++) {
    const token = rawWords[wi]
    if (!token) continue
    if (STOP_WORDS_SET[token]) continue

    if (/^(19|20)\d{2}$/.test(token)) {
      const twoDigit = parseInt(token.slice(2), 10)
      if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
      continue
    }

    if (/^\d{2}$/.test(token)) {
      const twoDigit = parseInt(token, 10)
      if (!isNaN(twoDigit)) detectedYears.push(twoDigit)
      continue
    }

    if (token.length >= 2) {
      usefulTokens.push(token)
    }
  }

  const searchTokens =
    usefulTokens.length > 0 ? usefulTokens : rawWords.filter((w) => w.length >= 2)

  return { searchTokens, detectedYears }
}

export function matchesYearRange(text: string, year2Digit: number): boolean {
  if (!text || year2Digit === undefined || year2Digit === null) return false
  const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
  let match: RegExpExecArray | null
  while ((match = rangeRegex.exec(text)) !== null) {
    let startY = parseInt(match[1], 10)
    let endY = parseInt(match[2], 10)
    if (startY > 1000) startY = startY % 100
    if (endY > 1000) endY = endY % 100

    if (!isNaN(startY) && !isNaN(endY)) {
      if (startY <= endY) {
        if (year2Digit >= startY && year2Digit <= endY) return true
      } else {
        if (year2Digit >= startY || year2Digit <= endY) return true
      }
    }
  }
  return false
}

export function extractYearRangeString(text: string): string {
  if (!text) return ''
  const rangeRegex = /\b(\d{2}|\d{4})\s*[/-]\s*(\d{2}|\d{4})\b/g
  const match = rangeRegex.exec(text)
  if (match) {
    let y1 = match[1]
    let y2 = match[2]
    if (y1.length === 4) y1 = y1.slice(2)
    if (y2.length === 4) y2 = y2.slice(2)
    return `${y1}/${y2}`
  }
  return ''
}

/**
 * Simula a busca em duas fases (AND -> OR com fallback) sobre o catálogo de produtos.
 * Fase 1: AND estrito em name, sku, brand, barcode ou description
 * Fase 2: OR amplo se Fase 1 trouxer menos de 5 produtos
 */
export const TOKEN_ALIASES_MAP: Record<string, string[]> = {
  bandeja: ['band'],
  bandejas: ['band'],
  band: ['bandeja'],
  dianteira: ['diant'],
  dianteiro: ['diant'],
  dianteiras: ['diant'],
  dianteiros: ['diant'],
  diant: ['dianteira', 'dianteiro'],
  traseira: ['tras'],
  traseiro: ['tras'],
  traseiras: ['tras'],
  traseiros: ['tras'],
  tras: ['traseira', 'traseiro'],
  amortecedor: ['amort'],
  amortecedores: ['amort'],
  amort: ['amortecedor'],
  estabilizadora: ['estab'],
  estabilizador: ['estab'],
  estab: ['estabilizadora', 'estabilizador'],
  superior: ['sup'],
  superiores: ['sup'],
  sup: ['superior'],
  inferior: ['inf'],
  inferiores: ['inf'],
  inf: ['inferior'],
  facao: ['facao'],
  direcao: ['dir'],
  dir: ['direcao'],
  articulacao: ['artic'],
  articulador: ['artic'],
  artic: ['articulacao', 'articulador'],
  hidraulica: ['hidr'],
  hidraulico: ['hidr'],
  hidr: ['hidraulica', 'hidraulico'],
  esquerda: ['esq'],
  esquerdo: ['esq'],
  esq: ['esquerda', 'esquerdo'],
  direita: ['dir'],
  direito: ['dir'],
  homocinetica: ['homoc'],
  homoc: ['homocinetica'],
  travessa: ['trav'],
  trav: ['travessa'],
  tensor: ['tens'],
  tens: ['tensor'],
  rolamento: ['rol'],
  rol: ['rolamento'],
  transversal: ['trans'],
  trans: ['transversal'],
}

export function getEquivalentsForToken(tok: string): string[] {
  const cleanTok = String(tok || '')
    .toLowerCase()
    .trim()
  if (!cleanTok) return []
  const aliasList = TOKEN_ALIASES_MAP[cleanTok] || []
  const result = [cleanTok]
  for (let ai = 0; ai < aliasList.length; ai++) {
    const alias = aliasList[ai]
    if (!result.includes(alias)) {
      result.push(alias)
    }
  }
  return result
}

/**
 * Simula a busca em duas fases (AND -> OR com fallback) sobre o catálogo de produtos com equivalência de apelidos.
 * Fase 1: AND estrito entre grupos de equivalência
 * Fase 2: OR amplo se Fase 1 trouxer menos de 5 produtos
 */
export function twoPhaseProductSearch(
  products: MockProduct[],
  searchTokens: string[],
  rawTerm = '',
): MockProduct[] {
  if (!products || products.length === 0 || !searchTokens || searchTokens.length === 0) {
    return []
  }

  const tokenGroups = searchTokens.slice(0, 8).map(getEquivalentsForToken)

  const matchesGroup = (prod: MockProduct, variants: string[]) => {
    const full = removeAccents(
      `${prod.name} ${prod.sku} ${prod.brand} ${prod.barcode} ${prod.description}`,
    ).toLowerCase()
    return variants.some((v) => full.includes(removeAccents(v).toLowerCase()))
  }

  // Fase 1: AND estrito entre conceitos
  const phase1 = products.filter((p) => tokenGroups.every((group) => matchesGroup(p, group)))

  const selectedIds = new Set(phase1.map((p) => p.sku))
  const results = [...phase1]

  // Fase 2: OR caso Fase 1 traga menos de 5
  if (results.length < 5) {
    const phase2 = products.filter((p) => {
      if (selectedIds.has(p.sku)) return false
      return tokenGroups.some((group) => matchesGroup(p, group))
    })
    for (const p of phase2) {
      results.push(p)
      selectedIds.add(p.sku)
      if (results.length >= 200) break
    }
  }

  // Fallback se nada foi encontrado
  if (results.length === 0 && rawTerm.length >= 2) {
    const rt = removeAccents(rawTerm).toLowerCase()
    const fallback = products.filter((p) =>
      removeAccents(`${p.name} ${p.sku} ${p.brand} ${p.barcode}`).toLowerCase().includes(rt),
    )
    results.push(...fallback.slice(0, 20))
  }

  return results
}

/**
 * Limpa description se for boilerplate da sincronização SOU.IS
 */
export function cleanProductDescription(desc: string | undefined | null): string {
  const s = String(desc || '').trim()
  if (!s || s.startsWith('Produto SOU.IS sincronizado')) {
    return ''
  }
  return s
}

export function scoreAndRankProducts(
  products: MockProduct[],
  rawTerm: string,
  searchTokens: string[],
  detectedYears: number[],
) {
  const scoredCandidates: {
    rec: MockProduct
    score: number
    matchedTokenCount: number
    matchedNameSkuCount: number
  }[] = []

  for (let ci = 0; ci < products.length; ci++) {
    const rec = products[ci]
    const pSku = String(rec.sku || '').toLowerCase()
    const pName = removeAccents(rec.name || '').toLowerCase()
    const pBrand = removeAccents(rec.brand || '').toLowerCase()
    const pBarcode = removeAccents(rec.barcode || '').toLowerCase()
    const pDesc = removeAccents(rec.description || '').toLowerCase()
    const fullSearchable = pName + ' ' + pSku + ' ' + pBrand + ' ' + pBarcode + ' ' + pDesc
    const nameSkuSearchable = pName + ' ' + pSku

    const tokenGroups = searchTokens.map(getEquivalentsForToken)

    let matchedTokenCount = 0
    let matchedNameSkuCount = 0

    for (let gi = 0; gi < tokenGroups.length; gi++) {
      const variants = tokenGroups[gi]
      let groupMatchedFull = false
      let groupMatchedNameSku = false

      for (let vi = 0; vi < variants.length; vi++) {
        const vTok = variants[vi]
        if (fullSearchable.includes(vTok)) {
          groupMatchedFull = true
        }
        if (nameSkuSearchable.includes(vTok)) {
          groupMatchedNameSku = true
        }
      }

      if (groupMatchedFull) {
        matchedTokenCount++
      }
      if (groupMatchedNameSku) {
        matchedNameSkuCount++
      }
    }

    if (matchedTokenCount === 0 && tokenGroups.length > 0) continue

    // Ordem do score:
    // 1º Número de tokens casados (peso dominante 1000)
    // 2º Bônus stock_quantity > 0 (+20 para desempate)
    // 3º Bônus faixa de anos (+10)
    let score = matchedTokenCount * 1000

    if (matchedTokenCount === tokenGroups.length && tokenGroups.length > 1) {
      score += 100
    }
    if (pSku === removeAccents(rawTerm).toLowerCase()) {
      score += 5000
    }

    if (rec.stock_quantity > 0) {
      score += 20
    }

    let yearMatched = false
    if (detectedYears.length > 0) {
      for (let yi = 0; yi < detectedYears.length; yi++) {
        if (matchesYearRange(pName, detectedYears[yi])) {
          yearMatched = true
          break
        }
      }
      if (yearMatched) {
        score += 10
      }
    }

    scoredCandidates.push({
      rec,
      score,
      matchedTokenCount,
      matchedNameSkuCount,
    })
  }

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.matchedTokenCount !== a.matchedTokenCount)
      return b.matchedTokenCount - a.matchedTokenCount
    const stockA = Number(a.rec.stock_quantity) || 0
    const stockB = Number(b.rec.stock_quantity) || 0
    if (stockB !== stockA) return stockB - stockA
    return a.rec.name.localeCompare(b.rec.name)
  })

  // GUARDA DO DESCARTE E FALLBACK:
  // A regra de descarte (menos de 2 termos) só se aplica se houver 2+ termos significativos.
  // Se gerar menos de 3 resultados, inclui fallback com 1 termo ao final.
  const tokenGroupsCount = searchTokens.length
  let filteredRanked = scoredCandidates
  if (tokenGroupsCount >= 2) {
    const strictMatch = scoredCandidates.filter((item) => item.matchedNameSkuCount >= 2)
    if (strictMatch.length >= 3) {
      filteredRanked = strictMatch
    } else {
      const partialMatch = scoredCandidates.filter((item) => item.matchedNameSkuCount < 2)
      filteredRanked = strictMatch.concat(partialMatch)
    }
  }

  return filteredRanked.slice(0, 5)
}
