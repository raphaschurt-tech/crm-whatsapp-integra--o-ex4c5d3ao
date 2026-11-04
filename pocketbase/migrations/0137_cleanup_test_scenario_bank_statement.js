/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Prova de exclusão de dados de teste:
  // Remove linhas marcadas como teste
  const lines = app.findRecordsByFilter(
    'bank_statement_lines',
    'notes ~ "[TESTE-RODADA-B]"',
    '-created',
    100
  )

  for (const line of lines) {
    app.delete(line)
  }
})
