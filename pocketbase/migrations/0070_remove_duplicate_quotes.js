migrate(
  (app) => {
    // Excluir orçamentos duplicados ORC-2026-0019, ORC-2026-0020 e ORC-2026-0021,
    // mantendo apenas ORC-2026-0022 (autorizado explicitamente pelo usuário).
    const duplicateIds = ['exwrkgr6zddiru2', 'sjln5vwtdb51tdc', '6zgdv3w8tthw5fd']
    const duplicateNumbers = ['ORC-2026-0019', 'ORC-2026-0020', 'ORC-2026-0021']

    // 1. Excluir pagamentos órfãos se existirem
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM payments WHERE quote IN ('exwrkgr6zddiru2', 'sjln5vwtdb51tdc', '6zgdv3w8tthw5fd')
      `)
        .execute()
    } catch (e1) {
      console.log('Erro ao remover pagamentos de orçamentos duplicados:', e1)
    }

    // 2. Excluir itens de orçamentos vinculados
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM quote_items WHERE quote IN ('exwrkgr6zddiru2', 'sjln5vwtdb51tdc', '6zgdv3w8tthw5fd')
      `)
        .execute()
    } catch (e2) {
      console.log('Erro ao remover quote_items de orçamentos duplicados:', e2)
    }

    // 3. Excluir os orçamentos duplicados por ID e número
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM quotes 
        WHERE id IN ('exwrkgr6zddiru2', 'sjln5vwtdb51tdc', '6zgdv3w8tthw5fd')
           OR number IN ('ORC-2026-0019', 'ORC-2026-0020', 'ORC-2026-0021')
      `)
        .execute()
    } catch (e3) {
      console.log('Erro ao remover orçamentos duplicados:', e3)
    }

    // Mantemos ORC-2026-0022 intocado com número 0022 e ID dwbs2btd9s1hdhx
    // para total segurança e preservação de integridade.
  },
  (app) => {
    // Reversão no-op: registros duplicados removidos deliberadamente
  },
)
