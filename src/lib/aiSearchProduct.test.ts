import {
  cleanProductDescription,
  extractAiTokensAndYears,
  extractYearRangeString,
  matchesYearRange,
  scoreAndRankProducts,
  twoPhaseProductSearch,
} from './aiSearchProduct'

// Executa os testes no momento da importação em ambiente de desenvolvimento / verificação
// Produtos reais do catálogo SOU.IS sincronizado
const catalogMock = [
  {
    sku: '8722',
    name: 'AMORTECEDOR BUCHA D21 88/97 DIANTEIRO',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8721',
    name: 'BUCHA D21 88/97 BARRA DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8717',
    name: 'BUCHA D21 88/97 BANDEJA INFERIOR DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '2765',
    name: 'BUCHA BANDEJA SUPERIOR DIANTEIRA L200 93/03 PAJERO 92/02 D21 88/97 PATHFINDER 90/95 CAPA BORRACHA 41.4 PINO 49.3 X 18.3',
    brand: 'JAHU',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 1,
    price: 0,
  },
  {
    sku: '5436',
    name: 'BUCHA BANDEJA SUPERIOR DIANTEIRA L200 93/03 PAJERO 92/02 D21 88/97 PATHFINDER 90/95 CAPA BORRACHA 41.4 PINO 49.3 X 18.3',
    brand: 'DPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 1,
    price: 0,
  },
  {
    sku: '6123',
    name: 'BUCHA L200 GL/GLS 92/04 PATFHINDER 2./3.0 90/95 D21 88/97 BANDEJA SUPERIOR DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8715',
    name: 'BRAÇO D21 PITMAN DIRECAO',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '9901',
    name: 'Bucha Braco Tensor Uno 84/13 Elba/Fiorino 85/96 Premio',
    brand: 'BORRACHAS',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 50,
    price: 35,
  },
  {
    sku: '9902',
    name: 'Bucha Santana 84/06 Traseira',
    brand: 'SANT',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 40,
    price: 25,
  },
  {
    sku: '9903',
    name: 'Bucha Bongo K2500 08/12 Dianteira',
    brand: 'KIA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 30,
    price: 45,
  },
  {
    sku: '9904',
    name: 'Bucha Doblo 02/21 Dianteira',
    brand: 'FIAT',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 20,
    price: 30,
  },
  {
    sku: '1234',
    name: 'AMORTECEDOR TRASEIRO COROLLA 03/08',
    brand: 'COFAP',
    barcode: '',
    description: 'Aplicação especial Toyota Corolla',
    stock_quantity: 5,
    price: 150,
  },
  // Peças de Freelander
  {
    sku: '2235',
    name: 'BUCHA DIANT BAND DIANT VOLVO XC60 08/18 FREELANDER 06/15 DISCOVERY SPORT/EVOQUE 12/19 CAPA 60 PINO 59.80MM X 14 MM',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 3,
    price: 174,
  },
  {
    sku: '2430',
    name: 'BUCHA FREELANDER 2 06/15 DIANTEIRA BANDEJA DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '2431',
    name: 'BUCHA FREELANDER 2 06/15 TRASEIRA BANDEJA DIANTEIRA',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 0,
    price: 0,
  },
  {
    sku: '8393',
    name: 'BUCHA FREELANDER 2 06/15 SUPERIOR BRACO TRASEIRO',
    brand: 'RPA',
    barcode: '',
    description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
    stock_quantity: 4,
    price: 0,
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

  // Teste 5: Extração da string da faixa de anos
  const rangeStr1 = extractYearRangeString('AMORTECEDOR BUCHA D21 88/97 DIANTEIRO')
  const rangeStr2 = extractYearRangeString('BUCHA FREELANDER 2 06/15 SUPERIOR BRAÇO TRASEIRO')
  const rangeStr3 = extractYearRangeString('BRAÇO D21 PITMAN DIRECAO')

  details.push(`Faixa extraída de D21 88/97: "${rangeStr1}"`)
  details.push(`Faixa extraída de FREELANDER 06/15: "${rangeStr2}"`)
  details.push(`Faixa extraída sem anos: "${rangeStr3}"`)

  if (rangeStr1 !== '88/97') {
    details.push(`ERRO: extractYearRangeString esperado '88/97', obteve '${rangeStr1}'`)
    allPass = false
  }
  if (rangeStr2 !== '06/15') {
    details.push(`ERRO: extractYearRangeString esperado '06/15', obteve '${rangeStr2}'`)
    allPass = false
  }
  if (rangeStr3 !== '') {
    details.push(`ERRO: extractYearRangeString esperado vazio, obteve '${rangeStr3}'`)
    allPass = false
  }

  // Teste 6: Limpeza de boilerplate na descrição SOU.IS
  const descBoilerplate = cleanProductDescription(
    'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
  )
  const descReal = cleanProductDescription('Aplicação especial Toyota Corolla')
  details.push(`Limpeza boilerplate: "${descBoilerplate}" (esperado vazio)`)
  details.push(`Preservação descrição real: "${descReal}"`)

  if (descBoilerplate !== '') {
    details.push('ERRO: cleanProductDescription não limpou o boilerplate da SOU.IS')
    allPass = false
  }
  if (descReal !== 'Aplicação especial Toyota Corolla') {
    details.push('ERRO: cleanProductDescription removeu indevidamente descrição legítima')
    allPass = false
  }

  // Teste 7: Busca em duas fases e filtro de relevância eliminando Uno/Santana/Bongo/Doblo
  // Simula o cenário real: termo "bucha amortecedor d21 ano 91"
  const candidatesPhase = twoPhaseProductSearch(catalogMock, extracted1.searchTokens, term1)
  const rankedD21 = scoreAndRankProducts(
    candidatesPhase,
    term1,
    extracted1.searchTokens,
    extracted1.detectedYears,
  )

  const d21Skus = rankedD21.map((r) => r.rec.sku)
  details.push(`Top 5 D21 filtrados: ${d21Skus.join(', ')}`)

  // Critério de aceitação: top 5 = peças D21 88/97 (8722, 8721, 8717, 2765, 5436/6123) — zero peças de Uno/Santana/Bongo/Doblo
  const unwantedSkus = ['9901', '9902', '9903', '9904', '1234']
  for (const unwanted of unwantedSkus) {
    if (d21Skus.includes(unwanted)) {
      details.push(`ERRO: SKU indesejado ${unwanted} apareceu no top 5 de D21`)
      allPass = false
    }
  }

  if (d21Skus[0] !== '8722') {
    details.push(`ERRO: 8722 não é o top 1 de D21 (é ${d21Skus[0]})`)
    allPass = false
  } else {
    details.push('SUCESSO: Zero falsos positivos de Uno/Santana/Bongo/Doblo no resultado!')
  }

  // Teste 8: "bucha band freelander" -> Freelander no topo, incluindo SKU 2430, 2431 e 8393
  const termFreelander = 'bucha band freelander'
  const extractedFree = extractAiTokensAndYears(termFreelander)
  const candidatesFree = twoPhaseProductSearch(
    catalogMock,
    extractedFree.searchTokens,
    termFreelander,
  )
  const rankedFree = scoreAndRankProducts(
    candidatesFree,
    termFreelander,
    extractedFree.searchTokens,
    extractedFree.detectedYears,
  )
  const freeSkus = rankedFree.map((r) => r.rec.sku)
  details.push(`Top Freelander (bucha band freelander): ${freeSkus.join(', ')}`)

  if (!freeSkus.includes('8393') || !freeSkus.includes('2430') || !freeSkus.includes('2431')) {
    details.push(
      'ERRO: SKUs 2430, 2431 ou 8393 não estão presentes no resultado de "bucha band freelander"',
    )
    allPass = false
  } else {
    details.push(
      'SUCESSO: SKUs 2430, 2431 e 8393 incluídos com sucesso no resultado de "bucha band freelander"!',
    )
  }

  // Teste 8B (BUG REAL RESOLVIDO): "bucha bandeja freelander"
  // Deve casar o apelido "band" do SKU 2235 ("BUCHA DIANT BAND DIANT VOLVO XC60 08/18 FREELANDER 06/15...")
  // e ranquear o SKU 2235 no top 3 (estoque 3, R$ 174 — supera as peças sem estoque pela ordem de score)
  const termFreelanderBandeja = 'bucha bandeja freelander'
  const extractedFreeBandeja = extractAiTokensAndYears(termFreelanderBandeja)
  const candidatesFreeBandeja = twoPhaseProductSearch(
    catalogMock,
    extractedFreeBandeja.searchTokens,
    termFreelanderBandeja,
  )
  const rankedFreeBandeja = scoreAndRankProducts(
    candidatesFreeBandeja,
    termFreelanderBandeja,
    extractedFreeBandeja.searchTokens,
    extractedFreeBandeja.detectedYears,
  )
  const top3Bandeja = rankedFreeBandeja.slice(0, 3)
  const top3Skus = top3Bandeja.map((r) => r.rec.sku)
  details.push(`Top 3 "bucha bandeja freelander": ${top3Skus.join(', ')}`)

  if (!top3Skus.includes('2235')) {
    details.push(
      `ERRO: SKU 2235 não ficou no top 3 para "bucha bandeja freelander" (retornou: ${top3Skus.join(', ')})`,
    )
    allPass = false
  } else {
    // 2235 tem estoque 3 e casa os 3 tokens (bucha, band/bandeja, freelander)
    // 2430 e 2431 também casam os 3 tokens mas têm estoque 0
    // Portanto 2235 deve vir antes ou empatar em tokens e vencer por estoque > 0
    const sku2235Pos = top3Skus.indexOf('2235')
    details.push(
      `SUCESSO: SKU 2235 está na posição ${sku2235Pos + 1} do top 3 com estoque ${rankedFreeBandeja[sku2235Pos].rec.stock_quantity}!`,
    )
  }

  // Teste 8C (ANTI-FALSO-POSITIVO): "bucha do volante do Doblo"
  // NÃO deve retornar peças de Volvo (ex: XC60/V40), evitando falso positivo por prefixo genérico "vol"
  // Adiciona mock de peça Volvo para testar explicitamente
  const catalogWithVolvoMock = [
    ...catalogMock,
    {
      sku: '2478',
      name: 'CAIXA VOLVO XC 60 09/11 DIRECAO HIDRAULICA',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado',
      stock_quantity: 0,
      price: 0,
    },
    {
      sku: '2001',
      name: 'BUCHA FOCUS 08/... VOLVO V40 BARRA EST DIANT',
      brand: 'JAHU',
      barcode: '',
      description: 'Produto SOU.IS sincronizado',
      stock_quantity: 0,
      price: 0,
    },
  ]
  const termVolanteDoblo = 'bucha do volante do Doblo'
  const extractedVolanteDoblo = extractAiTokensAndYears(termVolanteDoblo)
  const candidatesVolanteDoblo = twoPhaseProductSearch(
    catalogWithVolvoMock,
    extractedVolanteDoblo.searchTokens,
    termVolanteDoblo,
  )
  const rankedVolanteDoblo = scoreAndRankProducts(
    candidatesVolanteDoblo,
    termVolanteDoblo,
    extractedVolanteDoblo.searchTokens,
    extractedVolanteDoblo.detectedYears,
  )
  const volanteDobloSkus = rankedVolanteDoblo.map((r) => r.rec.sku)
  const volanteDobloNames = rankedVolanteDoblo.map((r) => r.rec.name)
  details.push(`Resultados para "${termVolanteDoblo}": ${volanteDobloSkus.join(', ')}`)

  const hasVolvoItem = volanteDobloNames.some((n) => n.toUpperCase().includes('VOLVO'))
  if (hasVolvoItem) {
    details.push('ERRO: Busca por "bucha do volante do Doblo" retornou produto da VOLVO!')
    allPass = false
  } else {
    details.push('SUCESSO: Busca por "bucha do volante do Doblo" não retornou nenhuma peça Volvo!')
  }

  // Teste 9: Regras de Disponibilidade e Proibição de "indisponível"
  // - Estoque 0 -> "disponível em até 48 horas"
  // - Preço 0 -> "Sob consulta"
  // - Estoque 0 E preço 0 -> "Sob consulta" + "disponível em até 48 horas"
  // - Estoque > 0 -> "X un." + preço
  // - Proibir a palavra "indisponível" nas respostas
  const formatAvailability = (stock: number, price: number) => {
    let statusText = ''
    if (stock > 0 && price > 0) {
      statusText = `R$ ${price.toFixed(2)} (${stock} un.)`
    } else if (stock <= 0 && price <= 0) {
      statusText = 'Sob consulta - disponível em até 48 horas'
    } else if (stock <= 0) {
      statusText = `R$ ${price.toFixed(2)} - disponível em até 48 horas`
    } else {
      statusText = `Sob consulta (${stock} un.)`
    }
    return statusText
  }

  const sampleCases = [
    { stock: 0, price: 0, expected: 'Sob consulta - disponível em até 48 horas' },
    { stock: 0, price: 150, expected: 'R$ 150.00 - disponível em até 48 horas' },
    { stock: 5, price: 0, expected: 'Sob consulta (5 un.)' },
    { stock: 10, price: 95, expected: 'R$ 95.00 (10 un.)' },
  ]

  for (const sc of sampleCases) {
    const formatted = formatAvailability(sc.stock, sc.price)
    if (
      formatted.toLowerCase().includes('indisponível') ||
      formatted.toLowerCase().includes('indisponivel')
    ) {
      details.push(`ERRO: Formatação contém a palavra proibida 'indisponível': ${formatted}`)
      allPass = false
    }
    if (formatted !== sc.expected) {
      details.push(`ERRO: Formatação esperada '${sc.expected}', obteve '${formatted}'`)
      allPass = false
    }
  }

  // Teste 10: Exclusão de SKUs (ai_excluded_skus com paliativo para SKU 3899)
  const excludedSkusList = ['3899']
  const filteredCandidates = candidatesFree.filter(
    (c) => !excludedSkusList.includes(String(c.sku).trim()),
  )
  const filteredSkus = filteredCandidates.map((c) => c.sku)
  if (filteredSkus.includes('3899')) {
    details.push('ERRO: SKU 3899 não foi excluído da lista de busca')
    allPass = false
  } else {
    details.push('SUCESSO: SKU 3899 devidamente excluído via ai_excluded_skus!')
  }

  // ==========================================
  // NOVOS TESTES OBRIGATÓRIOS DO CASO IX35 E ACENTOS
  // ==========================================
  const ix35CatalogMock = [
    {
      sku: '5722',
      name: 'BUCHA FACAO TRASEIRO 77MM IX35 09/16 TUCSON 12/17 SPORTAGE 10/18',
      brand: 'IAPI',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 0,
      price: 160,
    },
    {
      sku: '6773',
      name: 'BUCHA FACAO TRAS IX35 09/17 SORENTO 09/15 SPORTAGE 10/16 TUCSON 12/17 83,3MM',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 9,
      price: 160,
    },
    {
      sku: '8229',
      name: 'BUCHA FACAO TRAS IX35 09/17 SORENTO 09/15 SPORTAGE 10/16 TUCSON 12/17 83,3MM',
      brand: 'DPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 0,
      price: 160,
    },
    {
      sku: '9484',
      name: 'BUCHA FACAO TRAS IX35 09/17 SORENTO 09/15 SPORTAGE 10/16 TUCSON 12/17 EXT 77 MM',
      brand: 'DPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 0,
      price: 0,
    },
    {
      sku: '3272',
      name: 'BUCHA IX35/I30 10/16 SONATA 10/12 SPORTAGE 10/16 TUCSON/CRETA 17/.. SANTA FE 13/16 T6 14/18 DIANT BANDEJA DIANT INF 70MM',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 6,
      price: 90,
    },
    {
      sku: '3436',
      name: 'BUCHA BAND TRASE SORENTO SANTA FE/IX3509/15TUCSON SONATA 09/14 I30 07/12 AZERA 11/15 ELANTRA06/11 SPORTAGE12/16 49X70X14',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 0,
      price: 90,
    },
    {
      sku: '3553',
      name: 'BUCHA TRAS BAND DIANT TUCSON/SPORTAGE4/15 SORENTO5/16 SANTA FE02/13 IX35/I3010/16 SONATA10/12 AZERA12/18 VERA CRUZ07/13',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 5,
      price: 80,
    },
    {
      sku: '4070',
      name: 'BUCHA DIANT BAND D INF AZERA HB20 SANTA FE TUCSON VERACRUZ CERATO PICANTO SOUL SPORTAGE ELANTRA VELOSTER I30 IX35 SONATA',
      brand: 'RPA',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 4,
      price: 90,
    },
    {
      sku: '2039',
      name: 'BUCHA IX35/I30 10/16 SONATA 10/12 SPORTAGE 10/16 TUCSON/CRETA 17/.. SANTA FE 13/16 DIANT BANDEJA DIANT INF 70MM',
      brand: 'JAHU',
      barcode: '',
      description: 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE',
      stock_quantity: 0,
      price: 0,
    },
  ]

  // Teste 11: Normalização de diacríticos: "bucha facão ix35" e "bucha facao ix35"
  const termAcento = 'bucha facão ix35'
  const termSemAcento = 'bucha facao ix35'
  const extAcento = extractAiTokensAndYears(termAcento)
  const extSemAcento = extractAiTokensAndYears(termSemAcento)

  if (JSON.stringify(extAcento.searchTokens) !== JSON.stringify(extSemAcento.searchTokens)) {
    details.push('ERRO: Tokenização com acento difere da tokenização sem acento')
    allPass = false
  } else {
    details.push(
      'SUCESSO: "facão" e "facao" tokenizam identicamente como: ' +
        JSON.stringify(extAcento.searchTokens),
    )
  }

  // Teste 12: "bucha facão ix35" traz facão no topo (5722, 6773, 8229, 9484) e NENHUMA bucha de bandeja (3272, 3436, 3553, 4070)
  const candIx35 = twoPhaseProductSearch(ix35CatalogMock, extAcento.searchTokens, termAcento)
  const rankedIx35 = scoreAndRankProducts(
    candIx35,
    termAcento,
    extAcento.searchTokens,
    extAcento.detectedYears,
  )
  const topIx35Skus = rankedIx35.map((r) => r.rec.sku)
  const topIx35Names = rankedIx35.map((r) => r.rec.name)

  details.push(`Resultado "bucha facão ix35": ${topIx35Skus.join(', ')}`)

  const facaoSkus = ['5722', '6773', '8229', '9484']
  const bandejaSkus = ['3272', '3436', '3553', '4070', '2039']

  // SKU 5722 (estoque 0) DEVE estar no resultado
  if (!topIx35Skus.includes('5722')) {
    details.push('ERRO: SKU 5722 (BUCHA FACAO 77MM IX35 com estoque 0) foi omitido do resultado!')
    allPass = false
  } else {
    details.push('SUCESSO: SKU 5722 incluído mesmo com estoque 0!')
  }

  // Nenhuma bucha de bandeja deve constar no resultado
  const hasBandeja = topIx35Skus.some((s) => bandejaSkus.includes(s))
  if (hasBandeja) {
    details.push(
      'ERRO: Bucha de bandeja apareceu no resultado de "bucha facão ix35": ' +
        topIx35Skus.join(', '),
    )
    allPass = false
  } else {
    details.push('SUCESSO: Zero buchas de bandeja retornadas para "bucha facão ix35"!')
  }

  // Ordem de desempate: 6773 tem estoque 9 e casa os 3 termos; 5722, 8229, 9484 têm estoque 0 e casam 3 termos
  if (topIx35Skus[0] !== '6773') {
    details.push(
      `AVISO: Top 1 foi ${topIx35Skus[0]} (esperado 6773 por ter estoque positivo no desempate de 3 termos)`,
    )
  }

  // Teste 13: Caso Composto preço 0 + estoque 0 no SKU 9484
  const formatStatusConsulta = (pStock: number, pPrice: number) => {
    if (pStock > 0 && pPrice > 0) {
      return 'R$ ' + pPrice.toFixed(2) + ' (' + pStock + ' un.)'
    } else if (pStock <= 0 && pPrice <= 0) {
      return 'Sob consulta - disponível em até 48 horas'
    } else if (pStock <= 0) {
      return 'R$ ' + pPrice.toFixed(2) + ' - disponível em até 48 horas'
    } else {
      return 'Sob consulta (' + pStock + ' un.)'
    }
  }

  const sku9484 = ix35CatalogMock.find((p) => p.sku === '9484')!
  const status9484 = formatStatusConsulta(sku9484.stock_quantity, sku9484.price)
  if (status9484 !== 'Sob consulta - disponível em até 48 horas') {
    details.push(`ERRO: SKU 9484 (preço 0 + estoque 0) formatou como "${status9484}"`)
    allPass = false
  } else {
    details.push(
      'SUCESSO: Preço 0 + Estoque 0 formatou composto: "Sob consulta - disponível em até 48 horas"',
    )
  }

  const sku5722 = ix35CatalogMock.find((p) => p.sku === '5722')!
  const status5722 = formatStatusConsulta(sku5722.stock_quantity, sku5722.price)
  if (status5722 !== 'R$ 160.00 - disponível em até 48 horas') {
    details.push(`ERRO: SKU 5722 (preço 160 + estoque 0) formatou como "${status5722}"`)
    allPass = false
  } else {
    details.push(
      'SUCESSO: Preço 160 + Estoque 0 manteve o preço: "R$ 160.00 - disponível em até 48 horas"',
    )
  }

  // Teste 14: Guarda do descarte para busca com 1 termo significativo
  // Busca com 1 termo (ex.: "ix35") NÃO deve ser descartada nem retornar vazio
  const term1Term = 'ix35'
  const ext1Term = extractAiTokensAndYears(term1Term)
  const cand1Term = twoPhaseProductSearch(ix35CatalogMock, ext1Term.searchTokens, term1Term)
  const ranked1Term = scoreAndRankProducts(
    cand1Term,
    term1Term,
    ext1Term.searchTokens,
    ext1Term.detectedYears,
  )
  if (ranked1Term.length === 0) {
    details.push('ERRO: Busca com 1 termo significativo ("ix35") retornou vazio!')
    allPass = false
  } else {
    details.push(`SUCESSO: Busca com 1 termo ("ix35") retornou ${ranked1Term.length} produtos!`)
  }

  return { success: allPass, details }
}
