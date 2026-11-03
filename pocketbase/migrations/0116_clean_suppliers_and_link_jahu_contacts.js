/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migração 0116: Limpeza fina de fornecedores e reclassificação Jahu (0.0.262)
    // Regras rígidas:
    // - Não fundir nem apagar nenhum registro.
    // - Contagem de contatos antes = contagem depois (nenhuma criação espúria nem exclusão).
    // - Usar o motor de dedupe antes de criar: se existir registro correspondente, vincular ao invés de duplicar.
    // - Extrair dados das notas retidas na Fila de Revisão:
    //     MEC LAN: CNPJ 62538228000197, email nfe@meclan.com.br, razão MEC LAN INDUSTRIA E COMERCIO LTDA EPP
    //     OXILAPA: CNPJ 59417469000173, email rpaimportadora@gmail.com, razão OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA
    // - Jahu Filiais: 61136701000732 (filial das 7 notas 500503..506904) vinculada à entidade Jahu (ukuwsuetw0d3p2m) em customer_documents
    // - Reclassificar contatos pessoais Jahu ("Jahu Fixo", "Elenice Jahu", "Jahu Rogerio"):
    //     company: JAHU BORRACHAS E AUTOPECAS LTDA
    //     mantendo telefone deles como contato da empresa.

    function cleanDigits(val) {
      if (!val) return ''
      return String(val).replace(/\D/g, '')
    }

    const docsCol = app.findCollectionByNameOrId('customer_documents')
    const custCol = app.findCollectionByNameOrId('customers')

    // =========================================================================
    // PARTE 1: MEC LAN INDUSTRIA E COMERCIO LTDA EPP
    // CNPJ: 62538228000197, Email: nfe@meclan.com.br
    // =========================================================================
    const meclanCnpj = '62538228000197'
    const meclanEmail = 'nfe@meclan.com.br'
    const meclanOfficialName = 'MEC LAN INDUSTRIA E COMERCIO LTDA EPP'

    // Dedupe: verificar se já existe fornecedor com este CNPJ ou com este nome/telefone
    let meclanRecord = null
    const existingMeclanByCnpj = app.findRecordsByFilter(
      'customers',
      'cnpj = {:cnpj} && deleted = false',
      '-created',
      1,
      0,
      { cnpj: meclanCnpj },
    )
    if (existingMeclanByCnpj && existingMeclanByCnpj.length > 0) {
      meclanRecord = existingMeclanByCnpj[0]
    } else {
      // Buscar contato de WhatsApp existente (id bwd7wotwwizccnn ou nome ~ Mec Lan)
      const existingMeclanContact = app.findRecordsByFilter(
        'customers',
        '(id = "bwd7wotwwizccnn" || name ~ "Mec Lan" || name ~ "MEC LAN") && deleted = false',
        '-created',
        1,
        0,
      )
      if (existingMeclanContact && existingMeclanContact.length > 0) {
        meclanRecord = existingMeclanContact[0]
      }
    }

    if (meclanRecord) {
      // Atualizar o contato existente para FORNECEDOR PJ com CNPJ e email vinculados
      meclanRecord.set('cnpj', meclanCnpj)
      meclanRecord.set('company', meclanOfficialName)
      if (!meclanRecord.getString('email')) {
        meclanRecord.set('email', meclanEmail)
      }
      meclanRecord.set('type', 'PJ')
      meclanRecord.set('customer_type', 'Fornecedor')
      meclanRecord.set('roles', ['fornecedor'])
      // Preservar telefone original de WhatsApp (5511940079148)
      if (!meclanRecord.getString('contact_name')) {
        meclanRecord.set('contact_name', 'Mec Lan')
      }
      meclanRecord.set('name', meclanOfficialName)
      app.save(meclanRecord)

      // Vincular em customer_documents se não existir
      const existingDoc = app.findRecordsByFilter(
        'customer_documents',
        `customer = "${meclanRecord.id}" && document_number = "${meclanCnpj}"`,
        '',
        1,
        0,
      )
      if (!existingDoc || existingDoc.length === 0) {
        const docRec = new Record(docsCol)
        docRec.set('customer', meclanRecord.id)
        docRec.set('document_type', 'CNPJ')
        docRec.set('document_number', meclanCnpj)
        docRec.set('root_cnpj', meclanCnpj.slice(0, 8))
        docRec.set('label', 'Matriz/Unidade')
        docRec.set('is_primary', true)
        app.save(docRec)
      }
    }

    // =========================================================================
    // PARTE 2: OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA
    // CNPJ: 59417469000173, Email: rpaimportadora@gmail.com
    // =========================================================================
    const oxilapaCnpj = '59417469000173'
    const oxilapaEmail = 'rpaimportadora@gmail.com'
    const oxilapaOfficialName = 'OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA'

    let oxilapaRecord = null
    const existingOxilapaByCnpj = app.findRecordsByFilter(
      'customers',
      'cnpj = {:cnpj} && deleted = false',
      '-created',
      1,
      0,
      { cnpj: oxilapaCnpj },
    )
    if (existingOxilapaByCnpj && existingOxilapaByCnpj.length > 0) {
      oxilapaRecord = existingOxilapaByCnpj[0]
    } else {
      // Buscar contato de WhatsApp existente (id klma9h4msc1nsw3 ou nome ~ Oxilapa)
      const existingOxilapaContact = app.findRecordsByFilter(
        'customers',
        '(id = "klma9h4msc1nsw3" || name ~ "Oxilapa" || name ~ "OXILAPA") && deleted = false',
        '-created',
        1,
        0,
      )
      if (existingOxilapaContact && existingOxilapaContact.length > 0) {
        oxilapaRecord = existingOxilapaContact[0]
      }
    }

    if (oxilapaRecord) {
      // Atualizar o contato existente para FORNECEDOR PJ com CNPJ e email vinculados
      oxilapaRecord.set('cnpj', oxilapaCnpj)
      oxilapaRecord.set('company', oxilapaOfficialName)
      if (!oxilapaRecord.getString('email')) {
        oxilapaRecord.set('email', oxilapaEmail)
      }
      oxilapaRecord.set('type', 'PJ')
      oxilapaRecord.set('customer_type', 'Fornecedor')
      oxilapaRecord.set('roles', ['fornecedor'])
      // Preservar telefone original de WhatsApp (5511992321490)
      if (!oxilapaRecord.getString('contact_name')) {
        oxilapaRecord.set('contact_name', 'Oxilapa')
      }
      oxilapaRecord.set('name', oxilapaOfficialName)
      app.save(oxilapaRecord)

      // Vincular em customer_documents se não existir
      const existingDoc = app.findRecordsByFilter(
        'customer_documents',
        `customer = "${oxilapaRecord.id}" && document_number = "${oxilapaCnpj}"`,
        '',
        1,
        0,
      )
      if (!existingDoc || existingDoc.length === 0) {
        const docRec = new Record(docsCol)
        docRec.set('customer', oxilapaRecord.id)
        docRec.set('document_type', 'CNPJ')
        docRec.set('document_number', oxilapaCnpj)
        docRec.set('root_cnpj', oxilapaCnpj.slice(0, 8))
        docRec.set('label', 'Matriz/Unidade')
        docRec.set('is_primary', true)
        app.save(docRec)
      }
    }

    // =========================================================================
    // PARTE 3: JAHU BORRACHAS — ENTIDADE E FILIAIS
    // Entidade principal: id ukuwsuetw0d3p2m (JAHU BORRACHAS E AUTOPECAS LTDA)
    // Documentos da entidade:
    //   - Matriz: 61136701000147 (já em customer_documents via 0114)
    //   - Filial 1: 61136701000372 (já em customer_documents via 0115)
    //   - Filial 2: 61136701000732 (filial das 7 notas da revisão: 500503..506904) -> vincular!
    // =========================================================================
    const jahuRecords = app.findRecordsByFilter(
      'customers',
      'id = "ukuwsuetw0d3p2m" || cnpj = "61136701000147" || (name ~ "JAHU BORRACHAS" && type = "PJ")',
      '-created',
      1,
      0,
    )

    if (jahuRecords && jahuRecords.length > 0) {
      const jahuEntity = jahuRecords[0]
      const jahuEntityId = jahuEntity.id

      // Garantir documento da filial 61136701000732 em customer_documents
      const jahuBranch732 = '61136701000732'
      const existingBranch732 = app.findRecordsByFilter(
        'customer_documents',
        `customer = "${jahuEntityId}" && document_number = "${jahuBranch732}"`,
        '',
        1,
        0,
      )
      if (!existingBranch732 || existingBranch732.length === 0) {
        const branchRec = new Record(docsCol)
        branchRec.set('customer', jahuEntityId)
        branchRec.set('document_type', 'CNPJ')
        branchRec.set('document_number', jahuBranch732)
        branchRec.set('root_cnpj', '61136701')
        branchRec.set('label', 'Unidade Filial (61.136.701/0007-32)')
        branchRec.set('is_primary', false)
        app.save(branchRec)
      }

      // =======================================================================
      // PARTE 4: RECLASSIFICAR PESSOAS / CONTATOS DA JAHU
      // "Jahu Fixo" (id t3r8ibc2a0sq9g2), "Elenice Jahu" (id 8sa9py6tke9s5cw), "Jahu Rogerio" (id 777uqab7ufp74h5)
      // Viram contatos VINCULADOS à entidade JAHU BORRACHAS E AUTOPECAS LTDA
      // (campo company = JAHU BORRACHAS E AUTOPECAS LTDA, customer_type/roles = fornecedor)
      // Mantendo telefone deles como contato da empresa. Sem fundir, sem apagar!
      // =======================================================================
      const jahuPersonsFilter =
        'id = "t3r8ibc2a0sq9g2" || id = "8sa9py6tke9s5cw" || id = "777uqab7ufp74h5" || name ~ "Jahu Fixo" || name ~ "Elenice Jahu" || name ~ "Jahu Rogerio"'
      const jahuPersons = app.findRecordsByFilter('customers', jahuPersonsFilter, 'created', 10, 0)

      for (let p = 0; p < jahuPersons.length; p++) {
        const person = jahuPersons[p]
        // Se for a própria entidade jurídica, não mexer
        if (person.id === jahuEntityId) continue

        person.set('company', 'JAHU BORRACHAS E AUTOPECAS LTDA')
        person.set('customer_type', 'Fornecedor')
        person.set('roles', ['fornecedor'])
        person.set('pipeline_status', 'fornecedores')

        // Assegurar contact_name preenchido com o nome da pessoa/ramal
        if (!person.getString('contact_name')) {
          person.set('contact_name', person.getString('name'))
        }

        const currentNotes = person.getString('notes') || ''
        const linkNote =
          'Contato vinculado à entidade JAHU BORRACHAS E AUTOPECAS LTDA (id: ' + jahuEntityId + ')'
        if (currentNotes.indexOf(jahuEntityId) === -1) {
          person.set('notes', currentNotes ? currentNotes + ' | ' + linkNote : linkNote)
        }

        app.save(person)
      }
    }
  },
  (app) => {
    // Reversão segura
  },
)
