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

  describe('Guards N1-N6 no buildRawProductFilter', () => {
    it('N1 & N6: todas as variantes ("1d01", "1D01", "1-D-01", "1 d 01") geram o mesmo filtro com tokens 1, d, 01', () => {
      const f1 = buildRawProductFilter('1d01', '')
      const f2 = buildRawProductFilter('1D01', '')
      const f3 = buildRawProductFilter('1-D-01', '')
      const f4 = buildRawProductFilter('1 d 01', '')

      expect(f1).toBe(f2)
      expect(f2).toBe(f3)
      expect(f3).toBe(f4)

      // Contém cláusulas para '1', 'd' e '01'
      expect(f1).toContain("location_1 ~ '1'")
      expect(f1).toContain("location_2 ~ 'd'")
      expect(f1).toContain("location_3 ~ '01'")
    })

    it('N2: tokens verbatim sem remoção de zeros à esquerda', () => {
      const filter = buildRawProductFilter('1d01', '')
      expect(filter).toContain("location_3 ~ '01'")
      expect(filter).not.toContain("location_3 ~ '1'") // '01' não vira '1'
    })

    it('N3: SKU misto sem espaço "BL206" vira "bl" e "206"', () => {
      const filter = buildRawProductFilter('BL206', '')
      expect(filter).toContain("reduced_code ~ 'bl'")
      expect(filter).toContain("reduced_code ~ '206'")
    })

    it('SKU puramente numérico "8722" não é quebrado', () => {
      const filter = buildRawProductFilter('8722', '')
      expect(filter).toContain("sku ~ '8722'")
      expect(filter).not.toContain(') && (')
    })

    it('N4: "bucha facão ix35" divide ix35 em "ix" e "35"', () => {
      const filter = buildRawProductFilter('bucha facão ix35', '')
      expect(filter).toContain("name ~ 'bucha'")
      expect(filter).toContain("name ~ 'facao'")
      expect(filter).toContain("name ~ 'ix'")
      expect(filter).toContain("name ~ '35'")
    })
  })
})
