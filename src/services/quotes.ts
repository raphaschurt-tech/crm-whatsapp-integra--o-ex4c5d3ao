import pb from '@/lib/pocketbase/client'
import { Quote, QuoteItem } from '@/types/crm'

export const getQuotes = async (): Promise<Quote[]> => {
  try {
    return await pb.collection<Quote>('quotes').getFullList({
      sort: '-created',
      expand: 'customer',
    })
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
