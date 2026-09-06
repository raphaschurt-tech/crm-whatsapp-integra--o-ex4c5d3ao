migrate(
  (app) => {
    // 1. Limpar quotes vinculados aos clientes fantasma de LID (ex: 62066706665648 e 80831351640161)
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM payments WHERE quote IN (
          SELECT id FROM quotes WHERE customer IN (
            SELECT id FROM customers WHERE notes LIKE '%LID original%' OR (LENGTH(name) >= 14 AND name GLOB '[0-9]*')
          )
        )
      `)
        .execute()
    } catch (e1) {
      console.log('Erro ao remover pagamentos de clientes LID:', e1)
    }

    try {
      app
        .db()
        .newQuery(`
        DELETE FROM quote_items WHERE quote IN (
          SELECT id FROM quotes WHERE customer IN (
            SELECT id FROM customers WHERE notes LIKE '%LID original%' OR (LENGTH(name) >= 14 AND name GLOB '[0-9]*')
          )
        )
      `)
        .execute()
    } catch (e2) {
      console.log('Erro ao remover itens de orçamentos de clientes LID:', e2)
    }

    try {
      app
        .db()
        .newQuery(`
        DELETE FROM quotes WHERE customer IN (
          SELECT id FROM customers WHERE notes LIKE '%LID original%' OR (LENGTH(name) >= 14 AND name GLOB '[0-9]*')
        )
      `)
        .execute()
    } catch (e3) {
      console.log('Erro ao remover orçamentos de clientes LID:', e3)
    }

    // 2. Limpar mensagens de webhook_received associadas a esses LIDs
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM webhook_received 
        WHERE phone LIKE '%62066706665648%' 
           OR phone LIKE '%80831351640161%'
           OR chat LIKE '%62066706665648%' 
           OR chat LIKE '%80831351640161%'
           OR text LIKE '%62066706665648%'
           OR text LIKE '%80831351640161%'
      `)
        .execute()
    } catch (e4) {
      console.log('Erro ao remover webhooks de clientes LID:', e4)
    }

    // 3. Limpar os clientes fantasma LID da coleção customers
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM customers 
        WHERE notes LIKE '%LID original%' 
           OR (LENGTH(name) >= 14 AND name GLOB '[0-9]*')
      `)
        .execute()
    } catch (e5) {
      console.log('Erro ao remover clientes fantasma LID:', e5)
    }
  },
  (app) => {
    // Reversão no-op pois exclusão de dados fantasmas/órfãos não deve ser restaurada
  },
)
