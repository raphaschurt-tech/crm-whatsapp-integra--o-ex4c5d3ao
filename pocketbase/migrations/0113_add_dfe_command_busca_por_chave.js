// pocketbase/migrations/0113_add_dfe_command_busca_por_chave.js
// Adiciona o novo comando 'busca_por_chave' à coleção dfe_command_queue (Fila de comandos para o Worker DFe).
// Mantém os comandos existentes: 'consultar_agora', 'importacao_retroativa', 'reset_ponteiro'.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('dfe_command_queue')
    const field = col.fields.getByName('command')
    if (field) {
      col.fields.removeByName('command')
      col.fields.add(
        new SelectField({
          name: 'command',
          required: true,
          values: ['consultar_agora', 'importacao_retroativa', 'reset_ponteiro', 'busca_por_chave'],
          maxSelect: 1,
        }),
      )
      app.save(col)
      console.log('[MIGRATION-0113] dfe_command_queue atualizada com o comando busca_por_chave')
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('dfe_command_queue')
    const field = col.fields.getByName('command')
    if (field) {
      col.fields.removeByName('command')
      col.fields.add(
        new SelectField({
          name: 'command',
          required: true,
          values: ['consultar_agora', 'importacao_retroativa', 'reset_ponteiro'],
          maxSelect: 1,
        }),
      )
      app.save(col)
    }
  },
)
