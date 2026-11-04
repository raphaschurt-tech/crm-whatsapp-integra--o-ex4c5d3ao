/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Resolver collectionId de bank_accounts, accounts_payable, accounts_receivable, users
    const bankAccountsColId = app.findCollectionByNameOrId('bank_accounts').id
    const payablesColId = app.findCollectionByNameOrId('accounts_payable').id
    const receivablesColId = app.findCollectionByNameOrId('accounts_receivable').id
    const usersColId = '_pb_users_auth_'

    // 2. Criar coleção bank_statement_lines
    let statementLinesCol
    try {
      statementLinesCol = app.findCollectionByNameOrId('bank_statement_lines')
    } catch {
      statementLinesCol = null
    }

    if (!statementLinesCol) {
      statementLinesCol = new Collection({
        name: 'bank_statement_lines',
        type: 'base',
        listRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        viewRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        createRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        updateRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        fields: [
          {
            name: 'bank_account',
            type: 'relation',
            required: true,
            collectionId: bankAccountsColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          { name: 'date', type: 'date', required: true },
          { name: 'amount', type: 'number', required: true },
          {
            name: 'type',
            type: 'select',
            required: true,
            values: ['credito', 'debito'],
            maxSelect: 1,
          },
          { name: 'description', type: 'text', required: true },
          { name: 'fitid', type: 'text' },
          { name: 'check_number', type: 'text' },
          { name: 'memo', type: 'text' },
          { name: 'dedupe_hash', type: 'text', required: true },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['pendente', 'conciliado', 'ignorado'],
            maxSelect: 1,
          },
          {
            name: 'matched_type',
            type: 'select',
            values: ['payable', 'receivable', 'avulso_despesa', 'avulso_receita', 'ignorado'],
            maxSelect: 1,
          },
          {
            name: 'matched_payable',
            type: 'relation',
            collectionId: payablesColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'matched_receivable',
            type: 'relation',
            collectionId: receivablesColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          { name: 'reconciled_at', type: 'date' },
          {
            name: 'reconciled_by',
            type: 'relation',
            collectionId: usersColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          { name: 'notes', type: 'text' },
          { name: 'import_batch_id', type: 'text' },
          { name: 'source_file_name', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_stmt_lines_account_status ON bank_statement_lines (bank_account, status)',
          'CREATE INDEX idx_stmt_lines_date ON bank_statement_lines (date)',
          'CREATE UNIQUE INDEX idx_stmt_lines_dedupe ON bank_statement_lines (bank_account, dedupe_hash)',
        ],
      })
      app.save(statementLinesCol)
      console.log('[MIGRATION-0135] Coleção bank_statement_lines criada com sucesso.')
    }

    // 3. Criar coleção bank_reconciliations (fechamento por conta/competência)
    let reconciliationsCol
    try {
      reconciliationsCol = app.findCollectionByNameOrId('bank_reconciliations')
    } catch {
      reconciliationsCol = null
    }

    if (!reconciliationsCol) {
      reconciliationsCol = new Collection({
        name: 'bank_reconciliations',
        type: 'base',
        listRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        viewRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        createRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        updateRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        fields: [
          {
            name: 'bank_account',
            type: 'relation',
            required: true,
            collectionId: bankAccountsColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          { name: 'competence', type: 'text', required: true },
          { name: 'statement_closing_balance', type: 'number', required: true },
          { name: 'statement_closing_date', type: 'date' },
          { name: 'crm_calculated_balance', type: 'number', required: true },
          { name: 'difference_amount', type: 'number', required: true },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['conciliado', 'divergente', 'em_aberto'],
            maxSelect: 1,
          },
          { name: 'pending_lines_count', type: 'number' },
          { name: 'closed_at', type: 'date' },
          {
            name: 'closed_by',
            type: 'relation',
            collectionId: usersColId,
            cascadeDelete: false,
            maxSelect: 1,
          },
          { name: 'notes', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_bank_rec_account_comp ON bank_reconciliations (bank_account, competence)',
        ],
      })
      app.save(reconciliationsCol)
      console.log('[MIGRATION-0135] Coleção bank_reconciliations criada com sucesso.')
    }
  },
  (app) => {
    try {
      const recCol = app.findCollectionByNameOrId('bank_reconciliations')
      app.delete(recCol)
    } catch (_) {}

    try {
      const linesCol = app.findCollectionByNameOrId('bank_statement_lines')
      app.delete(linesCol)
    } catch (_) {}
  },
)
