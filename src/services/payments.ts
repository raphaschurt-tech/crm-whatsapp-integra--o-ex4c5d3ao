import pb from '@/lib/pocketbase/client'
import { Payment } from '@/types/crm'

export const getPaymentsForQuote = (quoteId: string) =>
  pb.collection<Payment>('payments').getFullList({
    filter: `quote = "${quoteId}"`,
    sort: '-created',
  })

export const createPayment = (formData: FormData) =>
  pb.collection<Payment>('payments').create(formData)
