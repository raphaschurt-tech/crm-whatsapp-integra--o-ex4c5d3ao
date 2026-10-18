import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  extractSearchTokens,
  matchesSearchTokens,
  matchProductSearch,
  matchCustomerSearch,
} from './fuzzySearch'

describe('fuzzySearch library', () => {
  describe('normalizeSearchText', () => {
    it('normalizes accents and casing', () => {
      expect(normalizeSearchText('PIVÔ')).toBe('pivo')
      expect(normalizeSearchText('Bandeja 206/207')).toBe('bandeja 206/207')
      expect(normalizeSearchText('  João da Silva  ')).toBe('joao da silva')
      expect(normalizeSearchText(null)).toBe('')
      expect(normalizeSearchText(undefined)).toBe('')
    })
  })

  describe('extractSearchTokens', () => {
    it('splits words and removes stopwords', () => {
      expect(extractSearchTokens('bucha da bandeja')).toEqual(['bucha', 'bandeja'])
      expect(extractSearchTokens('bucha band 206')).toEqual(['bucha', 'band', '206'])
      expect(extractSearchTokens('pivo')).toEqual(['pivo'])
      expect(extractSearchTokens('1 d 01')).toEqual(['1', 'd', '01'])
    })

    it('keeps stopwords if the search consists only of stopwords', () => {
      expect(extractSearchTokens('da')).toEqual(['da'])
      expect(extractSearchTokens('de do')).toEqual(['de', 'do'])
    })

    it('handles empty input', () => {
      expect(extractSearchTokens('')).toEqual([])
      expect(extractSearchTokens('   ')).toEqual([])
      expect(extractSearchTokens(null)).toEqual([])
    })
  })

  describe('matchesSearchTokens', () => {
    it('matches all tokens in any order across multiple fields', () => {
      const fields = ['BUCHA TRASEIRA BANDEJA DIANTEIRA', '1986', '206 08/.. 207']
      expect(matchesSearchTokens(fields, 'bucha band 206')).toBe(true)
      expect(matchesSearchTokens(fields, 'band 206 bucha')).toBe(true)
      expect(matchesSearchTokens(fields, '206 band')).toBe(true)
      expect(matchesSearchTokens(fields, 'bucha celta')).toBe(false)
    })
  })

  describe('matchProductSearch with location and sou_family', () => {
    const product = {
      name: 'BUCHA 206 08/.. 207 08/.. TRASEIRA BANDEJA DIANTEIRA',
      sku: '1986',
      description: 'Buchas de suspensão',
      supplier: 'SOU.IS',
      brand: 'DPA',
      barcode: '789000111222',
      reduced_code: '5258',
      location_1: '1',
      location_2: 'D',
      location_3: '7',
      sou_family: 'BUCHA DA BANDEJA',
    }

    it('finds product by out-of-order terms', () => {
      expect(matchProductSearch(product, 'bucha band 206')).toBe(true)
      expect(matchProductSearch(product, 'band 206')).toBe(true)
      expect(matchProductSearch(product, '206 bucha')).toBe(true)
    })

    it('finds product by location fields', () => {
      expect(matchProductSearch(product, '1 D 7')).toBe(true)
      expect(matchProductSearch(product, '1 d')).toBe(true)
      expect(matchProductSearch(product, 'd 7')).toBe(true)
      expect(matchProductSearch(product, 'bucha 1-d-7')).toBe(false) // separador diferente sem espaço
      expect(matchProductSearch(product, 'bucha 1 d 7')).toBe(true)
    })

    it('finds product by family', () => {
      expect(matchProductSearch(product, 'bucha da bandeja')).toBe(true)
      expect(matchProductSearch(product, 'bandeja 1986')).toBe(true)
    })

    it('finds product by brand or reduced code', () => {
      expect(matchProductSearch(product, 'dpa 206')).toBe(true)
      expect(matchProductSearch(product, '5258')).toBe(true)
    })

    it('returns false when any required token is missing', () => {
      expect(matchProductSearch(product, 'bucha band clio')).toBe(false)
    })
  })

  describe('matchCustomerSearch', () => {
    const customer = {
      name: 'João Carlos da Silva',
      contact_name: 'Carlos',
      phone: '11999998888',
      email: 'joao@silva.com',
      company: 'Auto Peças Silva',
      cpf: '12345678900',
      cnpj: null,
    }

    it('matches by token in customer fields', () => {
      expect(matchCustomerSearch(customer, 'joao silva')).toBe(true)
      expect(matchCustomerSearch(customer, 'pecas carlos')).toBe(true)
      expect(matchCustomerSearch(customer, '11999998888')).toBe(true)
      expect(matchCustomerSearch(customer, 'mariano')).toBe(false)
    })
  })
})
