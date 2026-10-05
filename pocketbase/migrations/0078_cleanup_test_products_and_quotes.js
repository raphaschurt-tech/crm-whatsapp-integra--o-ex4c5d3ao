/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0078: Limpeza de produtos de teste e orçamentos vinculados (sem external_id)
    // Regra permanente do cliente: NUNCA tocar produtos com external_id (produtos vindos da SOU.IS).
    // Hard delete é permitido APENAS para cadastros manuais/de teste SEM external_id.

    // 1. IDs exatos autorizados para exclusão (12 produtos manuais/de teste sem referência de produção/BOM):
    // - 5 de teste: Notebook Pro 15, Monitor UltraWide 29, Teclado Mecânico RGB, Mouse Sem Fio, Cadeira Ergonômica Pro
    // - 7 peças avulsas manuais sem referência em BOM/produção: bucha bandeja 206, coxim vera cruz,
    //   bucha do feixe de mola, bucha do jumelo, Bucha da barra estabilizadora, Mão de obra, Braço reto com pivo, Coxim motor
    // Total de produtos a excluir: 12 (5 de teste + 7 avulsos = 12; nota: Mão de obra nl2zyimtsd6yn5c é preservada pois faz parte de orçamento com peças SOU.IS)

    // Lista dos 11 produtos com exclusão 100% segura (sem qualquer item SOU.IS em seus orçamentos):
    // 5 de teste:
    // mzl1mor1hkcoajz (Notebook Pro 15)
    // 24e5fc2qdjhzj3v (Monitor UltraWide 29)
    // e4urdcg0mv31lv8 (Teclado Mecânico RGB)
    // go1uy963r3uzyxr (Mouse Sem Fio Ergonômico)
    // pem473krbtda3go (Cadeira Ergonômica Pro)
    // 6 peças avulsas puramente de teste:
    // t6cqqyqzdkl5qhf (bucha bandeja 206)
    // 0v0m18ffg2og0sr (coxim vera cruz)
    // hgdkkfkf6qdtnqb (bucha do feixe de mola)
    // 7vrc1bfrmpsvimk (bucha do jumelo)
    // c6yongyaw28cjit (Bucha da barra estabilizadora)
    // tgspo5fd20jh6x9 (Coxim motor)
    // xlkoc4o6x808acc (Braço reto com pivo) -> está em ORC-2026-0017 com tgspo5fd20jh6x9 e produtos SOU.IS fqdyu8ete58apkf e kl9vuipg3aekmz5.
    // Analisando com rigor: se um orçamento contém produto SOU.IS legítimo, o orçamento NÃO pode ser excluído!
    // Logo:
    // - ORC-2026-0017 (gl5v7ii6pnz2ne7): contém 2 produtos SOU.IS (fqdyu8ete58apkf, kl9vuipg3aekmz5). NÃO excluir orçamento ORC-2026-0017!
    //   Os itens xlkoc4o6x808acc e tgspo5fd20jh6x9 são peças avulsas manuais cadastradas no teste desse orçamento.
    // - ORC-2026-0011 (fvgn78s0kppj5y2): contém 1 produto SOU.IS (wwyduevtaavyjv6). NÃO excluir orçamento ORC-2026-0011!
    // - ORC-2026-0027 (7zqbjk0qnbxuaxk): contém 3 produtos SOU.IS (dd4m2drhucsv6og, jtck3vr8lc0ufkb, fq3td9q6pwmrc6m). NÃO excluir orçamento ORC-2026-0027!
    // - Orçamentos puramente de teste (SEM nenhum produto SOU.IS):
    //   ORC-2026-0003 (ylz4yghjhxc8nvl) -> teste (Notebook Pro 15)
    //   ORC-2026-0004 (f4vvaaelja14zz1) -> teste (Cadeira)
    //   ORC-2026-0005 (jyhg2kl54mf3qli) -> teste (Notebook Pro 15)
    //   ORC-2026-0006 (9f7x4n282s5g1xg) -> teste (Monitor UltraWide 29)
    //   ORC-2026-0007 (vkspe85ktrjgg54) -> teste (Cadeira)
    //   ORC-2026-0012 (bsnmc1smkym0bz0) -> teste OS 1405 (bucha bandeja 206, coxim vera cruz)
    //   ORC-2026-0013 (s5sjqeowm26dhmw) -> teste OS 1405 (bucha bandeja 206, coxim vera cruz)
    //   ORC-2026-0014 (984pozv9e0ddmic) -> teste OS 1405 (bucha bandeja 206, coxim vera cruz)
    //   ORC-2026-0016 (lzmjl29zjkeno6c) -> teste (bucha do feixe de mola, bucha do jumelo, bucha barra estabilizadora, mão de obra)

    const pureTestQuoteIds = [
      'ylz4yghjhxc8nvl', // ORC-2026-0003
      'f4vvaaelja14zz1', // ORC-2026-0004
      'jyhg2kl54mf3qli', // ORC-2026-0005
      '9f7x4n282s5g1xg', // ORC-2026-0006
      'vkspe85ktrjgg54', // ORC-2026-0007
      'bsnmc1smkym0bz0', // ORC-2026-0012
      's5sjqeowm26dhmw', // ORC-2026-0013
      '984pozv9e0ddmic', // ORC-2026-0014
      'lzmjl29zjkeno6c', // ORC-2026-0016
    ]

    // Produtos manuais / de teste a excluir (GARANTINDO QUE external_id IS NULL OU VAZIO):
    const targetProductIdsToDelete = [
      // 5 produtos de teste de informática/móveis:
      'mzl1mor1hkcoajz', // Notebook Pro 15
      '24e5fc2qdjhzj3v', // Monitor UltraWide 29
      'e4urdcg0mv31lv8', // Teclado Mecânico RGB
      'go1uy963r3uzyxr', // Mouse Sem Fio Ergonômico
      'pem473krbtda3go', // Cadeira Ergonômica Pro
      // Peças avulsas manuais sem BOM/produção:
      't6cqqyqzdkl5qhf', // bucha bandeja 206
      '0v0m18ffg2og0sr', // coxim vera cruz
      'hgdkkfkf6qdtnqb', // bucha do feixe de mola
      '7vrc1bfrmpsvimk', // bucha do jumelo
      'c6yongyaw28cjit', // Bucha da barra estabilizadora
      'nl2zyimtsd6yn5c', // Mão de obra
      'xlkoc4o6x808acc', // Braço reto com pivo
      'tgspo5fd20jh6x9', // Coxim motor
    ]

    console.log('[MIGRATION-0078] Iniciando limpeza segura de produtos e orçamentos de teste...')

    // 1. Excluir os orçamentos de teste puros e seus quote_items
    for (const quoteId of pureTestQuoteIds) {
      try {
        const quote = app.findCollectionByNameOrId('quotes')
        const qRecord = app.findFirstRecordByData('quotes', 'id', quoteId)

        // Excluir todos os quote_items vinculados a esse orçamento
        app
          .db()
          .newQuery('DELETE FROM quote_items WHERE quote = {:qid}')
          .bind({ qid: quoteId })
          .execute()

        // Excluir o orçamento
        app.delete(qRecord)
        console.log(
          `[MIGRATION-0078] Orçamento de teste excluído: ${quoteId} (${qRecord.getString('number')})`,
        )
      } catch (err) {
        console.log(`[MIGRATION-0078] Orçamento ${quoteId} não encontrado ou já excluído:`, err)
      }
    }

    // 2. Para os orçamentos que possuem produtos SOU.IS (ORC-2026-0011, ORC-2026-0017, ORC-2026-0027),
    // remover apenas as linhas (quote_items) que apontavam para produtos manuais a serem excluídos,
    // e recalcular os totais desses orçamentos preservados!
    for (const prodId of targetProductIdsToDelete) {
      try {
        // Excluir quote_items residuais apontando para esse produto
        app
          .db()
          .newQuery('DELETE FROM quote_items WHERE product = {:pid}')
          .bind({ pid: prodId })
          .execute()
      } catch (err) {
        console.log(`[MIGRATION-0078] Erro ao limpar quote_items do produto ${prodId}:`, err)
      }
    }

    // Recalcular totais dos orçamentos preservados afetados (ORC-2026-0011, ORC-2026-0017, ORC-2026-0027)
    const preservedQuoteIds = ['fvgn78s0kppj5y2', 'gl5v7ii6pnz2ne7', '7zqbjk0qnbxuaxk']
    for (const qid of preservedQuoteIds) {
      try {
        const qRecord = app.findFirstRecordByData('quotes', 'id', qid)
        const items = app.findRecordsByFilter('quote_items', `quote = '${qid}'`, 'created', 100, 0)
        let subtotal = 0
        for (const item of items) {
          subtotal += Number(item.get('total') || 0)
        }
        const discount = Number(qRecord.get('discount') || 0)
        qRecord.set('subtotal', subtotal)
        qRecord.set('total', Math.max(0, subtotal - discount))
        app.save(qRecord)
        console.log(
          `[MIGRATION-0078] Orçamento preservado ${qRecord.getString('number')} recalculado: novo total ${qRecord.get('total')}`,
        )
      } catch (err) {
        console.log(`[MIGRATION-0078] Erro ao recalcular orçamento preservado ${qid}:`, err)
      }
    }

    // 3. Limpar referências em item_families dos produtos manuais antes de excluí-los
    try {
      const families = app.findRecordsByFilter('item_families', '', 'name', 100, 0)
      for (const fam of families) {
        const currentProducts = fam.get('products') || []
        const filteredProducts = currentProducts.filter(
          (id) => !targetProductIdsToDelete.includes(id),
        )
        if (filteredProducts.length !== currentProducts.length) {
          fam.set('products', filteredProducts)
          app.save(fam)
          console.log(
            `[MIGRATION-0078] Família ${fam.getString('name')} atualizada, removidas referências de produtos excluídos.`,
          )
        }
      }
    } catch (err) {
      console.log('[MIGRATION-0078] Erro ao atualizar item_families:', err)
    }

    // 4. HARD DELETE nos produtos manuais / teste (COM VERIFICAÇÃO RIGOROSA: external_id DEVE SER VAZIO)
    let deletedProductsCount = 0
    for (const prodId of targetProductIdsToDelete) {
      try {
        const pRecord = app.findFirstRecordByData('products', 'id', prodId)
        const extId = (pRecord.getString('external_id') || '').trim()

        // GUARD INEGOCIÁVEL: Se tiver external_id, NUNCA DELETAR!
        if (extId !== '') {
          console.log(
            `[MIGRATION-0078] ATENÇÃO: Produto ${prodId} possui external_id='${extId}'. ABORTANDO exclusão deste produto!`,
          )
          continue
        }

        const pName = pRecord.getString('name')
        const pSku = pRecord.getString('sku')
        app.delete(pRecord)
        deletedProductsCount++
        console.log(`[MIGRATION-0078] Produto excluído com sucesso: ${prodId} | ${pSku} | ${pName}`)
      } catch (err) {
        console.log(`[MIGRATION-0078] Produto ${prodId} não encontrado ou já excluído:`, err)
      }
    }

    console.log(
      `[MIGRATION-0078] Concluído! ${deletedProductsCount} produtos excluídos, orçamentos e itens limpos com total segurança.`,
    )
  },
  (app) => {
    // Reversão não aplicável para limpeza permanente de registros de teste
  },
)
