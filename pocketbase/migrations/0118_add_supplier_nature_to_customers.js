/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migração 0118: ATRIBUTO NATUREZA DO FORNECEDOR (F4 — 0.0.265)
    //
    // Contexto: até 0.0.263 o guard de CFOP do pipeline NF-e usava defaults
    // HARDCODED por CNPJ/nome (Jahu = revenda, MEC LAN = revenda, Oxilapa =
    // insumo_producao). A F4 substitui o default por atributo formal no cadastro.
    //
    // Ações:
    // 1. Novo campo select `supplier_nature` em `customers`
    //    (revenda / insumo_producao / insumo_consumo; vazio = classificação no lançamento).
    // 2. Atualizar os 3 fornecedores já cadastrados:
    //    - Jahu Borrapas (ukuwsuetw0d3p2m, CNPJs 61136701000147 + filiais em customer_documents) -> revenda
    //    - MEC LAN (bwd7wotwwizccnn, 62538228000197) -> revenda
    //    - Oxilapa (klma9h4msc1nsw3, 59417469000173) -> insumo_producao

    const customers = app.findCollectionByNameOrId('customers')
    if (!customers.fields.getByName('supplier_nature')) {
      customers.fields.add(
        new SelectField({
          name: 'supplier_nature',
          values: ['revenda', 'insumo_producao', 'insumo_consumo'],
          maxSelect: 1,
        }),
      )
      app.save(customers)
    }

    const natureUpdates = [
      { id: 'ukuwsuetw0d3p2m', nature: 'revenda' },
      { id: 'bwd7wotwwizccnn', nature: 'revenda' },
      { id: 'klma9h4msc1nsw3', nature: 'insumo_producao' },
    ]
    for (let i = 0; i < natureUpdates.length; i++) {
      const u = natureUpdates[i]
      try {
        const rec = app.findRecordById('customers', u.id)
        if (rec && rec.getString('supplier_nature') !== u.nature) {
          rec.set('supplier_nature', u.nature)
          app.save(rec)
          console.log('[MIGRATION-0118-NATURE]', rec.getString('name'), '->', u.nature)
        }
      } catch (err) {
        console.log('[MIGRATION-0118-ERR]', u.id, err.message || String(err))
      }
    }
  },
  (app) => {
    try {
      const customers = app.findCollectionByNameOrId('customers')
      const field = customers.fields.getByName('supplier_nature')
      if (field) {
        customers.fields.remove(field)
        app.save(customers)
      }
    } catch (_) {}
  },
)
