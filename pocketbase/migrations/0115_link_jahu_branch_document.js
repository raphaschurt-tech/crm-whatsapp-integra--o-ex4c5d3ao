/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Vincular a unidade filial Jahu (61136701000372) à MESMA entidade Jahu (61136701000147)
    // Raiz 61136701 idêntica, mesma razão social.
    // Protegido com try/catch e busca por filtro para ser idempotente em qualquer réplica do banco.
    try {
      const docsCol = app.findCollectionByNameOrId('customer_documents')
      const jahuRecords = app.findRecordsByFilter(
        'customers',
        'cnpj ~ "61136701" || name ~ "JAHU BORRACHAS"',
        '-created',
        1,
        0,
      )

      if (jahuRecords && jahuRecords.length > 0) {
        const jahuCust = jahuRecords[0]
        const existingBranch = app.findRecordsByFilter(
          'customer_documents',
          `customer = "${jahuCust.id}" && document_number = "61136701000372"`,
          '',
          1,
          0,
        )

        if (!existingBranch || existingBranch.length === 0) {
          const branchRec = new Record(docsCol)
          branchRec.set('customer', jahuCust.id)
          branchRec.set('document_type', 'CNPJ')
          branchRec.set('document_number', '61136701000372')
          branchRec.set('root_cnpj', '61136701')
          branchRec.set('label', 'Unidade Filial (61.136.701/0003-72)')
          branchRec.set('is_primary', false)
          app.save(branchRec)
        }
      }
    } catch (err) {
      console.log('[MIGRATION-0115-WARN]', err)
    }
  },
  (app) => {
    try {
      const branch = app.findRecordsByFilter(
        'customer_documents',
        'document_number = "61136701000372"',
        '',
        1,
        0,
      )
      if (branch && branch.length > 0) {
        app.delete(branch[0])
      }
    } catch (_) {}
  },
)
