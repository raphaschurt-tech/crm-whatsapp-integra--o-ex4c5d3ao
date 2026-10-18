import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { extractSearchTokens, normalizeSearchText } from '@/lib/fuzzySearch'
import { Product } from '@/types/crm'

export const getProducts = async (): Promise<Product[]> => {
  try {
    return await withRetry(() => pb.collection<Product>('products').getFullList({ sort: 'name' }), {
      retries: 3,
      delayMs: 800,
    })
  } catch (error) {
    console.warn('Erro ao carregar produtos:', error)
    return []
  }
}

export interface SearchRawProductsOptions {
  term?: string
  family?: string
  page?: number
  perPage?: number
}

export interface SearchRawProductsResult {
  items: Product[]
  totalItems: number
  totalPages: number
  page: number
  perPage: number
}

/**
 * Monta o filtro do PocketBase para a busca de produtos crua sob demanda.
 *
 * Requisitos:
 * 1. Tokeniza o termo com extractSearchTokens (ignora stopwords a menos que só haja stopwords).
 * 2. Normaliza cada token com normalizeSearchText e sanitiza aspas/contrabarras.
 * 3. Para cada token, gera uma cláusula OR sobre: sku, name, reduced_code, barcode,
 *    location_1, location_2, location_3, sou_family.
 * 4. Une as cláusulas dos tokens com AND (todas as palavras devem bater em qualquer campo, em qualquer ordem).
 * 5. Combina com o filtro de família (se selecionada).
 */
export function buildRawProductFilter(term: string = '', family: string = ''): string {
  const filterClauses: string[] = []

  const cleanFamily = family.trim().replace(/['"\\]/g, '')
  if (cleanFamily && cleanFamily !== 'all') {
    filterClauses.push(`sou_family = '${cleanFamily}'`)
  }

  // Tokeniza o termo digitado usando o mesmo extrator do fuzzySearch (trata stopwords)
  const rawTokens = extractSearchTokens(term)

  if (rawTokens.length > 0) {
    const tokenClauses = rawTokens
      .map((t) => {
        // Normaliza (sem acento, minúsculo) e remove caracteres perigosos para o filtro do PocketBase
        const clean = normalizeSearchText(t).replace(/['"\\]/g, '')
        if (!clean) return null

        return `(sku ~ '${clean}' || name ~ '${clean}' || reduced_code ~ '${clean}' || barcode ~ '${clean}' || location_1 ~ '${clean}' || location_2 ~ '${clean}' || location_3 ~ '${clean}' || sou_family ~ '${clean}')`
      })
      .filter((clause): clause is string => Boolean(clause))

    if (tokenClauses.length > 0) {
      // Exige que todos os tokens sejam satisfeitos (AND entre tokens)
      filterClauses.push(tokenClauses.join(' && '))
    }
  }

  if (filterClauses.length === 0) return ''
  return filterClauses.length === 1 ? filterClauses[0] : `(${filterClauses.join(') && (')})`
}

/**
 * Busca de produtos CRUA sob demanda para inventário / impressão de etiquetas.
 * - SEM allowlist de famílias
 * - SEM ai_excluded_skus
 * - INCLUI inativos (is_active = false)
 * - Busca por SKU, nome, localização ou família com tolerância multi-termo (AND de tokens em qualquer ordem)
 * - Suporta paginação e busca completa do conjunto filtrado
 */
export const searchRawProducts = async (
  options: SearchRawProductsOptions = {},
): Promise<SearchRawProductsResult> => {
  const { term = '', family = '', page = 1, perPage = 50 } = options

  const filter = buildRawProductFilter(term, family)

  try {
    const res = await withRetry(
      () =>
        pb.collection<Product>('products').getList(page, perPage, {
          filter: filter || undefined,
          sort: 'name',
          requestKey: null,
        }),
      { retries: 2, delayMs: 400 },
    )

    return {
      items: res.items,
      totalItems: res.totalItems,
      totalPages: res.totalPages,
      page: res.page,
      perPage: res.perPage,
    }
  } catch (error) {
    console.warn('Erro na busca crua de produtos:', error)
    return {
      items: [],
      totalItems: 0,
      totalPages: 0,
      page,
      perPage,
    }
  }
}

/**
 * Retorna TODOS os produtos correspondentes ao filtro atual (usado no botão "Selecionar todos filtrados").
 * Busca apenas do conjunto filtrado sob demanda sem carregar o catálogo global.
 */
export const getAllRawFilteredProducts = async (
  options: Omit<SearchRawProductsOptions, 'page' | 'perPage'> = {},
): Promise<Product[]> => {
  const { term = '', family = '' } = options
  const filter = buildRawProductFilter(term, family)

  try {
    return await withRetry(
      () =>
        pb.collection<Product>('products').getFullList({
          filter: filter || undefined,
          sort: 'name',
          requestKey: null,
        }),
      { retries: 2, delayMs: 400 },
    )
  } catch (error) {
    console.warn('Erro ao obter produtos filtrados completos:', error)
    return []
  }
}

export const getProduct = (id: string) => pb.collection<Product>('products').getOne(id)

export const createProduct = (data: Partial<Product>) =>
  pb.collection<Product>('products').create(data)

export const updateProduct = (id: string, data: Partial<Product>) =>
  pb.collection<Product>('products').update(id, data)

export const deleteProduct = (id: string) => pb.collection('products').delete(id)
