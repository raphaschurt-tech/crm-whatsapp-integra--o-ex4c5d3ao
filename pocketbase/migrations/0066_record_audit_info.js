migrate(
  (app) => {
    // Verificar produtos sem família
    const families = app.findRecordsByFilter('item_families', '1=1', '', 0, 0)
    const prodsWithFamily = new Set()
    for (let f = 0; f < families.length; f++) {
      const pList = families[f].get('products') || []
      for (let p = 0; p < pList.length; p++) {
        prodsWithFamily.add(pList[p])
      }
    }

    const allProducts = app.findRecordsByFilter('products', '1=1', '', 0, 0)
    let unclassifiedCount = 0
    for (let i = 0; i < allProducts.length; i++) {
      if (!prodsWithFamily.has(allProducts[i].id)) {
        unclassifiedCount++
      }
    }

    const suppliers = app.findRecordsByFilter(
      'customers',
      "customer_type = 'Fornecedor' || customer_type = 'Ambos'",
      'name',
      0,
      0,
    )
    const supplierNames = suppliers.map((s) => s.get('name'))

    try {
      const setCol = app.findCollectionByNameOrId('settings')
      let auditRecord
      try {
        auditRecord = app.findFirstRecordByData('settings', 'company_name', '__AUDIT_MIGRATION__')
      } catch (_) {
        auditRecord = new Record(setCol)
        auditRecord.set('company_name', '__AUDIT_MIGRATION__')
      }
      auditRecord.set(
        'payment_terms',
        JSON.stringify({
          totalProducts: allProducts.length,
          unclassifiedProducts: unclassifiedCount,
          classifiedProducts: allProducts.length - unclassifiedCount,
          suppliersCount: suppliers.length,
          supplierNames: supplierNames,
        }),
      )
      app.save(auditRecord)
    } catch (e) {
      // ignore
    }
  },
  (app) => {
    try {
      const auditRecord = app.findFirstRecordByData(
        'settings',
        'company_name',
        '__AUDIT_MIGRATION__',
      )
      if (auditRecord) app.delete(auditRecord)
    } catch (_) {}
  },
)
