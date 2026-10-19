/**
 * Utilitário de busca tolerante por palavras (estilo Google / substring multi-termo).
 *
 * Requisitos:
 * 1) Dividir o texto digitado em palavras (espaço como separador).
 * 2) Um registro corresponde se cada palavra pesquisada aparecer em QUALQUER parte dos campos pesquisados,
 *    em qualquer ordem (ex.: "bucha band tucson" encontra "BUCHA BANDEJA DA TUCSON").
 * 3) Ignorar maiúsculas/minúsculas e acentos (ex.: "pivo" acha "PIVÔ", "amort mohave" acha "AMORTECEDOR MOHAVE").
 * 4) Ignorar palavras de ligação/stopwords ("da", "de", "do", "das", "dos", "a", "o", "e") como termos obrigatórios,
 *    a menos que TODOS os termos digitados sejam palavras de ligação (fallback).
 */

const STOP_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'a', 'o', 'e'])

/**
 * Remove acentos e converte para minúsculas.
 * Ex: "PIVÔ" -> "pivo", "João da Silva" -> "joao da silva"
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Normaliza a string de busca digitada pelo usuário ANTES da tokenização:
 * (1) substitui separadores `-`, `.`, `/`, `·` por espaço;
 * (2) insere espaço entre junções dígito ↔ letra ("1d01" -> "1 d 01", "2c3" -> "2 c 3", "1D01" -> "1 D 01");
 * N2: Não remove zeros à esquerda, não altera case nem plural.
 * N6: Junção dígito ↔ letra trata maiúsculas e minúsculas identicamente ([0-9][a-zA-Z] e [a-zA-Z][0-9]).
 */
export function normalizeSearchInput(rawQuery: string | null | undefined): string {
  if (!rawQuery) return ''
  return (
    String(rawQuery)
      // (1) Substitui separadores por espaço
      .replace(/[-./·]/g, ' ')
      // (2) Insere espaço entre dígito e letra (ex.: "1d01" -> "1 d01", "1D01" -> "1 D01")
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      // (2) Insere espaço entre letra e dígito (ex.: "d01" -> "d 01", "BL206" -> "BL 206", "ix35" -> "ix 35")
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
  )
}

/**
 * Extrai as palavras-chave do termo de busca digitado pelo usuário.
 * Filtra stopwords a não ser que todas sejam stopwords.
 */
export function extractSearchTokens(rawQuery: string | null | undefined): string[] {
  const preprocessed = normalizeSearchInput(rawQuery)
  const normalized = normalizeSearchText(preprocessed)
  if (!normalized) return []

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  // Filtra palavras de ligação (stopwords)
  const meaningfulWords = words.filter((w) => !STOP_WORDS.has(w))

  // Se o usuário digitou apenas palavras de ligação (ex: "do"), mantém todas
  return meaningfulWords.length > 0 ? meaningfulWords : words
}

/**
 * Verifica se os campos de um registro contêm todas as palavras pesquisadas,
 * em qualquer ordem, como substring em qualquer parte do texto concatenado.
 *
 * @param fields Array de campos de texto do registro (ex.: [p.name, p.sku, p.description, p.supplier])
 * @param rawQuery Termo de busca digitado pelo usuário
 */
export function matchesSearchTokens(
  fields: (string | null | undefined | number)[],
  rawQuery: string | null | undefined,
): boolean {
  const tokens = extractSearchTokens(rawQuery)
  if (tokens.length === 0) return true

  // Concatena e normaliza todos os campos do registro em uma única string indexável
  const haystack = normalizeSearchText(
    fields
      .map((f) => (f !== null && f !== undefined ? String(f) : ''))
      .filter(Boolean)
      .join(' '),
  )

  if (!haystack) return false

  // Cada palavra digitada DEVE aparecer em qualquer parte do haystack (em qualquer ordem)
  return tokens.every((token) => haystack.includes(token))
}

/**
 * Helper de matching de produtos para combobox e listagens.
 * Campos pesquisados: nome, sku, descrição, fornecedor, marca, código de barras,
 * código reduzido, localizações físicas (1, 2, 3) e família SOU.IS.
 */
export function matchProductSearch(
  product: {
    name?: string | null
    sku?: string | null
    description?: string | null
    supplier?: string | null
    brand?: string | null
    barcode?: string | null
    reduced_code?: string | null
    location_1?: string | null
    location_2?: string | null
    location_3?: string | null
    sou_family?: string | null
  },
  rawQuery: string | null | undefined,
): boolean {
  return matchesSearchTokens(
    [
      product.name,
      product.sku,
      product.description,
      product.supplier,
      product.brand,
      product.barcode,
      product.reduced_code,
      product.location_1,
      product.location_2,
      product.location_3,
      product.sou_family,
    ],
    rawQuery,
  )
}

/**
 * Helper de matching de clientes para combobox e listagens.
 * Campos pesquisados: nome, contato, telefone, e-mail, empresa, cpf, cnpj.
 */
export function matchCustomerSearch(
  customer: {
    name?: string | null
    contact_name?: string | null
    phone?: string | null
    email?: string | null
    company?: string | null
    cpf?: string | null
    cnpj?: string | null
  },
  rawQuery: string | null | undefined,
): boolean {
  return matchesSearchTokens(
    [
      customer.name,
      customer.contact_name,
      customer.phone,
      customer.email,
      customer.company,
      customer.cpf,
      customer.cnpj,
    ],
    rawQuery,
  )
}
