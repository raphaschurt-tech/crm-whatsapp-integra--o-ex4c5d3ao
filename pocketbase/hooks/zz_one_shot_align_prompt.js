/// <reference path="../pb_data/types.d.ts" />
//
// TEMPORÁRIO — patch de dados one-shot (execução 5.2): alinha o
// settings.ai_system_prompt ao modelo de apresentação com SKU. Sem migração
// nova, por pedido do briefing. O código top-level roda UMA vez no boot do
// deploy; idempotente (só altera se o trecho antigo existir e o novo não).
// SERÁ REMOVIDO no fim da rodada — não é parte do produto.

try {
  const settingsRecords = $app.findRecordsByFilter('settings', "id != ''", '-created', 1, 0)
  if (settingsRecords && settingsRecords.length > 0) {
    const settingsRec = settingsRecords[0]
    const currentPrompt = String(settingsRec.getString('ai_system_prompt') || '')

    if (currentPrompt.indexOf('disponibilidade_texto') !== -1) {
      console.log(
        '[AI-PROMPT-MODELO-MOVIDO]',
        '{"resultado":"prompt ja alinhado ao modelo com SKU — nada a fazer"}',
      )
    } else {
      const SKU_RULES =
        ' Apresente cada produto em bloco separado usando EXATAMENTE este modelo: ' +
        '"1. *Nome completo do produto (com a faixa de anos)* — SKU: 3948 | Marca: X | Valor: R$ 160,00 | Disponibilidade: 6 un.". ' +
        'SKU é sempre o campo `sku` retornado pela ferramenta (nunca invente, nunca use id do banco); ' +
        'Valor vem SEMPRE de `preco_texto`; Disponibilidade vem SEMPRE de `disponibilidade_texto`; ' +
        '"Sob consulta" se aplica SOMENTE ao valor — se a peça tem 1 unidade, a disponibilidade é "1 un." e nunca "sob consulta". '

      // Alvo 1: trecho exato que a migração 0159 procura
      const OLD_A =
        '4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço; '
      // Alvo 2: frase de preço/estoque do prompt base restaurado pela 0086
      const OLD_B =
        "IMPORTANTE: ao consultar estoque, NUNCA diga 'indisponível' ou 'não temos em estoque' — " +
        "informe sempre 'disponível sob encomenda em até 48 horas' quando o estoque for zero. " +
        "Para itens com preço zero ou sem preço, informe 'preço sob consulta'."

      let updated = currentPrompt
      let alvo = ''
      if (updated.indexOf(OLD_A) !== -1) {
        updated = updated.split(OLD_A).join(OLD_A.replace(/; $/, '. ') + SKU_RULES.trim())
        alvo = '0159-OLD_A'
      } else if (updated.indexOf(OLD_B) !== -1) {
        updated = updated.replace(OLD_B, OLD_B + SKU_RULES.trim())
        alvo = '0086-OLD_B'
      }

      if (alvo === '') {
        console.log(
          '[AI-PROMPT-MODELO-MOVIDO]',
          JSON.stringify({
            resultado: 'nenhum trecho antigo encontrado — nada alterado',
            tamanhoPrompt: currentPrompt.length,
          }),
        )
      } else {
        settingsRec.set('ai_system_prompt', updated)
        $app.save(settingsRec)
        console.log(
          '[AI-PROMPT-MODELO-MOVIDO]',
          JSON.stringify({
            resultado: 'trecho de apresentacao alinhado ao modelo com SKU',
            alvo: alvo,
            antes_trecho: alvo === '0159-OLD_A' ? OLD_A : OLD_B,
            depois_trecho:
              (alvo === '0159-OLD_A' ? OLD_A.replace(/; $/, '. ') : OLD_B) + SKU_RULES.trim(),
            tamanhoAntes: currentPrompt.length,
            tamanhoDepois: updated.length,
          }).slice(0, 3500),
        )
      }
    }
  }
} catch (err) {
  console.log('[AI-PROMPT-ALIGN-ERR]', String(err))
}
