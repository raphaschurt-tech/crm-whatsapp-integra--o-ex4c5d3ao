/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Criar a coleção bank_accounts se não existir
    let bankAccountsCol
    try {
      bankAccountsCol = app.findCollectionByNameOrId('bank_accounts')
    } catch {
      bankAccountsCol = null
    }

    if (!bankAccountsCol) {
      // Resolver collectionId de customers para o vínculo opcional com entidade/filial
      let customersColId = ''
      try {
        customersColId = app.findCollectionByNameOrId('customers').id
      } catch (err) {
        console.log('[MIGRATION-0120-WARN] Coleção customers não encontrada:', String(err))
      }

      const fields = [
        { name: 'nickname', type: 'text', required: true },
        { name: 'bank_code', type: 'text', required: true },
        { name: 'bank_name', type: 'text', required: true },
        { name: 'agency', type: 'text', required: true },
        { name: 'account_number', type: 'text', required: true },
        {
          name: 'account_type',
          type: 'select',
          required: true,
          values: ['corrente', 'poupanca', 'investimento', 'caixa'],
          maxSelect: 1,
        },
        { name: 'entity_name', type: 'text' },
        { name: 'initial_balance', type: 'number' },
        { name: 'initial_balance_date', type: 'date' },
        { name: 'is_active', type: 'bool' },
        { name: 'notes', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ]

      if (customersColId) {
        fields.splice(7, 0, {
          name: 'customer_entity',
          type: 'relation',
          collectionId: customersColId,
          cascadeDelete: false,
          maxSelect: 1,
        })
      }

      bankAccountsCol = new Collection({
        name: 'bank_accounts',
        type: 'base',
        listRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        viewRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        createRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        updateRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        deleteRule: "@request.auth.id != '' && @request.auth.role = 'admin'",
        fields: fields,
        indexes: [],
      })

      app.save(bankAccountsCol)
      console.log('[MIGRATION-0120] Coleção bank_accounts criada com sucesso.')
    } else {
      console.log('[MIGRATION-0120] Coleção bank_accounts já existe.')
    }

    const bankAccountsColId = app.findCollectionByNameOrId('bank_accounts').id

    // 2. Adicionar coluna nullable bank_account_id em accounts_payable (sem alterar registros existentes)
    try {
      const apCol = app.findCollectionByNameOrId('accounts_payable')
      if (!apCol.fields.getByName('bank_account_id')) {
        apCol.fields.add(
          new RelationField({
            name: 'bank_account_id',
            collectionId: bankAccountsColId,
            cascadeDelete: false,
            maxSelect: 1,
            required: false,
          }),
        )
        app.save(apCol)
        console.log('[MIGRATION-0120] Campo bank_account_id adicionado em accounts_payable.')
      } else {
        console.log('[MIGRATION-0120] Campo bank_account_id já existe em accounts_payable.')
      }
    } catch (err) {
      console.log('[MIGRATION-0120-ERROR] Erro ao alterar accounts_payable:', String(err))
      throw err
    }

    // 3. Adicionar coluna nullable bank_account_id em accounts_receivable (sem alterar registros existentes)
    try {
      const arCol = app.findCollectionByNameOrId('accounts_receivable')
      if (!arCol.fields.getByName('bank_account_id')) {
        arCol.fields.add(
          new RelationField({
            name: 'bank_account_id',
            collectionId: bankAccountsColId,
            cascadeDelete: false,
            maxSelect: 1,
            required: false,
          }),
        )
        app.save(arCol)
        console.log('[MIGRATION-0120] Campo bank_account_id adicionado em accounts_receivable.')
      } else {
        console.log('[MIGRATION-0120] Campo bank_account_id já existe em accounts_receivable.')
      }
    } catch (err) {
      console.log('[MIGRATION-0120-ERROR] Erro ao alterar accounts_receivable:', String(err))
      throw err
    }
  },
  (app) => {
    // Reverter adições
    try {
      const apCol = app.findCollectionByNameOrId('accounts_payable')
      if (apCol.fields.getByName('bank_account_id')) {
        apCol.fields.removeByName('bank_account_id')
        app.save(apCol)
      }
    } catch (_) {}

    try {
      const arCol = app.findCollectionByNameOrId('accounts_receivable')
      if (arCol.fields.getByName('bank_account_id')) {
        arCol.fields.removeByName('bank_account_id')
        app.save(arCol)
      }
    } catch (_) {}

    try {
      const bankAccountsCol = app.findCollectionByNameOrId('bank_accounts')
      app.delete(bankAccountsCol)
    } catch (_) {}
  },
)
