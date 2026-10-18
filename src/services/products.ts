import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
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
 * Busca de produtos CRUA sob demanda para inventário / impressão de etiquetas.
 * - SEM allowlist de famílias
 * - SEM ai_excluded_skus
 * - INCLUI inativos (is_active = false)
 * - Busca por SKU, nome, localização ou família
 * - Suporta paginação e busca completa do conjunto filtrado
 */
export const searchRawProducts = async (
  options: SearchRawProductsOptions = {},
): Promise<SearchRawProductsResult> => {
  const { term = '', family = '', page = 1, perPage = 50 } = options

  const cleanTerm = term.trim().replace(/['"\\]/g, '')
  const cleanFamily = family.trim().replace(/['"\\]/g, '')

  const filterClauses: string[] = []

  if (cleanFamily && cleanFamily !== 'all') {
    filterClauses.push(`sou_family = '${cleanFamily}'`)
  }

  if (cleanTerm) {
    // Busca abrangente: sku, nome, código reduzido, barcode e localização
    filterClauses.push(
      `sku ~ '${cleanTerm}' || name ~ '${cleanTerm}' || reduced_code ~ '${cleanTerm}' || barcode ~ '${cleanTerm}' || location_1 ~ '${cleanTerm}' || location_2 ~ '${cleanTerm}' || location_3 ~ '${cleanTerm}'`,
    )
  }

  const filter = filterClauses.length > 0 ? `(${filterClauses.join(') && (')})` : ''

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
  const cleanTerm = term.trim().replace(/['"\\]/g, '')
  const cleanFamily = family.trim().replace(/['"\\]/g, '')

  const filterClauses: string[] = []
  if (cleanFamily && cleanFamily !== 'all') {
    filterClauses.push(`sou_family = '${cleanFamily}'`)
  }
  if (cleanTerm) {
    filterClauses.push(
      `sku ~ '${cleanTerm}' || name ~ '${cleanTerm}' || reduced_code ~ '${cleanTerm}' || barcode ~ '${cleanTerm}' || location_1 ~ '${cleanTerm}' || location_2 ~ '${cleanTerm}' || location_3 ~ '${cleanTerm}'`,
    )
  }

  const filter = filterClauses.length > 0 ? `(${filterClauses.join(') && (')})` : ''

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
