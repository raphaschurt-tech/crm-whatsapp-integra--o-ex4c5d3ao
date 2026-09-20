migrate(
  (app) => {
    // 1. Atualizar campos da coleção 'customers'
    const customersCol = app.findCollectionByNameOrId('customers')
    const familiesCol = app.findCollectionByNameOrId('item_families')

    // Ajustar maxSelect de products em item_families para comportar todos os produtos (até 1000)
    const prodField = familiesCol.fields.getByName('products')
    if (prodField) {
      prodField.maxSelect = 1000
      app.save(familiesCol)
    }

    if (!customersCol.fields.getByName('source')) {
      customersCol.fields.add(
        new TextField({
          name: 'source',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('item_families')) {
      customersCol.fields.add(
        new RelationField({
          name: 'item_families',
          collectionId: familiesCol.id,
          cascadeDelete: false,
          required: false,
          maxSelect: 100,
        }),
      )
    }

    app.save(customersCol)

    // 2. Padronização de customer_type
    // Regra:
    // a) customer_type = 'fornecedor' (minúsculo) -> 'Fornecedor'
    // b) pipeline_status = 'fornecedores' e nome NÃO é telefone puro -> 'Fornecedor'
    // c) pipeline_status = 'fornecedores' e nome = telefone puro -> 'Cliente'
    // d) customer_type vazio no restante -> 'Cliente'
    // NÃO alterar pipeline_status de ninguém!

    const allCustomers = app.findRecordsByFilter('customers', '1=1', '', 0, 0)
    for (let i = 0; i < allCustomers.length; i++) {
      const rec = allCustomers[i]
      const name = String(rec.get('name') || '').trim()
      const rawType = String(rec.get('customer_type') || '').trim()
      const pipeStatus = String(rec.get('pipeline_status') || '').trim()

      const isDigitsOnly = /^\d+$/.test(name)

      let newType = ''
      if (rawType.toLowerCase() === 'fornecedor') {
        newType = 'Fornecedor'
      } else if (rawType.toLowerCase() === 'ambos') {
        newType = 'Ambos'
      } else if (pipeStatus === 'fornecedores') {
        if (!isDigitsOnly) {
          newType = 'Fornecedor'
        } else {
          newType = 'Cliente'
        }
      } else if (!rawType) {
        newType = 'Cliente'
      } else if (rawType.toLowerCase() === 'cliente') {
        newType = 'Cliente'
      } else {
        newType = rawType
      }

      if (rec.get('customer_type') !== newType) {
        rec.set('customer_type', newType)
        app.save(rec)
      }
    }

    // 3. Mesclar famílias duplicadas em item_families
    // "Borracha" e "borracha" (minúscula) são a mesma — mesclar somando os produtos e remover duplicata;
    // corrigir a descrição com typo ("borracha 65 siezoa" -> "Componentes de vedação e amortecimento elastomérico").
    // Criar somente as que faltam: Amortecedores, Bielas/Terminais, Bandejas, Coxins.
    const allFamilies = app.findRecordsByFilter('item_families', '1=1', 'name', 0, 0)
    let borrachaUpperRec = null
    let borrachaLowerRec = null

    for (let f = 0; f < allFamilies.length; f++) {
      const fam = allFamilies[f]
      const fName = String(fam.get('name') || '').trim()
      if (fName === 'Borracha') {
        borrachaUpperRec = fam
      } else if (fName === 'borracha') {
        borrachaLowerRec = fam
      }
    }

    if (borrachaLowerRec && borrachaUpperRec) {
      const prodsUpper = borrachaUpperRec.get('products') || []
      const prodsLower = borrachaLowerRec.get('products') || []
      const mergedProds = Array.from(new Set([...prodsUpper, ...prodsLower]))
      borrachaUpperRec.set('products', mergedProds)
      borrachaUpperRec.set('description', 'Componentes de vedação e amortecimento elastomérico')
      app.save(borrachaUpperRec)

      // Atualizar qualquer referência em product_compositions antes de deletar
      try {
        const compsWithLower = app.findRecordsByFilter(
          'product_compositions',
          `family = '${borrachaLowerRec.id}'`,
          '',
          0,
          0,
        )
        for (let c = 0; c < compsWithLower.length; c++) {
          compsWithLower[c].set('family', borrachaUpperRec.id)
          app.save(compsWithLower[c])
        }
      } catch (_) {}

      app.delete(borrachaLowerRec)
    } else if (borrachaLowerRec && !borrachaUpperRec) {
      borrachaLowerRec.set('name', 'Borracha')
      borrachaLowerRec.set('description', 'Componentes de vedação e amortecimento elastomérico')
      app.save(borrachaLowerRec)
      borrachaUpperRec = borrachaLowerRec
    }

    // Criar famílias faltantes se não existirem
    const targetFamilies = [
      { name: 'Bucha', desc: 'Buchas de articulação, deslizamento e amortecimento' },
      { name: 'Borracha', desc: 'Componentes de vedação e amortecimento elastomérico' },
      { name: 'Capa', desc: 'Capas e invólucros protetores metálicos e plásticos' },
      { name: 'Pino', desc: 'Pinos de fixação, articulação e guia' },
      { name: 'Amortecedores', desc: 'Amortecedores e conjuntos pressurizados de suspensão' },
      { name: 'Bielas/Terminais', desc: 'Bielas, terminais de direção e barras estabilizadoras' },
      { name: 'Bandejas', desc: 'Bandejas e braços oscilantes de suspensão' },
      { name: 'Coxins', desc: 'Coxins de motor, câmbio e diferencial' },
      { name: 'Pivôs', desc: 'Pivôs e juntas esféricas de suspensão' },
    ]

    for (let t = 0; t < targetFamilies.length; t++) {
      const tf = targetFamilies[t]
      try {
        app.findFirstRecordByData('item_families', 'name', tf.name)
      } catch (_) {
        const newFam = new Record(familiesCol)
        newFam.set('name', tf.name)
        newFam.set('description', tf.desc)
        newFam.set('products', [])
        app.save(newFam)
      }
    }

    // 4. Classificar produtos nas famílias por palavra-chave no nome:
    // "BUCHA" -> Bucha
    // "AMORTECEDOR" -> Amortecedores
    // "BANDEJA" -> Bandejas
    // "PIVO" / "PIVÔ" -> Pivôs
    // "BIELETA" / "TERMINAL" -> Bielas/Terminais
    // "COXIM" -> Coxins
    const updatedFamilies = app.findRecordsByFilter('item_families', '1=1', '', 0, 0)
    const familyByName = {}
    for (let uf = 0; uf < updatedFamilies.length; uf++) {
      familyByName[updatedFamilies[uf].get('name')] = updatedFamilies[uf]
    }

    const familyProductsMap = {}
    Object.keys(familyByName).forEach((k) => {
      const existing = familyByName[k].get('products') || []
      familyProductsMap[k] = new Set(existing)
    })

    const allProducts = app.findRecordsByFilter('products', '1=1', '', 0, 0)

    for (let p = 0; p < allProducts.length; p++) {
      const prod = allProducts[p]
      const pId = prod.id
      const pName = String(prod.get('name') || '').toUpperCase()

      if (pName.indexOf('BUCHA') !== -1 && familyByName['Bucha']) {
        familyProductsMap['Bucha'].add(pId)
      }
      if (pName.indexOf('AMORTECEDOR') !== -1 && familyByName['Amortecedores']) {
        familyProductsMap['Amortecedores'].add(pId)
      }
      if (pName.indexOf('BANDEJA') !== -1 && familyByName['Bandejas']) {
        familyProductsMap['Bandejas'].add(pId)
      }
      if ((pName.indexOf('PIVO') !== -1 || pName.indexOf('PIVÔ') !== -1) && familyByName['Pivôs']) {
        familyProductsMap['Pivôs'].add(pId)
      }
      if (
        (pName.indexOf('BIELETA') !== -1 || pName.indexOf('TERMINAL') !== -1) &&
        familyByName['Bielas/Terminais']
      ) {
        familyProductsMap['Bielas/Terminais'].add(pId)
      }
      if (pName.indexOf('COXIM') !== -1 && familyByName['Coxins']) {
        familyProductsMap['Coxins'].add(pId)
      }
    }

    // Salvar as listas de produtos em cada família
    Object.keys(familyProductsMap).forEach((fName) => {
      const fRec = familyByName[fName]
      if (fRec) {
        fRec.set('products', Array.from(familyProductsMap[fName]))
        app.save(fRec)
      }
    })

    // 5. Criar o cadastro "SOU.IS" em customers como Tipo = Fornecedor
    // source = "erp"
    // vinculado às famílias que fornece (todas as famílias)
    const allFamIds = app.findRecordsByFilter('item_families', '1=1', '', 0, 0).map((f) => f.id)

    let souisRec = null
    try {
      souisRec = app.findFirstRecordByData('customers', 'name', 'SOU.IS')
    } catch (_) {}

    if (!souisRec) {
      try {
        souisRec = app.findFirstRecordByData('customers', 'company', 'SOU.IS')
      } catch (_) {}
    }

    if (!souisRec) {
      souisRec = new Record(customersCol)
      souisRec.set('name', 'SOU.IS')
      souisRec.set('company', 'SOU.IS')
      souisRec.set('phone', '5511000000000')
      souisRec.set('customer_type', 'Fornecedor')
      souisRec.set('source', 'erp')
      souisRec.set('item_families', allFamIds)
      souisRec.set('notes', 'Fornecedor oficial integrado via ERP SOU.IS')
      app.save(souisRec)
    } else {
      souisRec.set('customer_type', 'Fornecedor')
      souisRec.set('source', 'erp')
      souisRec.set('item_families', allFamIds)
      app.save(souisRec)
    }

    // Salvar auditoria na descrição da coleção ou registro de log
    try {
      const fams = app.findRecordsByFilter('item_families', '1=1', '', 0, 0)
      const prodsWithFam = new Set()
      for (let f = 0; f < fams.length; f++) {
        const plist = fams[f].get('products') || []
        for (let pl = 0; pl < plist.length; pl++) {
          prodsWithFam.add(plist[pl])
        }
      }
      let unclassified = 0
      for (let ap = 0; ap < allProducts.length; ap++) {
        if (!prodsWithFam.has(allProducts[ap].id)) unclassified++
      }

      const allSuppliers = app.findRecordsByFilter(
        'customers',
        "customer_type = 'Fornecedor' || customer_type = 'Ambos'",
        'name',
        0,
        0,
      )
      const supplierNames = allSuppliers.map((s) => s.get('name'))

      // Gravar nota explicativa em souisRec
      souisRec.set(
        'notes',
        `Fornecedor oficial ERP SOU.IS. Auditoria de Classificação: ${allProducts.length} produtos totais, ${unclassified} produtos sem família, ${allProducts.length - unclassified} classificados. Fornecedores padronizados (${allSuppliers.length}): ${JSON.stringify(supplierNames)}`,
      )
      app.save(souisRec)
    } catch (_) {}
  },
  (app) => {
    try {
      const souis = app.findFirstRecordByData('customers', 'name', 'SOU.IS')
      if (souis && souis.get('source') === 'erp') {
        app.delete(souis)
      }
    } catch (_) {}
  },
)
