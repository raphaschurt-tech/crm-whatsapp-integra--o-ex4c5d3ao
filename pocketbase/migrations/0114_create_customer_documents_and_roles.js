/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Criar collection customer_documents (documentos vinculados a contatos, permitindo N documentos por contato)
    // Sem índices únicos nesta rodada (protocolo anti-duplicidade com duplicados históricos existentes)
    const custCol = app.findCollectionByNameOrId('customers')

    const docCollection = new Collection({
      name: 'customer_documents',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
      fields: [
        {
          name: 'customer',
          type: 'relation',
          required: true,
          collectionId: custCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'document_type',
          type: 'select',
          required: true,
          values: ['CPF', 'CNPJ'],
          maxSelect: 1,
        },
        {
          name: 'document_number',
          type: 'text',
          required: true,
        },
        {
          name: 'root_cnpj',
          type: 'text',
        },
        {
          name: 'label',
          type: 'text',
        },
        {
          name: 'is_primary',
          type: 'bool',
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_cust_docs_customer ON customer_documents (customer)',
        'CREATE INDEX idx_cust_docs_number ON customer_documents (document_number)',
        'CREATE INDEX idx_cust_docs_root ON customer_documents (root_cnpj)',
      ],
    })
    app.save(docCollection)

    // 2. Adicionar campo roles (json ou select multiselect) em customers se não existir
    // Para armazenar papéis unificados: ['cliente'], ['fornecedor'], ['cliente', 'fornecedor']
    if (!custCol.fields.getByName('roles')) {
      custCol.fields.add(new JSONField({ name: 'roles' }))
      app.save(custCol)
    }

    // 3. Backfill de papéis (roles) e documentos existentes para customer_documents
    // - customer_type "Cliente" -> roles: ["cliente"]
    // - customer_type "Fornecedor" -> roles: ["fornecedor"]
    // - customer_type "Ambos" -> roles: ["cliente", "fornecedor"]
    // - Não alterar pipeline_status de dados existentes!
    // - Não fundir ou apagar nenhum registro!
    const createdDocsCol = app.findCollectionByNameOrId('customer_documents')
    const allCustomers = app.findRecordsByFilter('customers', '', 'created', 10000, 0)

    for (let i = 0; i < allCustomers.length; i++) {
      const cust = allCustomers[i]
      const cType = (cust.getString('customer_type') || '').trim().toLowerCase()

      let roles = []
      if (cType === 'fornecedor') {
        roles = ['fornecedor']
      } else if (cType === 'ambos') {
        roles = ['cliente', 'fornecedor']
      } else {
        // Cliente ou vazio
        roles = ['cliente']
      }
      cust.set('roles', roles)
      app.save(cust)

      // Se possui CPF ou CNPJ preenchido, migrar para customer_documents
      const rawCpf = String(cust.getString('cpf') || '').replace(/\D/g, '')
      const rawCnpj = String(cust.getString('cnpj') || '').replace(/\D/g, '')

      if (rawCpf && rawCpf.length === 11) {
        const docRec = new Record(createdDocsCol)
        docRec.set('customer', cust.id)
        docRec.set('document_type', 'CPF')
        docRec.set('document_number', rawCpf)
        docRec.set('label', 'CPF Principal')
        docRec.set('is_primary', true)
        app.save(docRec)
      }

      if (rawCnpj && rawCnpj.length === 14) {
        const docRec = new Record(createdDocsCol)
        docRec.set('customer', cust.id)
        docRec.set('document_type', 'CNPJ')
        docRec.set('document_number', rawCnpj)
        docRec.set('root_cnpj', rawCnpj.slice(0, 8))
        docRec.set('label', 'Matriz/Unidade')
        docRec.set('is_primary', true)
        app.save(docRec)
      }
    }
  },
  (app) => {
    try {
      const docCol = app.findCollectionByNameOrId('customer_documents')
      app.delete(docCol)
    } catch (_) {}

    try {
      const custCol = app.findCollectionByNameOrId('customers')
      const rolesField = custCol.fields.getByName('roles')
      if (rolesField) {
        custCol.fields.removeByName('roles')
        app.save(custCol)
      }
    } catch (_) {}
  },
)
