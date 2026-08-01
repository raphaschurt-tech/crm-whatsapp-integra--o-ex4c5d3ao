import pb from '@/lib/pocketbase/client'

export const lookupStock = (sku: string) =>
  pb.send<{ sku: string; quantity: number; updated_at: string }>(
    `/backend/v1/stock/lookup?sku=${encodeURIComponent(sku)}`,
    { method: 'GET' },
  )

export const syncStock = () =>
  pb.send<{ updated: number; created: number; success: boolean }>('/backend/v1/stock/sync', {
    method: 'POST',
  })
