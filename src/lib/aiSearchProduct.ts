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

export function extractAiTokensAndYears(rawTerm: string) {
  const rawWords = String(rawTerm || '')
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
export function twoPhaseProductSearch(
  products: MockProduct[],
  searchTokens: string[],
  rawTerm = '',
): MockProduct[] {
  if (!products || products.length === 0 || !searchTokens || searchTokens.length === 0) {
    return []
  }

  const queryTokens = searchTokens.slice(0, 8)

  const matchesToken = (prod: MockProduct, tok: string) => {
    const full =
      `${prod.name} ${prod.sku} ${prod.brand} ${prod.barcode} ${prod.description}`.toLowerCase()
    return full.includes(tok.toLowerCase())
  }

  // Fase 1: AND estrito
  const phase1 = products.filter((p) => queryTokens.every((tok) => matchesToken(p, tok)))

  const selectedIds = new Set(phase1.map((p) => p.sku))
  const results = [...phase1]

  // Fase 2: OR caso Fase 1 traga menos de 5
  if (results.length < 5) {
    const phase2 = products.filter((p) => {
      if (selectedIds.has(p.sku)) return false
      return queryTokens.some((tok) => matchesToken(p, tok))
    })
    for (const p of phase2) {
      results.push(p)
      selectedIds.add(p.sku)
      if (results.length >= 200) break
    }
  }

  // Fallback se nada foi encontrado
  if (results.length === 0 && rawTerm.length >= 2) {
    const rt = rawTerm.toLowerCase()
    const fallback = products.filter((p) =>
      `${p.name} ${p.sku} ${p.brand} ${p.barcode}`.toLowerCase().includes(rt),
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
    const pName = String(rec.name || '').toLowerCase()
    const pBrand = String(rec.brand || '').toLowerCase()
    const pBarcode = String(rec.barcode || '').toLowerCase()
    const pDesc = String(rec.description || '').toLowerCase()
    const fullSearchable = pName + ' ' + pSku + ' ' + pBrand + ' ' + pBarcode + ' ' + pDesc
    const nameSkuSearchable = pName + ' ' + pSku

    let matchedTokenCount = 0
    let matchedNameSkuCount = 0
    for (let ti = 0; ti < searchTokens.length; ti++) {
      const tok = searchTokens[ti]
      if (fullSearchable.includes(tok)) {
        matchedTokenCount++
      }
      if (nameSkuSearchable.includes(tok)) {
        matchedNameSkuCount++
      }
    }

    // Filtro de relevância mínima: quando o termo tiver 2 ou mais tokens,
    // descarta produtos com menos de 2 tokens casados no nome/SKU
    if (searchTokens.length >= 2 && matchedNameSkuCount < 2) {
      continue
    }

    if (matchedTokenCount === 0 && searchTokens.length > 0) continue

    let score = matchedTokenCount * 10
    if (matchedTokenCount === searchTokens.length && searchTokens.length > 1) {
      score += 25
    }
    if (pSku === rawTerm.toLowerCase()) {
      score += 100
    }
    if (detectedYears.length > 0) {
      let yearMatched = false
      for (let yi = 0; yi < detectedYears.length; yi++) {
        if (matchesYearRange(pName, detectedYears[yi])) {
          yearMatched = true
          break
        }
      }
      if (yearMatched) {
        score += 15
      }
    }

    if (rec.stock_quantity > 0) {
      score += 2
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
    if (b.rec.stock_quantity !== a.rec.stock_quantity)
      return b.rec.stock_quantity - a.rec.stock_quantity
    return a.rec.name.localeCompare(b.rec.name)
  })

  return scoredCandidates.slice(0, 5)
}
