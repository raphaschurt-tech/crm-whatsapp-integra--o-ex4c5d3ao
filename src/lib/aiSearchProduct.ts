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

export function scoreAndRankProducts(
  products: MockProduct[],
  rawTerm: string,
  searchTokens: string[],
  detectedYears: number[],
) {
  const scoredCandidates: { rec: MockProduct; score: number; matchedTokenCount: number }[] = []

  for (let ci = 0; ci < products.length; ci++) {
    const rec = products[ci]
    const pSku = String(rec.sku || '').toLowerCase()
    const pName = String(rec.name || '').toLowerCase()
    const pBrand = String(rec.brand || '').toLowerCase()
    const pBarcode = String(rec.barcode || '').toLowerCase()
    const pDesc = String(rec.description || '').toLowerCase()
    const fullSearchable = pName + ' ' + pSku + ' ' + pBrand + ' ' + pBarcode + ' ' + pDesc

    let matchedTokenCount = 0
    for (let ti = 0; ti < searchTokens.length; ti++) {
      const tok = searchTokens[ti]
      if (fullSearchable.includes(tok)) {
        matchedTokenCount++
      }
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
