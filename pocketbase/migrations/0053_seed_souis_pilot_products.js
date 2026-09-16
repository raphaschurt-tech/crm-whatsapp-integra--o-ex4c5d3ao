// Migração de seed piloto para validar as regras de sincronização da SOU.IS:
// 1. Cada produto na View VW_PRODUTO_PRECO_ESTOQUE retorna 2 linhas ('110%' e '130%')
// 2. Colunas: COD_PROD, NOME_PROD, lista_preco, preço, saldo_prod
// 3. Saldo NULL ou ausente -> tratado como 0 (sem estoque)
// 4. Registros de teste como 'duplicidade', 'não usar', 'Tabela Simulação de preço' -> filtrados/ignorados
// 5. Tabela 130% definida como custo e preço base de venda
// 6. Tabela 110% armazenada em price_110 como alternativa
// 7. Produtos espelhados na coleção 'products' com fornecedor 'SOU.IS', product_type 'comprado', is_purchased = true

migrate(
  (app) => {
    const productsCol = app.findCollectionByNameOrId('products')

    // Simulação das linhas brutas conforme chegam da View VW_PRODUTO_PRECO_ESTOQUE
    const rawViewRows = [
      // Produto 1: Terminal de Direção Ford Ka (110% e 130%, estoque 15)
      {
        COD_PROD: 'SOU-TD-001',
        NOME_PROD: 'Terminal de Direção Ford Ka 2015-2021',
        lista_preco: '110%',
        preço: 85.0,
        saldo_prod: 15,
      },
      {
        COD_PROD: 'SOU-TD-001',
        NOME_PROD: 'Terminal de Direção Ford Ka 2015-2021',
        lista_preco: '130%',
        preço: 100.45,
        saldo_prod: 15,
      },

      // Produto 2: Bieleta Barra Estabilizadora Civic (110% e 130%, saldo NULL -> tratado como 0/sem estoque)
      {
        COD_PROD: 'SOU-BE-002',
        NOME_PROD: 'Bieleta Barra Estabilizadora Dianteira Civic G10',
        lista_preco: '110%',
        preço: 42.5,
        saldo_prod: null,
      },
      {
        COD_PROD: 'SOU-BE-002',
        NOME_PROD: 'Bieleta Barra Estabilizadora Dianteira Civic G10',
        lista_preco: '130%',
        preço: 50.2,
        saldo_prod: null,
      },

      // Produto 3: Amortecedor Dianteiro Onix (110% e 130%, estoque 8)
      {
        COD_PROD: 'SOU-AM-003',
        NOME_PROD: 'Amortecedor Dianteiro Pressurizado Onix / Prisma',
        lista_preco: '110%',
        preço: 240.0,
        saldo_prod: 8,
      },
      {
        COD_PROD: 'SOU-AM-003',
        NOME_PROD: 'Amortecedor Dianteiro Pressurizado Onix / Prisma',
        lista_preco: '130%',
        preço: 283.6,
        saldo_prod: 8,
      },

      // Produto 4: Pastilha de Freio Cerâmica Corolla (110% e 130%, estoque 22)
      {
        COD_PROD: 'SOU-PF-004',
        NOME_PROD: 'Jogo Pastilha de Freio Cerâmica Corolla 2015-2022',
        lista_preco: '110%',
        preço: 115.0,
        saldo_prod: 22,
      },
      {
        COD_PROD: 'SOU-PF-004',
        NOME_PROD: 'Jogo Pastilha de Freio Cerâmica Corolla 2015-2022',
        lista_preco: '130%',
        preço: 135.9,
        saldo_prod: 22,
      },

      // Registros de teste que DEVEM ser filtrados e ignorados
      {
        COD_PROD: 'TEST-001',
        NOME_PROD: 'Item teste duplicidade',
        lista_preco: '130%',
        preço: 1.0,
        saldo_prod: 0,
      },
      {
        COD_PROD: 'TEST-002',
        NOME_PROD: 'Não Usar - Peça Descontinuada',
        lista_preco: '110%',
        preço: 5.0,
        saldo_prod: 10,
      },
      {
        COD_PROD: 'TEST-003',
        NOME_PROD: 'Peça Normal Teste',
        lista_preco: 'Tabela Simulação de preço',
        preço: 99.0,
        saldo_prod: 5,
      },
    ]

    const testKeywords = [
      'duplicidade',
      'não usar',
      'nao usar',
      'tabela simulação de preço',
      'simulação de preço',
      'simulacao de preco',
      'teste',
    ]
    const productsMap = {}

    for (let i = 0; i < rawViewRows.length; i++) {
      const r = rawViewRows[i]
      const codProd = String(r.COD_PROD || '').trim()
      const nomeProd = String(r.NOME_PROD || '').trim()
      const listaPreco = String(r.lista_preco || '').trim()
      const precoRaw = r['preço']
      const saldoRaw = r.saldo_prod

      if (!codProd || !nomeProd) continue

      const lowerNome = nomeProd.toLowerCase()
      const lowerLista = listaPreco.toLowerCase()
      let isTest = false
      for (let k = 0; k < testKeywords.length; k++) {
        if (
          lowerNome.indexOf(testKeywords[k]) !== -1 ||
          lowerLista.indexOf(testKeywords[k]) !== -1
        ) {
          isTest = true
          break
        }
      }
      if (isTest) continue

      // Saldo NULL -> 0
      let saldo = 0
      if (saldoRaw !== null && saldoRaw !== undefined && saldoRaw !== '') {
        const numSaldo = Number(saldoRaw)
        if (!isNaN(numSaldo) && numSaldo > 0) saldo = numSaldo
      }

      let preco = 0
      if (precoRaw !== null && precoRaw !== undefined && precoRaw !== '') {
        const numPreco = Number(precoRaw)
        if (!isNaN(numPreco)) preco = numPreco
      }

      if (!productsMap[codProd]) {
        productsMap[codProd] = {
          cod_prod: codProd,
          nome_prod: nomeProd,
          saldo_prod: saldo,
          preco_110: 0,
          preco_130: 0,
        }
      }

      if (saldo > productsMap[codProd].saldo_prod) {
        productsMap[codProd].saldo_prod = saldo
      }

      if (listaPreco.indexOf('110') !== -1) {
        productsMap[codProd].preco_110 = preco
      } else if (listaPreco.indexOf('130') !== -1) {
        productsMap[codProd].preco_130 = preco
      }
    }

    const keys = Object.keys(productsMap)
    for (let j = 0; j < keys.length; j++) {
      const item = productsMap[keys[j]]
      const sku = item.cod_prod
      const name = item.nome_prod
      const basePrice = item.preco_130 > 0 ? item.preco_130 : item.preco_110
      const price110 = item.preco_110
      const price130 = item.preco_130
      const stockQty = item.saldo_prod

      let record
      try {
        record = app.findFirstRecordByData('products', 'sku', sku)
      } catch (_) {
        record = new Record(productsCol)
        record.set('sku', sku)
        record.set('external_id', 'SOU_' + sku)
      }

      record.set('name', name)
      record.set('price', basePrice)
      record.set('cost', basePrice)
      record.set('stock_quantity', stockQty)
      record.set('min_stock', 2)
      record.set('price_110', price110)
      record.set('price_130', price130)
      record.set('supplier', 'SOU.IS')
      record.set('product_type', 'comprado')
      record.set('is_purchased', true)
      record.set('description', 'Produto SOU.IS sincronizado via View VW_PRODUTO_PRECO_ESTOQUE')
      app.save(record)
    }
  },
  (app) => {
    const skus = ['SOU-TD-001', 'SOU-BE-002', 'SOU-AM-003', 'SOU-PF-004']
    for (let s = 0; s < skus.length; s++) {
      try {
        const rec = app.findFirstRecordByData('products', 'sku', skus[s])
        app.delete(rec)
      } catch (_) {}
    }
  },
)
