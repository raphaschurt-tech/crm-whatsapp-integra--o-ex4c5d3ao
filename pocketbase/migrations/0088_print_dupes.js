migrate(
  (app) => {
    const setRec = app.findRecordsByFilter('settings', '', '-created', 1, 0)[0]
    const report = JSON.parse(setRec.getString('payment_link_template'))
    // Limpa payment_link_template de volta para o valor limpo ou vazio
    setRec.set('payment_link_template', '')
    app.save(setRec)

    console.log('=== RELATÓRIO DE DUPLICADOS ENCONTRADOS ===')
    for (let i = 0; i < report.length; i++) {
      const grp = report[i]
      console.log(`GRUPO ${i + 1} [${grp.type}] - Telefone: ${grp.phone}`)
      for (let j = 0; j < grp.items.length; j++) {
        const it = grp.items[j]
        console.log(
          `  -> ID: ${it.id} | Nome: ${it.name} | Contato: ${it.contact_name || '-'} | Tipo: ${it.type} | Refs: ${JSON.stringify(it.refs)} | Famílias: ${it.families || 0}`,
        )
      }
    }
  },
  (app) => {},
)
