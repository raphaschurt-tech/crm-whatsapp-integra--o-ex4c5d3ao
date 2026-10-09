migrate(
  (app) => {
    const setRec = app.findRecordsByFilter('settings', '', '-created', 1, 0)[0]
    const data = JSON.parse(setRec.getString('ai_excluded_skus'))
    // Salvar apenas os IDs e nomes dos 3 fornecedores e resumo dos clientes
    const cleanSummary = {
      suppliers: data.suppliers,
      custCount: data.customers.length,
      customers: data.customers.slice(0, 5),
    }
    setRec.set('ai_system_prompt', 'DUPES:' + JSON.stringify(cleanSummary))
    app.save(setRec)
  },
  (app) => {},
)
