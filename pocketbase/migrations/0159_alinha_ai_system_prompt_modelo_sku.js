/// <reference path="../pb_data/types.d.ts" />
//
// 0159 — A5: alinha o trecho do modelo de apresentação do settings.ai_system_prompt
// (se descrever "Valor" e "Disponibilidade") ao mesmo modelo com SKU usado pelo
// worker (toolsAndPriceRules). Preserva TODO o resto do prompt. Idempotente.

migrate(
  (app) => {
    try {
      const settingsRecords = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
      if (!settingsRecords || settingsRecords.length === 0) return
      const settingsRec = settingsRecords[0]
      const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')

      const OLD_BLOCK =
        '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço; '
      const NEW_BLOCK =
        '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço. ' +
        'Apresente cada produto em bloco separado usando EXATAMENTE este modelo: ' +
        '"1. *Nome completo do produto (com a faixa de anos)* — SKU: 3948 | Marca: X | Valor: R$ 160,00 | Disponibilidade: 6 un.". ' +
        'SKU é sempre o campo `sku` retornado pela ferramenta (nunca invente, nunca use id do banco); ' +
        'Valor vem SEMPRE de `preco_texto`; Disponibilidade vem SEMPRE de `disponibilidade_texto`; ' +
        '"Sob consulta" se aplica SOMENTE ao valor — se a peça tem 1 unidade, a disponibilidade é "1 un." e nunca "sob consulta". '

      if (!currentPrompt.includes(OLD_BLOCK)) {
        console.log(
          '[MIGRATION-0159] Nenhum trecho do modelo antigo (Valor/Disponibilidade sem SKU) encontrado no ai_system_prompt. Nenhuma alteração feita.',
        )
        return
      }

      const updatedPrompt = currentPrompt.split(OLD_BLOCK).join(NEW_BLOCK)
      settingsRec.set('ai_system_prompt', updatedPrompt)
      app.save(settingsRec)
      console.log(
        '[MIGRATION-0159] Trecho do modelo de apresentação atualizado para o modelo com SKU.',
      )
    } catch (err) {
      console.log('[MIGRATION-0159-ERR]', String(err))
    }
  },
  (app) => {
    try {
      const settingsRecords = app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
      if (!settingsRecords || settingsRecords.length === 0) return
      const settingsRec = settingsRecords[0]
      const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')
      const NEW_BLOCK =
        '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço. ' +
        'Apresente cada produto em bloco separado usando EXATAMENTE este modelo: '
      if (!currentPrompt.includes(NEW_BLOCK)) return
      const OLD_BLOCK =
        '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço; '
      const idx = currentPrompt.indexOf('Apresente cada produto em bloco separado')
      const endIdx = currentPrompt.indexOf('5. É terminantemente', idx)
      if (idx !== -1 && endIdx !== -1) {
        const restored =
          currentPrompt.substring(0, idx) + OLD_BLOCK + currentPrompt.substring(endIdx)
        settingsRec.set('ai_system_prompt', restored)
        app.save(settingsRec)
      }
    } catch (_) {}
  },
)
