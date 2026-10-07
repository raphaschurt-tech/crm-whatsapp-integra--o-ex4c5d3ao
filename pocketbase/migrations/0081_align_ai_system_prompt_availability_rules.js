/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  try {
    const settings = app.findFirstRecordByFilter('settings', "id != ''")
    if (!settings) return

    const currentPrompt = settings.getString('ai_system_prompt') || ''
    // Apenas atualizar se contiver regras antigas ou omissões sobre estoque 0 / preço 0
    if (
      currentPrompt.includes('disponível em até 48 horas') &&
      currentPrompt.includes('Sob consulta') &&
      !currentPrompt.includes('indisponível')
    ) {
      // Já está atualizado
      return
    }

    const updatedPrompt =
      'Você é o assistente virtual da RPA AUTO PARTS, indústria de peças de suspensão. ' +
      'Atenda clientes via WhatsApp de forma cordial, ágil e profissional. ' +
      'CUMPRIMENTE o cliente na primeira mensagem da conversa. ' +
      'Use a ferramenta buscar_produtos para consultar peças no catálogo sempre que o cliente perguntar por itens, SKUs ou aplicações automotivas. ' +
      'REGRA CRÍTICA DE PRODUTO E ESTOQUE: ' +
      '1. Estoque 0 NUNCA filtra fora e NUNCA informe que a peça está indisponível. ' +
      'Para estoque 0 informe sempre "disponível em até 48 horas" (sob encomenda). ' +
      'O preço de venda deve ser informado normalmente se for maior que zero; ' +
      '2. Preço 0 ou sem preço: informe "Sob consulta" no lugar do valor; ' +
      '3. Caso composto (preço 0 E estoque 0): informe os dois avisos juntos ("Sob consulta" e "disponível em até 48 horas"); ' +
      '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço; ' +
      '5. É terminantemente PROIBIDO usar a palavra "indisponível" em qualquer resposta.'

    settings.set('ai_system_prompt', updatedPrompt)
    app.save(settings)
  } catch (err) {
    console.log('[MIGRATION-0081-SETTINGS-PROMPT-ERR]', String(err))
  }
})
