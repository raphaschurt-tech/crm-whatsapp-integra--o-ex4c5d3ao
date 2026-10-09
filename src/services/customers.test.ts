import { describe, it, expect } from 'vitest'
import {
  cleanDocument,
  getPhoneVariants,
  getCustomerGroupType,
  getCanonicalPhoneCore,
  extractDuplicateErrorInfo,
} from './customers'

describe('Customer duplication rules & helpers', () => {
  it('cleanDocument should strip all non-digits', () => {
    expect(cleanDocument('123.456.789-00')).toBe('12345678900')
    expect(cleanDocument('12.345.678/0001-90')).toBe('12345678000190')
    expect(cleanDocument('')).toBe('')
    expect(cleanDocument(undefined)).toBe('')
  })

  it('getCustomerGroupType should classify fornecedor and ambos as fornecedor group', () => {
    expect(getCustomerGroupType('Fornecedor')).toBe('fornecedor')
    expect(getCustomerGroupType('fornecedor')).toBe('fornecedor')
    expect(getCustomerGroupType('Ambos')).toBe('fornecedor')
    expect(getCustomerGroupType('ambos')).toBe('fornecedor')
    expect(getCustomerGroupType('Cliente')).toBe('cliente')
    expect(getCustomerGroupType('cliente')).toBe('cliente')
    expect(getCustomerGroupType('')).toBe('cliente')
    expect(getCustomerGroupType(undefined)).toBe('cliente')
  })

  it('getCanonicalPhoneCore should normalize Brazilian phones to DDD + 8 digits', () => {
    // 55 + 11 + 9 dígitos (com 9º dígito 9)
    expect(getCanonicalPhoneCore('5511999826273')).toBe('1199826273')
    // Com máscara (+55 (11) 99982-6273)
    expect(getCanonicalPhoneCore('+55 (11) 99982-6273')).toBe('1199826273')
    // Sem 55 (11999826273)
    expect(getCanonicalPhoneCore('11999826273')).toBe('1199826273')
    // Sem nono dígito (11 + 8 dígitos)
    expect(getCanonicalPhoneCore('(11) 9982-6273')).toBe('1199826273')
    expect(getCanonicalPhoneCore('1199826273')).toBe('1199826273')
    // Ambas as grafias resultam exatamente na mesma chave canônica!
    expect(getCanonicalPhoneCore('5511999826273')).toBe(getCanonicalPhoneCore('(11) 9982-6273'))
  })

  it('getPhoneVariants should return all common lookup variants', () => {
    const variants = getPhoneVariants('5511999826273')
    expect(variants).toContain('5511999826273')
    expect(variants).toContain('11999826273')
    expect(variants).toContain('1199826273')
    expect(variants).toContain('551199826273')
  })

  it('extractDuplicateErrorInfo should parse standard backend duplicate guard error with ID', () => {
    const backendMsg =
      'Já existe um cliente cadastrado com este telefone: Auto Peças Silva [id:rec123abc]'
    const res = extractDuplicateErrorInfo(backendMsg)
    expect(res.isDuplicate).toBe(true)
    expect(res.entityLabel).toBe('cliente')
    expect(res.field).toBe('telefone')
    expect(res.existingName).toBe('Auto Peças Silva')
    expect(res.existingId).toBe('rec123abc')
    expect(res.message).toBe('Já existe um cliente cadastrado com este telefone: Auto Peças Silva')
  })

  it('extractDuplicateErrorInfo should parse fornecedor CPF duplicate error', () => {
    const backendMsg =
      'Já existe um fornecedor cadastrado com este CPF: Carlos Fornecedor [id:forn999]'
    const res = extractDuplicateErrorInfo(backendMsg)
    expect(res.isDuplicate).toBe(true)
    expect(res.entityLabel).toBe('fornecedor')
    expect(res.field).toBe('CPF')
    expect(res.existingName).toBe('Carlos Fornecedor')
    expect(res.existingId).toBe('forn999')
    expect(res.message).toBe('Já existe um fornecedor cadastrado com este CPF: Carlos Fornecedor')
  })

  it('extractDuplicateErrorInfo should parse CNPJ error without ID gracefully', () => {
    const backendMsg = 'Já existe um cliente cadastrado com este CNPJ: Distribuidora Central Ltda'
    const res = extractDuplicateErrorInfo(backendMsg)
    expect(res.isDuplicate).toBe(true)
    expect(res.entityLabel).toBe('cliente')
    expect(res.field).toBe('CNPJ')
    expect(res.existingName).toBe('Distribuidora Central Ltda')
    expect(res.existingId).toBeUndefined()
    expect(res.message).toBe(
      'Já existe um cliente cadastrado com este CNPJ: Distribuidora Central Ltda',
    )
  })

  it('extractDuplicateErrorInfo should return isDuplicate: false for unrelated errors', () => {
    const errorObj = new Error('Failed to fetch from server')
    const res = extractDuplicateErrorInfo(errorObj)
    expect(res.isDuplicate).toBe(false)
    expect(res.message).toBe('')
  })

  it('extractDuplicateErrorInfo should parse ClientResponseError structure', () => {
    const clientErr = {
      message: 'Já existe um fornecedor cadastrado com este telefone: Tech Parts [id:tp01]',
      status: 400,
    }
    const res = extractDuplicateErrorInfo(clientErr)
    expect(res.isDuplicate).toBe(true)
    expect(res.existingId).toBe('tp01')
    expect(res.existingName).toBe('Tech Parts')
  })
})
