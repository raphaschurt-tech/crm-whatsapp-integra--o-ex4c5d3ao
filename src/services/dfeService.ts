import pb from '@/lib/pocketbase/client'
import { DfePointerState, DfeHistoryItem, DfeEventRecord, DfeCommandRecord } from '@/types/crm'

export async function getDfePointerState(): Promise<DfePointerState | null> {
  try {
    const records = await pb.collection('dfe_pointer_state').getList<DfePointerState>(1, 1, {
      sort: '-created',
    })
    return records.items[0] || null
  } catch (err) {
    console.warn('[DFE-POINTER-GET-WARN]', err)
    return null
  }
}

export async function getDfeHistory(
  page = 1,
  perPage = 50,
  filter = '',
): Promise<{ items: DfeHistoryItem[]; totalItems: number }> {
  try {
    const res = await pb.collection('dfe_history').getList<DfeHistoryItem>(page, perPage, {
      sort: '-created',
      filter: filter || undefined,
    })
    return { items: res.items, totalItems: res.totalItems }
  } catch (err) {
    console.warn('[DFE-HIST-GET-WARN]', err)
    return { items: [], totalItems: 0 }
  }
}

export async function getDfeEvents(
  page = 1,
  perPage = 20,
): Promise<{ items: DfeEventRecord[]; totalItems: number }> {
  try {
    const res = await pb.collection('dfe_events').getList<DfeEventRecord>(page, perPage, {
      sort: '-created',
    })
    return { items: res.items, totalItems: res.totalItems }
  } catch (err) {
    console.warn('[DFE-EVENTS-GET-WARN]', err)
    return { items: [], totalItems: 0 }
  }
}

export async function getDfeCommandQueue(
  page = 1,
  perPage = 10,
): Promise<{ items: DfeCommandRecord[]; totalItems: number }> {
  try {
    const res = await pb.collection('dfe_command_queue').getList<DfeCommandRecord>(page, perPage, {
      sort: '-created',
    })
    return { items: res.items, totalItems: res.totalItems }
  } catch (err) {
    console.warn('[DFE-CMDS-GET-WARN]', err)
    return { items: [], totalItems: 0 }
  }
}

export async function enqueueDfeCommand(
  command: 'consultar_agora' | 'importacao_retroativa' | 'reset_ponteiro',
  params: any = {},
): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const res = await pb.send('/backend/v1/dfe/commands/enqueue', {
      method: 'POST',
      body: { command, params },
    })
    return res
  } catch (err: any) {
    throw new Error(err.message || 'Falha ao enfileirar comando DFe.')
  }
}

export async function manageDfeToken(
  action: 'generate' | 'revoke',
): Promise<{ success: boolean; token?: string; message: string }> {
  try {
    const res = await pb.send('/backend/v1/dfe/token/manage', {
      method: 'POST',
      body: { action },
    })
    return res
  } catch (err: any) {
    throw new Error(err.message || 'Falha ao gerenciar token DFe.')
  }
}
