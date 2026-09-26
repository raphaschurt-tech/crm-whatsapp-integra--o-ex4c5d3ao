import { extractAiTokensAndYears, matchesYearRange, scoreAndRankProducts } from './aiSearchProduct'

// Produtos reais do catálogo SOU.IS sincronizado
const catalogMock = [
  {
    sku: '8722',
    name: 'AMORTECEDOR BUCHA D21 88/97 DIANTEIRO',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8721',
    name: 'BUCHA D21 88/97 BARRA DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8717',
    name: 'BUCHA D21 88/97 BANDEJA INFERIOR DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '2765',
    name: 'BUCHA BANDEJA SUPERIOR DIANTEIRA L200 93/03 PAJERO 92/02 D21 88/97 PATHFINDER 90/95 CAPA BORRACHA 41.4 PINO 49.3 X 18.3',
    brand: 'JAHU',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 1,
    price: 0,
  },
  {
    sku: '5436',
    name: 'BUCHA BANDEJA SUPERIOR DIANTEIRA L200 93/03 PAJERO 92/02 D21 88/97 PATHFINDER 90/95 CAPA BORRACHA 41.4 PINO 49.3 X 18.3',
    brand: 'DPA',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 1,
    price: 0,
  },
  {
    sku: '8715',
    name: 'BRAÇO D21 PITMAN DIRECAO',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '1234',
    name: 'AMORTECEDOR TRASEIRO COROLLA 03/08',
    brand: 'COFAP',
    barcode: '',
    description: 'Outro carro',
    stock_quantity: 5,
    price: 150,
  },
]

export function runAiSearchUnitTest(): { success: boolean; details: string[] } {
  const details: string[] = []
  let allPass = true

  // Teste 1: Termo do cliente "bucha amortecedor d21 1991"
  const term1 = 'bucha amortecedor d21 1991'
  const extracted1 = extractAiTokensAndYears(term1)

  details.push(`Tokens extraídos para "${term1}": ${JSON.stringify(extracted1.searchTokens)}`)
  details.push(`Anos detectados para "${term1}": ${JSON.stringify(extracted1.detectedYears)}`)

  if (
    !extracted1.searchTokens.includes('bucha') ||
    !extracted1.searchTokens.includes('amortecedor') ||
    !extracted1.searchTokens.includes('d21')
  ) {
    details.push('ERRO: tokens esperados [bucha, amortecedor, d21] não foram encontrados')
    allPass = false
  }
  if (!extracted1.detectedYears.includes(91)) {
    details.push('ERRO: ano 91 não foi detectado em 1991')
    allPass = false
  }

  // Teste 2: Faixa de anos "88/97" deve casar com 91
  const matches8897 = matchesYearRange('AMORTECEDOR BUCHA D21 88/97 DIANTEIRO', 91)
  details.push(`Matches 91 com faixa 88/97: ${matches8897}`)
  if (!matches8897) {
    details.push('ERRO: matchesYearRange falhou ao casar 91 com faixa 88/97')
    allPass = false
  }

  // Teste 3: Ranking e relevância
  const ranked = scoreAndRankProducts(
    catalogMock,
    term1,
    extracted1.searchTokens,
    extracted1.detectedYears,
  )
  details.push(
    `Top 5 retornados: ${ranked.map((r) => `${r.rec.sku} (score ${r.score})`).join(', ')}`,
  )

  // SKU 8722 casa com 'bucha', 'amortecedor', 'd21' E ano 91 na faixa 88/97.
  // Deve estar em 1º lugar!
  if (ranked.length === 0 || ranked[0].rec.sku !== '8722') {
    details.push(`ERRO: SKU 8722 não ficou em 1º lugar no ranking (ficou ${ranked[0]?.rec?.sku})`)
    allPass = false
  } else {
    details.push(
      'SUCESSO: SKU 8722 (AMORTECEDOR BUCHA D21 88/97 DIANTEIRO) ficou em 1º lugar com score ' +
        ranked[0].score,
    )
  }

  // SKU 8721 e 8717 e 2765 também devem estar no top
  const foundSkus = ranked.map((r) => r.rec.sku)
  if (!foundSkus.includes('8721') || !foundSkus.includes('8717')) {
    details.push('ERRO: SKUs 8721 ou 8717 não estão no top 5')
    allPass = false
  }

  // Teste 4: Cliente pergunta "Tem bucha amortecedor d21 ano 91?"
  const term2 = 'Tem bucha amortecedor d21 ano 91?'
  const extracted2 = extractAiTokensAndYears(term2)
  details.push(`Tokens extraídos para "${term2}": ${JSON.stringify(extracted2.searchTokens)}`)
  if (extracted2.searchTokens.includes('tem') || extracted2.searchTokens.includes('ano')) {
    details.push('ERRO: stopwords "tem" ou "ano" não foram removidas')
    allPass = false
  }
  const ranked2 = scoreAndRankProducts(
    catalogMock,
    term2,
    extracted2.searchTokens,
    extracted2.detectedYears,
  )
  if (ranked2.length === 0 || ranked2[0].rec.sku !== '8722') {
    details.push(`ERRO: Para pergunta "${term2}", SKU 8722 não ficou em 1º lugar`)
    allPass = false
  } else {
    details.push(`SUCESSO: Para pergunta com stopwords "${term2}", SKU 8722 é top 1`)
  }

  return { success: allPass, details }
}
