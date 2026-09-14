migrate(
  (app) => {
    try {
      const records = app.findRecordsByFilter('purchase_requests', '', '', 1000, 0)

      for (const record of records) {
        const existingSupplier = record.getString('supplier') || ''
        const oldCost = record.getFloat('cost_price')
        const oldSell = record.getFloat('sell_price')

        let rawItems = record.get('items')
        let itemsList = []

        if (Array.isArray(rawItems) && rawItems.length > 0) {
          itemsList = rawItems.map((it, idx) => {
            const itemObj = typeof it === 'object' && it !== null ? { ...it } : {}
            // O fornecedor único atual vira o fornecedor de todos os itens se o item não tiver fornecedor próprio
            if (!itemObj.supplier_id && existingSupplier) {
              itemObj.supplier_id = existingSupplier
            }
            // Os preços de custo/venda únicos do card antigo ficam no primeiro item (mantendo a margem original da compra)
            if (idx === 0) {
              if (itemObj.cost_price === undefined || itemObj.cost_price === null) {
                if (oldCost > 0) {
                  itemObj.cost_price = oldCost
                }
              }
              if (itemObj.sell_price === undefined || itemObj.sell_price === null) {
                if (oldSell > 0) {
                  itemObj.sell_price = oldSell
                }
              }
            }
            return itemObj
          })
        } else {
          // Se não havia items array, cria o 1º item com part_name, vehicle, fornecedor e preços
          const pName = record.getString('part_name') || 'Item'
          const vModel = record.getString('vehicle') || ''
          const firstItem = {
            part_name: pName,
            vehicle: vModel,
            quantity: 1,
            supplier_id: existingSupplier || undefined,
            cost_price: oldCost > 0 ? oldCost : undefined,
            sell_price: oldSell > 0 ? oldSell : undefined,
          }
          itemsList = [firstItem]
        }

        record.set('items', itemsList)
        app.save(record)
      }
    } catch (err) {
      console.log('Aviso na migração 0049_migrate_purchase_requests_item_pricing:', err)
    }
  },
  (app) => {
    // Reverter não precisa apagar nada, pois items é retrocompatível
  },
)
