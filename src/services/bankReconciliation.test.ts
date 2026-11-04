import { describe, it, expect } from 'vitest'
import { scoreMatchCandidates } from './bankReconciliation'
import { BankStatementLine, AccountsPayable, AccountsReceivable } from '@/types/crm'

describe('bankReconciliation - Sugestão Automática de Casamento', () => {
  const dummyLine = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
    id: 'line_1',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: '',
    bank_account: 'acc_itau',
    date: '2026-11-04T12:00:00.000Z',
    amount: -214.5,
    type: 'debito',
    description: 'PAG BOLETO MEC LAN NF 3810',
    dedupe_hash: 'hash_1',
    status: 'pendente',
    ...overrides,
  })

  it('identifica casamento provável (✅) por valor exato + data próxima + descrição coerente', () => {
    const line = dummyLine({
      amount: -214.5,
      type: 'debito',
      date: '2026-11-04T12:00:00.000Z',
      description: 'PAG BOLETO MEC LAN NF 3810',
    })

    const payables: AccountsPayable[] = [
      {
        id: 'ap_1',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
        description: 'MEC LAN - NF-e 3810 (duplicata 001)',
        supplier_name: 'MEC LAN IND E COM DE AUTO PECAS',
        amount: 214.5,
        due_date: '2026-11-04',
        status: 'pendente',
        origin: 'nfe',
      },
      {
        id: 'ap_2',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
        description: 'OXILAPA - NF-e 1199',
        supplier_name: 'OXILAPA',
        amount: 890.0,
        due_date: '2026-11-04',
        status: 'pendente',
        origin: 'nfe',
      },
    ]

    const result = scoreMatchCandidates(line, payables, [])
    expect(result.confidence).toBe('provavel')
    expect(result.bestMatch).toBeDefined()
    expect(result.bestMatch?.id).toBe('ap_1')
    expect(result.candidates).toHaveLength(1)
  })

  it('classifica como dúbia (❓) quando há 2 ou mais candidatos com mesmo valor e data próxima', () => {
    const line = dummyLine({
      amount: -150.0,
      type: 'debito',
      date: '2026-11-04T12:00:00.000Z',
      description: 'PIX TRANSFERENCIA DIVERSOS',
    })

    const payables: AccountsPayable[] = [
      {
        id: 'ap_a',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
        description: 'Fornecedor A',
        amount: 150.0,
        due_date: '2026-11-04',
        status: 'pendente',
        origin: 'manual',
      },
      {
        id: 'ap_b',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
        description: 'Fornecedor B',
        amount: 150.0,
        due_date: '2026-11-04',
        status: 'pendente',
        origin: 'manual',
      },
    ]

    const result = scoreMatchCandidates(line, payables, [])
    expect(result.confidence).toBe('dubia')
    expect(result.candidates).toHaveLength(2)
  })

  it('classifica como sem correspondência (⬜) quando não há lançamentos com o mesmo valor ou prazo', () => {
    const line = dummyLine({
      amount: -18.5,
      type: 'debito',
      date: '2026-11-04T12:00:00.000Z',
      description: 'TAR CONTA CORRENTE ITAU',
    })

    const payables: AccountsPayable[] = [
      {
        id: 'ap_x',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
        description: 'Nota Grande',
        amount: 2500.0,
        due_date: '2026-11-04',
        status: 'pendente',
        origin: 'manual',
      },
    ]

    const result = scoreMatchCandidates(line, payables, [])
    expect(result.confidence).toBe('sem_correspondencia')
    expect(result.candidates).toHaveLength(0)
  })
})
