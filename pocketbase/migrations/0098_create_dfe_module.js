migrate(
  (app) => {
    const adminRule = "@request.auth.id != '' && @request.auth.role = 'admin'"
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // 1. dfe_pointer_state (Estado único do ponteiro NSU DFe e status do worker)
    // Regra D12 + D12-PLUS: só-admin para sessões de usuário
    let pointerCol
    try {
      pointerCol = app.findCollectionByNameOrId('dfe_pointer_state')
    } catch (_) {
      pointerCol = new Collection({
        name: 'dfe_pointer_state',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'ult_nsu', type: 'text', required: true },
          { name: 'max_nsu', type: 'text' },
          { name: 'is_initialized', type: 'bool' }, // false até completar o bootstrap paginado inicial (D2 / CF-2c)
          { name: 'last_poll_at', type: 'text' }, // ISO Brasília
          { name: 'last_success_at', type: 'text' }, // ISO Brasília (CF-1d)
          { name: 'last_error', type: 'text' },
          { name: 'consecutive_failures', type: 'number', min: 0, onlyInt: true },
          { name: 'cert_cnpj', type: 'text' }, // Reportado pelo worker (D7 / D8)
          { name: 'cert_valid_until', type: 'text' }, // Reportado pelo worker (D7 / D9)
          { name: 'cert_days_remaining', type: 'number' },
          { name: 'worker_status', type: 'text' }, // 'online' | 'offline' | 'error' | 'idle'
          { name: 'cstat_last', type: 'text' }, // Ex: '138', '137', '656'
          { name: 'is_running', type: 'bool' }, // Semáforo para evitar dois ciclos paralelos (D10)
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_dfe_pointer_init ON dfe_pointer_state (is_initialized)'],
      })
      app.save(pointerCol)
    }

    // 2. dfe_history (Backlog listado no NSU-START / histórico DFe sem criar lançamentos)
    // D2: chave, emitente, data, valor, NSU, status_resumo ('resumo' | 'completo' | 'ignorado')
    let historyCol
    try {
      historyCol = app.findCollectionByNameOrId('dfe_history')
    } catch (_) {
      historyCol = new Collection({
        name: 'dfe_history',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'access_key', type: 'text', required: true },
          { name: 'nsu', type: 'text', required: true },
          { name: 'schema', type: 'text' }, // Ex: 'resNFe_v1.01.xsd', 'procNFe_v4.00.xsd', 'procEventoNFe_v1.00.xsd'
          { name: 'model', type: 'text' }, // Ex: '55', '65', etc.
          { name: 'emitter_cnpj', type: 'text' },
          { name: 'emitter_name', type: 'text' },
          { name: 'issue_date', type: 'text' },
          { name: 'total_amount', type: 'number', min: 0 },
          { name: 'nfe_number', type: 'text' },
          { name: 'document_type', type: 'text' }, // 'resumo' | 'nfe_completa' | 'evento' | 'outro'
          { name: 'is_backlog', type: 'bool' }, // true se veio no bootstrap zero-impacto (D2)
          { name: 'imported_to_crm', type: 'bool' }, // true se foi processado pelo pipeline normal
          { name: 'raw_xml', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_dfe_hist_key ON dfe_history (access_key)',
          'CREATE INDEX idx_dfe_hist_nsu ON dfe_history (nsu)',
          'CREATE INDEX idx_dfe_hist_backlog ON dfe_history (is_backlog)',
        ],
      })
      app.save(historyCol)
    }

    // 3. dfe_events (Eventos da SEFAZ: cancelamento, CC-e, ciência, etc. - D5)
    let eventsCol
    try {
      eventsCol = app.findCollectionByNameOrId('dfe_events')
    } catch (_) {
      eventsCol = new Collection({
        name: 'dfe_events',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          { name: 'access_key', type: 'text', required: true },
          { name: 'nsu', type: 'text' },
          { name: 'event_type', type: 'text', required: true }, // '110111' (Cancelamento), '110110' (CC-e), etc.
          { name: 'event_desc', type: 'text' },
          { name: 'event_seq', type: 'number', onlyInt: true },
          { name: 'event_date', type: 'text' },
          { name: 'protocol', type: 'text' },
          { name: 'justification', type: 'text' },
          { name: 'correction_text', type: 'text' },
          { name: 'nfe_found_in_crm', type: 'bool' }, // true se nfe_processed correspondente existia
          { name: 'accounts_payable_marked', type: 'bool' }, // true se contas a pagar foi alterado para 'cancelado' (D5)
          { name: 'raw_xml', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_dfe_events_key ON dfe_events (access_key)',
          'CREATE INDEX idx_dfe_events_type ON dfe_events (event_type)',
        ],
      })
      app.save(eventsCol)
    }

    // 4. dfe_command_queue (Fila de Comandos para o Worker - CF-1b, D12-PLUS)
    let commandCol
    try {
      commandCol = app.findCollectionByNameOrId('dfe_command_queue')
    } catch (_) {
      commandCol = new Collection({
        name: 'dfe_command_queue',
        type: 'base',
        listRule: adminRule,
        viewRule: adminRule,
        createRule: adminRule,
        updateRule: adminRule,
        deleteRule: adminRule,
        fields: [
          {
            name: 'command',
            type: 'select',
            required: true,
            values: ['consultar_agora', 'importacao_retroativa', 'reset_ponteiro'],
            maxSelect: 1,
          },
          { name: 'params', type: 'json' }, // Ex: { days: 30 } para importação retroativa
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['pendente', 'em_execucao', 'concluido', 'erro'],
            maxSelect: 1,
          },
          { name: 'result_summary', type: 'text' },
          {
            name: 'created_by',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'executed_at', type: 'text' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_dfe_cmd_status ON dfe_command_queue (status)'],
      })
      app.save(commandCol)
    }

    // 5. Adicionar campos DFe em settings (D7, CF-1c)
    // - dfe_enabled: toggle principal (DESLIGADO por padrão - false)
    // - dfe_poll_interval_hours: intervalo em horas (padrão 1h)
    // - dfe_worker_token: token hash ou segredo do token dedicado DFe gerado pelo admin
    // - dfe_token_active: se o token está válido ou revogado
    // - dfe_retroactive_days_default: padrão para janela retroativa manual (ex: 30)
    const settingsCol = app.findCollectionByNameOrId('settings')
    let settingsUpdated = false
    if (!settingsCol.fields.getByName('dfe_enabled')) {
      settingsCol.fields.add(new BoolField({ name: 'dfe_enabled' }))
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('dfe_poll_interval_hours')) {
      settingsCol.fields.add(
        new NumberField({
          name: 'dfe_poll_interval_hours',
          min: 1,
          onlyInt: true,
        }),
      )
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('dfe_worker_token')) {
      settingsCol.fields.add(new TextField({ name: 'dfe_worker_token' }))
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('dfe_token_active')) {
      settingsCol.fields.add(new BoolField({ name: 'dfe_token_active' }))
      settingsUpdated = true
    }
    if (!settingsCol.fields.getByName('dfe_retroactive_days_default')) {
      settingsCol.fields.add(
        new NumberField({
          name: 'dfe_retroactive_days_default',
          min: 1,
          max: 90,
          onlyInt: true,
        }),
      )
      settingsUpdated = true
    }
    if (settingsUpdated) {
      app.save(settingsCol)
    }

    // 6. Atualizar source_channel em nfe_processed para aceitar 'dfe' (CF-3b)
    const nfeProcessedCol = app.findCollectionByNameOrId('nfe_processed')
    const sourceChannelField = nfeProcessedCol.fields.getByName('source_channel')
    if (sourceChannelField) {
      nfeProcessedCol.fields.removeByName('source_channel')
      nfeProcessedCol.fields.add(
        new SelectField({
          name: 'source_channel',
          values: ['manual_upload', 'whatsapp', 'dfe'],
          maxSelect: 1,
        }),
      )
      app.save(nfeProcessedCol)
    }

    // 7. Seed inicial do registro de dfe_pointer_state se não existir
    try {
      const existingPointer = app.findFirstRecordByFilter('dfe_pointer_state', "id != ''")
    } catch (_) {
      const initPointer = new Record(pointerCol)
      initPointer.set('ult_nsu', '0')
      initPointer.set('max_nsu', '0')
      initPointer.set('is_initialized', false)
      initPointer.set('consecutive_failures', 0)
      initPointer.set('worker_status', 'offline')
      initPointer.set('is_running', false)
      app.save(initPointer)
    }

    // 8. Garantir modelo recorrente no Financeiro: "Renovação do certificado A1" (D9)
    try {
      const recCol = app.findCollectionByNameOrId('financial_recurring_templates')
      try {
        app.findFirstRecordByFilter(
          'financial_recurring_templates',
          "description ~ 'Certificado A1' || description ~ 'Renovação do certificado'",
        )
      } catch (_) {
        // Encontrar categoria de despesas ou serviços
        let catId = ''
        try {
          const cat = app.findFirstRecordByFilter(
            'financial_categories',
            "name ~ 'Serviços' || name ~ 'Impostos' || type = 'despesa'",
          )
          if (cat) catId = cat.id
        } catch (_) {}

        const certRec = new Record(recCol)
        certRec.set('description', 'Renovação do Certificado A1 (Anual)')
        if (catId) certRec.set('category', catId)
        certRec.set('value_type', 'variavel')
        certRec.set('fixed_amount', 0)
        certRec.set('due_day', 10)
        certRec.set('default_payment_method', 'PIX')
        certRec.set(
          'notes',
          'Lembrete anual de renovação do certificado digital A1 da empresa (D9).',
        )
        certRec.set('is_active', true)
        app.save(certRec)
      }
    } catch (recErr) {
      console.log('[MIGRATION-0098-REC-WARN]', String(recErr))
    }
  },
  (app) => {
    const list = ['dfe_command_queue', 'dfe_events', 'dfe_history', 'dfe_pointer_state']
    for (const name of list) {
      try {
        const col = app.findCollectionByNameOrId(name)
        app.delete(col)
      } catch (_) {}
    }
  },
)
