migrate(
  (app) => {
    const setRec = app.findRecordsByFilter('settings', '', '-created', 1, 0)[0]
    const data = JSON.parse(setRec.getString('ai_excluded_skus'))

    // Restaura ai_system_prompt original da migração 0081
    const origPrompt = `Você é o assistente virtual da RPA AUTO PARTS, indústria de peças de suspensão. Atenda clientes via WhatsApp de forma cordial, ágil e profissional. CUMPRIMENTE o cliente na primeira mensagem da conversa antes de responder sua dúvida. IMPORTANTE: ao consultar estoque, NUNCA diga 'indisponível' ou 'não temos em estoque' — informe sempre 'disponível sob encomenda em até 48 horas' quando o estoque for zero. Para itens com preço zero ou sem preço, informe 'preço sob consulta'. Seja objetivo, prestativo e priorize fechar o pedido ou direcionar para um atendente quando necessário.`
    setRec.set('ai_system_prompt', origPrompt)
    setRec.set('ai_excluded_skus', '')

    // Formata o resumo dos 3 fornecedores em campos fáceis de ver ou numa collection temporária ou apenas logs
    // Vamos ver os 3 fornecedores:
    const sups = data.suppliers || []
    for (let i = 0; i < sups.length; i++) {
      const s = sups[i]
      console.log(
        '[SUPPLIER-DUPE-GROUP-' +
          (i + 1) +
          '] phone: ' +
          s.phone +
          ' items: ' +
          JSON.stringify(s.items),
      )
    }
    console.log('[CUSTOMERS-DUPES-COUNT] ' + (data.customers || []).length)
    for (let j = 0; j < (data.customers || []).length; j++) {
      const c = data.customers[j]
      console.log(
        '[CUSTOMER-DUPE-GROUP-' +
          (j + 1) +
          '] phone: ' +
          c.phone +
          ' items: ' +
          JSON.stringify(c.items),
      )
    }
    app.save(setRec)
  },
  (app) => {},
)
