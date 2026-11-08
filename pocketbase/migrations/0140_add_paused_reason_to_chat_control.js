/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Adicionar campo 'paused_reason' na coleção 'chat_control' de forma idempotente
    const chatControlCol = app.findCollectionByNameOrId('chat_control')
    if (chatControlCol) {
      let hasPausedReason = false
      try {
        hasPausedReason = Boolean(chatControlCol.fields.getByName('paused_reason'))
      } catch (_) {
        hasPausedReason = false
      }

      if (!hasPausedReason) {
        try {
          chatControlCol.fields.addAt(
            chatControlCol.fields.length,
            new Field({
              name: 'paused_reason',
              type: 'text',
              required: false,
            }),
          )
          app.save(chatControlCol)
          console.log('[MIGRATION-0140] Campo paused_reason adicionado à collection chat_control.')
        } catch (addErr) {
          console.log(
            '[MIGRATION-0140-WARN] Falha ao adicionar campo paused_reason:',
            addErr.message || String(addErr),
          )
        }
      } else {
        console.log('[MIGRATION-0140] Campo paused_reason já existe em chat_control.')
      }
    }

    // 2. Garantir idempotência das regras de Tom de Balcão, Transparência de Robô e Camada 3 no settings.ai_system_prompt
    try {
      const settingsRecords = app.findRecordsByFilter('settings', '', '-created', 1, 0)
      if (settingsRecords && settingsRecords.length > 0) {
        const settingsRec = settingsRecords[0]
        const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')

        const missingTomDeBalcao =
          !currentPrompt.includes('tom de balcão') && !currentPrompt.includes('TOM DE BALCÃO')
        const missingTransparencia =
          !currentPrompt.includes('Sou o assistente da RPA') &&
          !currentPrompt.includes('TRANSPARÊNCIA')
        const missingCamada3 = !currentPrompt.includes('CAMADA 3')

        if (missingTomDeBalcao || missingTransparencia || missingCamada3) {
          const appendSection =
            '\n\n[TOM DE BALCÃO, TRANSPARÊNCIA E CAMADA 3]\n' +
            '1. TOM DE BALCÃO: Seja breve, direto e use tom de balcão de autopeças (objetivo, cordial e sem excesso de emojis).\n' +
            '2. TRANSPARÊNCIA DE ROBÔ: Deixe claro seu papel quando necessário ("Sou o assistente da RPA, mas já te passo pro Raphael").\n' +
            '3. CAMADA 3 EXPLÍCITA: Reclamações graves, notas erradas ou canceladas, cobranças ou clientes irritados devem ser transferidos IMEDIATAMENTE com [TRANSFERIR-HUMANO].\n'

          settingsRec.set('ai_system_prompt', currentPrompt + appendSection)
          app.save(settingsRec)
          console.log(
            '[MIGRATION-0140] Regras de tom de balcão/transparência/camada 3 adicionadas ao prompt de settings.',
          )
        } else {
          console.log(
            '[MIGRATION-0140] Prompt gravado em settings já contempla tom de balcão, transparência e camada 3.',
          )
        }
      }
    } catch (promptErr) {
      console.log('[MIGRATION-0140-PROMPT-WARN]', promptErr.message || String(promptErr))
    }
  },
  (app) => {
    try {
      const chatControlCol = app.findCollectionByNameOrId('chat_control')
      if (chatControlCol) {
        const f = chatControlCol.fields.getByName('paused_reason')
        if (f) {
          chatControlCol.fields.remove(f)
          app.save(chatControlCol)
        }
      }
    } catch (_) {}
  },
)
