/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const itauAccount = app.findFirstRecordByData('bank_accounts', 'nickname', 'RPA ITAU')
  if (!itauAccount) {
    return
  }

  const linesCollection = app.findCollectionByNameOrId('bank_statement_lines')

  const record1 = new Record(linesCollection)
  record1.set('bank_account', itauAccount.id)
  record1.set('date', '2026-11-04 12:00:00.000Z')
  record1.set('amount', -150.00)
  record1.set('type', 'debito')
  record1.set('description', 'PIX ENVIADO FORNECEDOR TESTE CENARIO B')
  record1.set('fitid', 'TEST_FITID_001_RODADA_B')
  record1.set('status', 'pendente')
  record1.set('dedupe_hash', 'test_hash_001_debito_150')
  record1.set('notes', '[TESTE-RODADA-B] Linha de teste para prova de banco')
  app.save(record1)

  const record2 = new Record(linesCollection)
  record2.set('bank_account', itauAccount.id)
  record2.set('date', '2026-11-04 14:00:00.000Z')
  record2.set('amount', 500.00)
  record2.set('type', 'credito')
  record2.set('description', 'PIX RECEBIDO CLIENTE TESTE CENARIO B')
  record2.set('fitid', 'TEST_FITID_002_RODADA_B')
  record2.set('status', 'pendente')
  record2.set('dedupe_hash', 'test_hash_002_credito_500')
  record2.set('notes', '[TESTE-RODADA-B] Linha de teste para prova de banco')
  app.save(record2)
})
