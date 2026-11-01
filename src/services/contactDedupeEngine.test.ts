import { describe, it, expect } from 'vitest'
import {
  parseAndNormalizeDocument,
  normalizePhone,
  getPhoneComparisonKey,
  findDuplicateContact,
  calculateNameSimilarity,
} from './contactDedupeEngine'

describe('contactDedupeEngine - Motor Unificado de Deduplicação', () => {
  it('detecta e formata CPF com 11 dígitos', () => {
    const doc = parseAndNormalizeDocument('12345678901')
    expect(doc.type).toBe('CPF')
    expect(doc.isValidLength).toBe(true)
    expect(doc.cleanDigits).toBe('12345678901')
    expect(doc.formatted).toBe('123.456.789-01')
  })

  it('detecta e formata CNPJ com 14 dígitos e extrai raiz', () => {
    const doc = parseAndNormalizeDocument('61136701000147')
    expect(doc.type).toBe('CNPJ')
    expect(doc.isValidLength).toBe(true)
    expect(doc.cleanDigits).toBe('61136701000147')
    expect(doc.rootCnpj).toBe('61136701')
    expect(doc.formatted).toBe('61.136.701/0001-47')
  })

  it('normaliza os 4 formatos de telefone reais da base', () => {
    // 1. Sem DDI
    const f1 = normalizePhone('11947518805')
    expect(f1.canonicalDdi).toBe('5511947518805')
    expect(f1.ddd).toBe('11')
    expect(f1.isLandline).toBe(false)

    // 2. Com DDI
    const f2 = normalizePhone('5511954747695')
    expect(f2.canonicalDdi).toBe('5511954747695')
    expect(f2.ddd).toBe('11')

    // 3. Formatado
    const f3 = normalizePhone('(11) 91245-2830')
    expect(f3.canonicalDdi).toBe('5511912452830')

    // 4. Fixo de 10 dígitos com DDD
    const f4 = normalizePhone('1136190000')
    expect(f4.canonicalDdi).toBe('551136190000')
    expect(f4.isLandline).toBe(true)

    // 5. Fixo de 8 dígitos puro (assume DDD padrão 11)
    const f5 = normalizePhone('36190000', '11')
    expect(f5.canonicalDdi).toBe('551136190000')
    expect(f5.isLandline).toBe(true)
  })

  it('agrupa unidade/filial Jahu (61136701000372) à mesma entidade Jahu (61136701000147)', () => {
    const existingJahu = [
      {
        id: 'ukuwsuetw0d3p2m',
        name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000147',
        phone: '1136190000',
        customer_type: 'Fornecedor',
        deleted: false,
      },
    ]

    const result = findDuplicateContact(
      {
        document: '61136701000372',
        name: 'Jahu Filial Campinas',
        customerType: 'Fornecedor',
      },
      existingJahu,
    )

    expect(result.action).toBe('branch_group_found')
    expect(result.matchType).toBe('branch_root_cnpj')
    expect(result.isBlocker).toBe(false)
    expect(result.existingCustomer?.id).toBe('ukuwsuetw0d3p2m')
    expect(result.warningMessage).toContain('61136701')
  })

  it('bloqueia duplicidade exata de CNPJ de fornecedor', () => {
    const existing = [
      {
        id: 'c1',
        name: 'Fornecedor XYZ',
        cnpj: '12345678000199',
        customer_type: 'Fornecedor',
        deleted: false,
      },
    ]

    const result = findDuplicateContact(
      {
        document: '12.345.678/0001-99',
        customerType: 'Fornecedor',
      },
      existing,
    )

    expect(result.action).toBe('match_found')
    expect(result.matchType).toBe('exact_document')
    expect(result.isBlocker).toBe(true)
  })

  it('bloqueia duplicidade de telefone para Cliente PF mesmo em formatos diferentes', () => {
    const existing = [
      {
        id: 'plhfhbjufsp8sfb',
        name: 'Natalia',
        phone: '11963970333',
        customer_type: 'Cliente',
        deleted: false,
      },
    ]

    // Formato com DDI e traço
    const result = findDuplicateContact(
      {
        phone: '+55 (11) 96397-0333',
        customerType: 'Cliente',
      },
      existing,
    )

    expect(result.action).toBe('match_found')
    expect(result.matchType).toBe('canonical_phone')
    expect(result.isBlocker).toBe(true)
    expect(result.existingCustomer?.id).toBe('plhfhbjufsp8sfb')
  })

  it('nome similar (fuzzy match) gera apenas AVISO, nunca bloqueio automático', () => {
    const existing = [
      {
        id: 'c2',
        name: 'Carlos Alberto Silva',
        phone: '11988880000',
        deleted: false,
      },
    ]

    const result = findDuplicateContact(
      {
        name: 'Carlos Alberto Da Silva',
        phone: '11977771111', // telefone diferente
      },
      existing,
    )

    expect(result.action).toBe('fuzzy_warning')
    expect(result.isBlocker).toBe(false)
    expect(result.warningMessage).toContain('Atenção: nome similar')
  })
})
