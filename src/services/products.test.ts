import { describe, it, expect } from 'vitest'
import { buildRawProductFilter } from './products'

describe('buildRawProductFilter', () => {
  it('returns empty string when no term and no family', () => {
    expect(buildRawProductFilter('', '')).toBe('')
    expect(buildRawProductFilter('   ', 'all')).toBe('')
    expect(buildRawProductFilter(undefined, undefined)).toBe('')
  })

  it('filters by family only', () => {
    expect(buildRawProductFilter('', 'BUCHA DA BANDEJA')).toBe("sou_family = 'BUCHA DA BANDEJA'")
  })

  it('generates multi-field OR clauses for a single token', () => {
    const filter = buildRawProductFilter('bandeja', '')
    expect(filter).toBe(
      "(sku ~ 'bandeja' || name ~ 'bandeja' || reduced_code ~ 'bandeja' || barcode ~ 'bandeja' || location_1 ~ 'bandeja' || location_2 ~ 'bandeja' || location_3 ~ 'bandeja' || sou_family ~ 'bandeja')",
    )
  })

  it('generates AND of OR clauses for multiple tokens in any order (ex: bucha band 206)', () => {
    const filter = buildRawProductFilter('bucha band 206', '')
    // Deve conter cláusulas para bucha, band e 206 unidas por &&
    expect(filter).toContain("name ~ 'bucha'")
    expect(filter).toContain("name ~ 'band'")
    expect(filter).toContain("sku ~ '206'")
    expect(filter).toContain("sou_family ~ 'bucha'")
    expect(filter).toContain("location_1 ~ '206'")
    expect(filter).toContain(') && (')
  })

  it('filters stopwords unless query is only stopwords', () => {
    // "bucha da bandeja" -> stopwords "da" é descartada
    const filterWithStopword = buildRawProductFilter('bucha da bandeja', '')
    expect(filterWithStopword).toContain("name ~ 'bucha'")
    expect(filterWithStopword).toContain("name ~ 'bandeja'")
    expect(filterWithStopword).not.toContain("name ~ 'da'")

    // "da" sozinho é mantido como fallback
    const filterOnlyStopword = buildRawProductFilter('da', '')
    expect(filterOnlyStopword).toContain("name ~ 'da'")
  })

  it('normalizes accents and lowercases tokens', () => {
    const filter = buildRawProductFilter('PIVÔ', '')
    expect(filter).toContain("name ~ 'pivo'")
    expect(filter).not.toContain("name ~ 'PIVÔ'")
  })

  it('combines family and search tokens with AND', () => {
    const filter = buildRawProductFilter('bucha 206', 'BUCHA DA BANDEJA')
    expect(filter.startsWith('(')).toBe(true)
    expect(filter.endsWith(')')).toBe(true)
    expect(filter).toContain("sou_family = 'BUCHA DA BANDEJA'")
    expect(filter).toContain("name ~ 'bucha'")
    expect(filter).toContain("name ~ '206'")
  })

  it('sanitizes quotes and backslashes', () => {
    const filter = buildRawProductFilter("bucha' OR 1=1 --", '')
    expect(filter).not.toContain("bucha'")
    expect(filter).toContain("name ~ 'bucha'")
    expect(filter).not.toContain('--')
  })
})
