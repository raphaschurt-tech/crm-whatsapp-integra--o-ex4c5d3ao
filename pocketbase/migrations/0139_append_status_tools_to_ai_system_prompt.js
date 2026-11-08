/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const settingsCol = app.findCollectionByNameOrId('settings')
    if (!settingsCol) return

    const settingsRecords = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
    if (!settingsRecords || settingsRecords.length === 0) return

    const settingsRec = settingsRecords[0]
    const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')

    const SECTION_HEADER = '[FERRAMENTAS DE STATUS, NOTA FISCAL E DANFE]'

    // Idempotência: se já contém o cabeçalho da seção, não duplica
    if (currentPrompt.indexOf(SECTION_HEADER) !== -1) {
      console.log(
        '[MIGRATION-0139] ai_system_prompt já contém a seção de status e DANFE. Nenhuma alteração feita.',
      )
      return
    }

    const appendSection =
      '\n\n' +
      SECTION_HEADER +
      '\n' +
      'Você dispõe de ferramentas para consultar status de pedidos, notas fiscais e segunda via de DANFE:\n' +
      '- status_pedido: use quando o cliente perguntar sobre o andamento, status, envio ou aprovação do pedido/orçamento. Responda em tom curto e direto de balcão (sem rodeios e sem excesso de emojis), informando número do orçamento/pedido, status e valor real lido da ferramenta.\n' +
      '- status_nfe: use quando o cliente perguntar sobre nota fiscal emitida, chave de acesso ou faturamento. Se a nota estiver com status cancelada, alerte expressamente: "NF cancelada — não pagar".\n' +
      '- segunda_via_danfe: use quando o cliente solicitar 2ª via da nota fiscal ou do DANFE. Exige a chave de 44 dígitos da nota ou consulta a última nota do cliente. REGRA DE OURO: NUNCA invente chave de acesso. Se nenhuma chave for localizada, declare com clareza que não encontrou a chave e sinalize a transferência para um atendente humano.\n' +
      '- TRANSPARÊNCIA DE ROBÔ: Ao atender ou esclarecer dúvidas operacionais, seja transparente: "Sou o assistente da RPA, mas já te passo pro Raphael" ou similar quando o cliente solicitar atendimento humano.\n' +
      '- CAMADA 3 (ESCALAÇÃO IMEDIATA): Reclamações, nota fiscal com divergência/erro, cobrança, cliente irritado ou dúvidas sobre compatibilidade/aplicação de peças não cadastradas DEVEM ser transferidas imediatamente com o marcador [TRANSFERIR-HUMANO]. Nunca tente negociar cobrança nem inventar aplicação.'

    const updatedPrompt = currentPrompt ? currentPrompt + appendSection : appendSection.trim()
    settingsRec.set('ai_system_prompt', updatedPrompt)
    app.save(settingsRec)

    console.log(
      '[MIGRATION-0139] Seção de status, NF-e, DANFE e Camada 3 anexada ao ai_system_prompt com sucesso.',
    )
  },
  (app) => {
    try {
      const settingsRecords = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
      if (!settingsRecords || settingsRecords.length === 0) return
      const settingsRec = settingsRecords[0]
      const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')
      const SECTION_HEADER = '\n\n[FERRAMENTAS DE STATUS, NOTA FISCAL E DANFE]'
      const idx = currentPrompt.indexOf(SECTION_HEADER)
      if (idx !== -1) {
        settingsRec.set('ai_system_prompt', currentPrompt.substring(0, idx))
        app.save(settingsRec)
      }
    } catch (_) {}
  },
)
