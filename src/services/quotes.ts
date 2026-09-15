import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Quote, QuoteItem } from '@/types/crm'

export const getQuotes = async (): Promise<Quote[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<Quote>('quotes').getFullList({
          sort: '-created',
          expand: 'customer',
        }),
      { retries: 3, delayMs: 800 },
    )
  } catch (error) {
    console.warn('Erro ao carregar orçamentos:', error)
    return []
  }
}

export const getQuote = (id: string) =>
  pb.collection<Quote>('quotes').getOne(id, {
    expand: 'customer',
  })

export const getQuoteItems = (quoteId: string) =>
  pb.collection<QuoteItem>('quote_items').getFullList({
    filter: `quote = "${quoteId}"`,
    expand: 'product',
  })

/**
 * Busca produto por nome ou cria um produto novo no catálogo se não existir
 */
export const findOrCreateProductForPart = async (
  partName: string,
  price: number,
  cost?: number,
  vehicle?: string,
): Promise<string> => {
  const trimmedName = partName.trim()
  try {
    // Tenta encontrar um produto existente com o mesmo nome
    const existing = await pb
      .collection('products')
      .getFirstListItem(`name ~ "${trimmedName.replace(/"/g, '\\"')}"`)
    if (existing && existing.id) {
      return existing.id
    }
  } catch (_) {
    // Não encontrado, vamos criar
  }

  // Gera um SKU amigável
  const cleanPrefix =
    trimmedName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .slice(0, 10)
      .replace(/^-+|-+$/g, '') || 'PEC'
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  const sku = `${cleanPrefix}-${randomSuffix}`

  const desc = vehicle
    ? `Peça avulsa para ${vehicle}`
    : 'Item gerado a partir do Pipeline de Compras'

  try {
    const newProd = await pb.collection('products').create({
      name: trimmedName,
      sku: sku,
      price: price > 0 ? price : 0,
      cost: cost && cost > 0 ? cost : 0,
      stock_quantity: 0,
      min_stock: 0,
      description: desc,
      product_type: 'comprado',
      is_purchased: true,
    })
    return newProd.id
  } catch (err) {
    console.warn('Erro ao criar produto automático no catálogo:', err)
    // Se falhar na criação do produto, busca o primeiro produto qualquer como fallback seguro
    try {
      const fallbackList = await pb.collection('products').getList(1, 1)
      if (fallbackList.items.length > 0) {
        return fallbackList.items[0].id
      }
    } catch {
      /* intentionally ignored */
    }
    return ''
  }
}

export const generateQuoteNumber = async (): Promise<string> => {
  const year = new Date().getFullYear()
  const list = await pb.collection<Quote>('quotes').getList(1, 1, {
    sort: '-created',
  })
  let seq = 1
  if (list.items.length > 0) {
    const lastNum = list.items[0].number
    const parts = lastNum.split('-')
    if (parts.length === 3) {
      const parsed = parseInt(parts[2], 10)
      if (!isNaN(parsed)) seq = parsed + 1
    }
  }
  return `ORC-${year}-${seq.toString().padStart(4, '0')}`
}

export const createQuoteWithItems = async (
  quoteData: Partial<Quote>,
  items: Array<{ product: string; quantity: number; unit_price: number; total: number }>,
) => {
  if (!quoteData.number) {
    quoteData.number = await generateQuoteNumber()
  }
  if (!quoteData.payment_token) {
    quoteData.payment_token = 'tok_' + Math.random().toString(36).substring(2, 11)
  }

  const newQuote = await pb.collection<Quote>('quotes').create(quoteData)

  for (const item of items) {
    await pb.collection<QuoteItem>('quote_items').create({
      quote: newQuote.id,
      product: item.product,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.total,
    })
  }

  return newQuote
}

export const updateQuoteWithItems = async (
  quoteId: string,
  quoteData: Partial<Quote>,
  items: Array<{
    id?: string
    product: string
    quantity: number
    unit_price: number
    total: number
  }>,
) => {
  const updated = await pb.collection<Quote>('quotes').update(quoteId, quoteData)

  const existingItems = await pb.collection<QuoteItem>('quote_items').getFullList({
    filter: `quote = "${quoteId}"`,
  })

  const newIds = new Set(items.map((i) => i.id).filter(Boolean))
  for (const ex of existingItems) {
    if (!newIds.has(ex.id)) {
      await pb.collection('quote_items').delete(ex.id)
    }
  }

  for (const item of items) {
    if (item.id) {
      await pb.collection<QuoteItem>('quote_items').update(item.id, {
        product: item.product,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      })
    } else {
      await pb.collection<QuoteItem>('quote_items').create({
        quote: quoteId,
        product: item.product,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      })
    }
  }

  return updated
}

export const updateQuoteStatus = (id: string, status: Quote['status']) =>
  pb.collection<Quote>('quotes').update(id, { status })

export const deleteQuote = (id: string) => pb.collection('quotes').delete(id)

export const sendWhatsAppMessage = async (
  phone: string,
  message: string,
): Promise<{
  ok: boolean
  zapiSuccess: boolean
  zapiHttpStatus?: number
  zapiError?: string | null
  messageId?: string
}> => {
  return await pb.send('/backend/v1/whatsapp/send-message', {
    method: 'POST',
    body: { phone, message },
  })
}

export const sendQuoteEmail = async (
  quoteId: string,
  email: string,
  subject: string,
  message: string,
): Promise<{
  ok: boolean
  sent: boolean
  error?: string | null
}> => {
  return await pb.send('/backend/v1/quotes/send-email', {
    method: 'POST',
    body: { quote_id: quoteId, email, subject, message },
  })
}
