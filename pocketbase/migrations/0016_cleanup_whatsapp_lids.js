migrate(
  (app) => {
    // 1. Atualizar ou remover registros órfãos com @lid ou números >= 14 dígitos em webhook_received
    // Se a mensagem continha o número 11994429335 no texto ou era referente a esse atendimento,
    // ou se é uma mensagem solta sem remetente identificável, limpamos ou normalizamos.

    // Tratar 224429321781298 que é do cliente 5511994429335
    try {
      app
        .db()
        .newQuery(`
        UPDATE webhook_received 
        SET phone = json_object('phone', '5511994429335') 
        WHERE phone LIKE '%224429321781298%'
      `)
        .execute()
    } catch (e1) {
      console.log('Erro ao atualizar 224429321781298:', e1)
    }

    // Para outros LIDs que não têm correspondência de telefone e são apenas logs de "não estamos disponíveis" ou mensagens de teste órfãs,
    // deletar de webhook_received para despoluir o atendimento
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM webhook_received 
        WHERE phone LIKE '%@lid%' 
           OR phone LIKE '%134196773261537%' 
           OR phone LIKE '%109560371093546%'
           OR phone LIKE '%211415906426993%'
           OR phone LIKE '%28995475214350%'
           OR phone LIKE '%185362248929412%'
           OR phone LIKE '%266726260367549%'
           OR phone LIKE '%125507601473786%'
           OR phone LIKE '%39127336673393%'
           OR phone LIKE '%112923280150746%'
           OR phone LIKE '%54370108494079%'
           OR phone LIKE '%101482242244793%'
      `)
        .execute()
    } catch (e2) {
      console.log('Erro ao limpar @lid de webhook_received:', e2)
    }

    // 2. Limpar message_processing caso tenha algum registro com @lid ou número > 13 dígitos
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM message_processing 
        WHERE phone LIKE '%@lid%' 
           OR LENGTH(phone) >= 14
      `)
        .execute()
    } catch (e3) {
      console.log('Erro ao limpar message_processing:', e3)
    }

    // 3. Limpar clientes fantasmas criados com @lid em customers (ex: 62066706665648, 80831351640161)
    // Se houver quotes vinculados a eles, podemos manter os quotes ou apontar para um cliente padrão se necessário,
    // mas vamos verificar e limpar os telefones inválidos em customers
    try {
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET notes = 'LID original: ' || phone,
            phone = ''
        WHERE LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '')) >= 14
           OR phone LIKE '%@lid%'
      `)
        .execute()
    } catch (e4) {
      console.log('Erro ao atualizar customers com LID:', e4)
    }
  },
  (app) => {
    // Reversão no-op pois limpeza de dados espúrios não precisa ser desfeita
  },
)
