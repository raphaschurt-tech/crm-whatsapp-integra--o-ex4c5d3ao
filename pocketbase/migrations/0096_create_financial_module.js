migrate(
  (app) => {
    const adminRule = "@request.auth.id != '' && @request.auth.role = 'admin'"
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const customersCol = app.findCollectionByNameOrId('customers')

    // 1. financial_categories
    let categoriesCol
    try {
      categoriesCol = app.findCollectionByNameOrId('financial_categories')
    } catch (_) {
      categoriesCol = new Collection({
        name: 'financial_categories',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'name', type: 'text', required: true },
          {
            name: 'type',
            type: 'select',
            required: true,
            values: ['despesa', 'receita'],
            maxSelect: 1,
          },
          { name: 'description', type: 'text' },
          { name: 'color', type: 'text' },
          { name: 'is_active', type: 'bool' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_fin_cat_name_type ON financial_categories (name, type)'],
      })
      app.save(categoriesCol)
    }

    // 2. financial_recurring_templates
    let recurringCol
    try {
      recurringCol = app.findCollectionByNameOrId('financial_recurring_templates')
    } catch (_) {
      recurringCol = new Collection({
        name: 'financial_recurring_templates',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'description', type: 'text', required: true },
          {
            name: 'category',
            type: 'relation',
            collectionId: categoriesCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'value_type',
            type: 'select',
            required: true,
            values: ['fixo', 'variavel'],
            maxSelect: 1,
          },
          { name: 'fixed_amount', type: 'number', min: 0 },
          { name: 'due_day', type: 'number', required: true, min: 1, max: 31, onlyInt: true },
          {
            name: 'default_payment_method',
            type: 'select',
            required: true,
            values: ['PIX', 'boleto', 'transferencia', 'dinheiro', 'cheque', 'cartao', 'outros'],
            maxSelect: 1,
          },
          {
            name: 'supplier',
            type: 'relation',
            collectionId: customersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'supplier_name', type: 'text' },
          { name: 'notes', type: 'text' },
          { name: 'is_active', type: 'bool' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_fin_rec_active ON financial_recurring_templates (is_active)'],
      })
      app.save(recurringCol)
    }

    // 3. nfe_processed (NF-e processadas pelo pipeline)
    let nfeProcessedCol
    try {
      nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
    } catch (_) {
      nfeProcessedCol = new Collection({
        name: 'nfe_processed',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'access_key', type: 'text', required: true },
          { name: 'nfe_number', type: 'text' },
          { name: 'series', type: 'text' },
          { name: 'issue_date', type: 'date' },
          { name: 'supplier_cnpj', type: 'text' },
          { name: 'supplier_name', type: 'text' },
          {
            name: 'supplier',
            type: 'relation',
            collectionId: customersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'total_amount', type: 'number', min: 0 },
          { name: 'items_count', type: 'number', min: 0, onlyInt: true },
          { name: 'matched_items_count', type: 'number', min: 0, onlyInt: true },
          { name: 'pending_items_count', type: 'number', min: 0, onlyInt: true },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['processada', 'pendente_reconciliacao', 'erro', 'cancelada'],
            maxSelect: 1,
          },
          { name: 'xml_payload', type: 'text' },
          { name: 'raw_items', type: 'json' },
          { name: 'notes', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_fin_nfe_access_key ON nfe_processed (access_key)',
          'CREATE INDEX idx_fin_nfe_status ON nfe_processed (status)',
          'CREATE INDEX idx_fin_nfe_supplier_cnpj ON nfe_processed (supplier_cnpj)',
        ],
      })
      app.save(nfeProcessedCol)
    }

    // 4. nfe_price_queue (fila de preços / exceções)
    let nfePriceQueueCol
    try {
      nfePriceQueueCol = app.findCollectionByNameOrId('nfe_price_queue')
    } catch (_) {
      nfePriceQueueCol = new Collection({
        name: 'nfe_price_queue',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          {
            name: 'nfe',
            type: 'relation',
            collectionId: nfeProcessedCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'access_key', type: 'text' },
          { name: 'sku', type: 'text' },
          { name: 'supplier_code', type: 'text' },
          { name: 'description', type: 'text', required: true },
          { name: 'ncm', type: 'text' },
          { name: 'quantity', type: 'number', min: 0 },
          { name: 'unit_cost', type: 'number', min: 0 },
          { name: 'suggested_sell_price', type: 'number', min: 0 },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['pendente', 'aplicado', 'ignorado'],
            maxSelect: 1,
          },
          { name: 'resolution_notes', type: 'text' },
          {
            name: 'resolved_by',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_fin_queue_status ON nfe_price_queue (status)',
          'CREATE INDEX idx_fin_queue_access_key ON nfe_price_queue (access_key)',
        ],
      })
      app.save(nfePriceQueueCol)
    }

    // 5. accounts_payable (Contas a Pagar)
    let payablesCol
    try {
      payablesCol = app.findCollectionByNameOrId('accounts_payable')
    } catch (_) {
      payablesCol = new Collection({
        name: 'accounts_payable',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'description', type: 'text', required: true },
          {
            name: 'category',
            type: 'relation',
            collectionId: categoriesCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'supplier',
            type: 'relation',
            collectionId: customersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'supplier_name', type: 'text' },
          { name: 'amount', type: 'number', required: false, min: 0 },
          { name: 'due_date', type: 'date', required: true },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['pendente', 'pago', 'cancelado'],
            maxSelect: 1,
          },
          {
            name: 'origin',
            type: 'select',
            required: true,
            values: ['manual', 'nfe', 'recorrente'],
            maxSelect: 1,
          },
          { name: 'nfe_access_key', type: 'text' },
          {
            name: 'nfe_record',
            type: 'relation',
            collectionId: nfeProcessedCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'recurring_template',
            type: 'relation',
            collectionId: recurringCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'recurring_competence', type: 'text' }, // S5/S6: YYYY-MM
          { name: 'installment_number', type: 'number', onlyInt: true, min: 1 },
          { name: 'total_installments', type: 'number', onlyInt: true, min: 1 },
          { name: 'paid_at', type: 'date' },
          {
            name: 'payment_method',
            type: 'select',
            values: ['PIX', 'boleto', 'transferencia', 'dinheiro', 'cheque', 'cartao', 'outros'],
            maxSelect: 1,
          },
          { name: 'notes', type: 'text' },
          { name: 'attachment', type: 'file', maxSelect: 1, maxSize: 10485760 },
          {
            name: 'created_by',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_fin_ap_status ON accounts_payable (status)',
          'CREATE INDEX idx_fin_ap_due_date ON accounts_payable (due_date)',
          'CREATE INDEX idx_fin_ap_origin ON accounts_payable (origin)',
          'CREATE INDEX idx_fin_ap_nfe_key ON accounts_payable (nfe_access_key)',
          "CREATE UNIQUE INDEX idx_fin_ap_rec_dedupe ON accounts_payable (recurring_template, recurring_competence) WHERE recurring_template IS NOT NULL AND recurring_template != '' AND recurring_competence IS NOT NULL AND recurring_competence != ''",
        ],
      })
      app.save(payablesCol)
    }

    // 6. accounts_receivable (Contas a Receber)
    let receivablesCol
    try {
      receivablesCol = app.findCollectionByNameOrId('accounts_receivable')
    } catch (_) {
      receivablesCol = new Collection({
        name: 'accounts_receivable',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'description', type: 'text', required: true },
          {
            name: 'category',
            type: 'relation',
            collectionId: categoriesCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'customer',
            type: 'relation',
            collectionId: customersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'customer_name', type: 'text' },
          {
            name: 'quote',
            type: 'relation',
            collectionId: app.findCollectionByNameOrId('quotes').id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'amount', type: 'number', required: false, min: 0 },
          { name: 'due_date', type: 'date', required: true },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['pendente', 'pago', 'cancelado'],
            maxSelect: 1,
          },
          {
            name: 'origin',
            type: 'select',
            required: true,
            values: ['manual', 'orcamento', 'recorrente'],
            maxSelect: 1,
          },
          { name: 'paid_at', type: 'date' },
          {
            name: 'payment_method',
            type: 'select',
            values: ['PIX', 'boleto', 'transferencia', 'dinheiro', 'cheque', 'cartao', 'outros'],
            maxSelect: 1,
          },
          { name: 'notes', type: 'text' },
          { name: 'attachment', type: 'file', maxSelect: 1, maxSize: 10485760 },
          {
            name: 'created_by',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_fin_ar_status ON accounts_receivable (status)',
          'CREATE INDEX idx_fin_ar_due_date ON accounts_receivable (due_date)',
          'CREATE INDEX idx_fin_ar_customer ON accounts_receivable (customer)',
        ],
      })
      app.save(receivablesCol)
    }

    // 7. Seed de categorias padrão (despesas e receitas)
    const seedCategories = [
      {
        name: 'Impostos e Tributos (DAS)',
        type: 'despesa',
        color: '#ef4444',
        description: 'DAS Simples Nacional, tributos federais e estaduais',
      },
      {
        name: 'Aluguel e Condomínio',
        type: 'despesa',
        color: '#f97316',
        description: 'Locação predial e despesas prediais',
      },
      {
        name: 'Energia Elétrica',
        type: 'despesa',
        color: '#eab308',
        description: 'Conta de luz da loja e oficina',
      },
      {
        name: 'Água e Saneamento',
        type: 'despesa',
        color: '#06b6d4',
        description: 'Conta de água',
      },
      {
        name: 'Internet e Telefonia',
        type: 'despesa',
        color: '#3b82f6',
        description: 'Link de internet fibra e telefonia',
      },
      {
        name: 'Pró-Labore e Salários',
        type: 'despesa',
        color: '#8b5cf6',
        description: 'Retiradas de sócios e remuneração da equipe',
      },
      {
        name: 'Fornecedores de Peças (NF-e)',
        type: 'despesa',
        color: '#64748b',
        description: 'Compra de mercadorias para revenda e insumos',
      },
      {
        name: 'Serviços de Terceiros e Manutenção',
        type: 'despesa',
        color: '#a855f7',
        description: 'Contabilidade, consultoria, reparos em equipamentos',
      },
      {
        name: 'Venda de Peças',
        type: 'receita',
        color: '#10b981',
        description: 'Faturamento de vendas de autopeças balcão e online',
      },
      {
        name: 'Prestação de Serviços',
        type: 'receita',
        color: '#059669',
        description: 'Serviços mecânicos e usinagem',
      },
      {
        name: 'Outras Receitas',
        type: 'receita',
        color: '#14b8a6',
        description: 'Rendimentos, devoluções e receitas eventuais',
      },
    ]

    const catMap = {}
    for (const cat of seedCategories) {
      try {
        const existing = app.findFirstRecordByFilter(
          'financial_categories',
          `name = "${cat.name}" && type = "${cat.type}"`,
        )
        catMap[cat.name] = existing.id
      } catch (_) {
        const record = new Record(categoriesCol)
        record.set('name', cat.name)
        record.set('type', cat.type)
        record.set('color', cat.color)
        record.set('description', cat.description)
        record.set('is_active', true)
        app.save(record)
        catMap[cat.name] = record.id
      }
    }

    // 8. Seed de modelos recorrentes básicos (DAS, aluguel, luz, água, internet, pró-labore)
    const seedRecurring = [
      {
        description: 'DAS - Simples Nacional',
        catName: 'Impostos e Tributos (DAS)',
        valueType: 'variavel',
        fixedAmount: 0,
        dueDay: 20,
        method: 'boleto',
        notes: 'Guia DAS apurada mensalmente pela contabilidade',
      },
      {
        description: 'Aluguel do Imóvel',
        catName: 'Aluguel e Condomínio',
        valueType: 'fixo',
        fixedAmount: 3500,
        dueDay: 10,
        method: 'transferencia',
        notes: 'Locação do galpão comercial RPA Auto Peças',
      },
      {
        description: 'Energia Elétrica (Enel)',
        catName: 'Energia Elétrica',
        valueType: 'variavel',
        fixedAmount: 0,
        dueDay: 15,
        method: 'boleto',
        notes: 'Fatura de energia elétrica',
      },
      {
        description: 'Água e Saneamento (Sabesp)',
        catName: 'Água e Saneamento',
        valueType: 'variavel',
        fixedAmount: 0,
        dueDay: 18,
        method: 'boleto',
        notes: 'Fatura de consumo de água',
      },
      {
        description: 'Internet Fibra Óptica',
        catName: 'Internet e Telefonia',
        valueType: 'fixo',
        fixedAmount: 149.9,
        dueDay: 5,
        method: 'boleto',
        notes: 'Link dedicado para o CRM e WhatsApp',
      },
      {
        description: 'Pró-Labore - Raphael',
        catName: 'Pró-Labore e Salários',
        valueType: 'fixo',
        fixedAmount: 5000,
        dueDay: 5,
        method: 'PIX',
        notes: 'Retirada mensal pró-labore sócio administrador',
      },
    ]

    for (const rec of seedRecurring) {
      try {
        app.findFirstRecordByFilter(
          'financial_recurring_templates',
          `description = "${rec.description}"`,
        )
      } catch (_) {
        const record = new Record(recurringCol)
        record.set('description', rec.description)
        if (catMap[rec.catName]) {
          record.set('category', catMap[rec.catName])
        }
        record.set('value_type', rec.valueType)
        record.set('fixed_amount', rec.fixedAmount)
        record.set('due_day', rec.dueDay)
        record.set('default_payment_method', rec.method)
        record.set('notes', rec.notes)
        record.set('is_active', true)
        app.save(record)
      }
    }
  },
  (app) => {
    const list = [
      'accounts_payable',
      'accounts_receivable',
      'nfe_price_queue',
      'nfe_processed',
      'financial_recurring_templates',
      'financial_categories',
    ]
    for (const name of list) {
      try {
        const col = app.findCollectionByNameOrId(name)
        app.delete(col)
      } catch (_) {}
    }
  },
)
