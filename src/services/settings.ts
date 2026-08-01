import pb from '@/lib/pocketbase/client'
import { Settings } from '@/types/crm'

export const getSettings = async (): Promise<Settings | null> => {
  try {
    const list = await pb.collection<Settings>('settings').getList(1, 1)
    return list.items[0] || null
  } catch (_) {
    return null
  }
}

export const saveSettings = async (data: Partial<Settings>): Promise<Settings> => {
  const current = await getSettings()
  if (current) {
    return pb.collection<Settings>('settings').update(current.id, data)
  }
  return pb.collection<Settings>('settings').create(data)
}
