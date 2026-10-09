import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Customer, Quote } from '@/types/crm'
import {
  getCustomers,
  populateCustomerCache,
  getLastKnownCustomer,
  getPhoneVariants,
} from '@/services/customers'
import { getQuotes } from '@/services/quotes'
import { RecordModel } from 'pocketbase'

export type WhatsAppSender = 'client' | 'agent' | 'ai'
export type WhatsAppStatus = 'novo' | 'em_atendimento' | 'resolvido'

export interface WhatsAppMessage {
  id: string
  text: string
  time: string
  sender: WhatsAppSender
  timestamp: number
  messageId?: string
  isAudio?: boolean
  audioUrl?: string
  attachmentUrl?: string
  attachmentName?: string
  attachmentType?: 'image' | 'video' | 'document' | 'audio'
}

export interface WhatsAppCustomer {
  id: string
  customerId?: string
  name: string
  type: 'PF' | 'PJ'
  phone: string
  rawPhone: string
  company?: string
  status: WhatsAppStatus
  unreadCount?: number
  lastReadAt?: number
  lastActivity: string
  lastTimestamp: number
  messages: WhatsAppMessage[]
  quotes?: Quote[]
}

export interface LoadWhatsAppConversationsOptions {
  /**
   * Janela em dias para carga inicial (ex: 60 dias). Se omitido ou <= 0, carrega todo o histórico.
   */
  daysWindow?: number
  /**
   * Termo de busca para puxar sob demanda do banco (texto, nome ou telefone) além da janela
   */
  searchQuery?: string
  /**
   * Filtrar por telefone específico
   */
  phoneFilter?: string
  /**
   * Cursor congelado T0 para reusar entre cargas sucessivas (ex: carga sob demanda mantendo estabilidade)
   */
  frozenT0Iso?: string
}

/**
 * Janela temporal padrão em dias para a carga inicial do Atendimento (60 dias)
 */
export const DEFAULT_WHATSAPP_DAYS_WINDOW = 60

/**
 * Realiza o merge estritamente idempotente de duas listas de conversas do WhatsApp (por id / rawPhone),
 * preservando dados mais completos (nome de cadastro, mensagens sem duplicação e ordenadas por tempo,
 * status mais recente e unreadCount).
 */
export function mergeWhatsAppCustomers(
  baseList: WhatsAppCustomer[],
  incomingList: WhatsAppCustomer[],
): WhatsAppCustomer[] {
  const map = new Map<string, WhatsAppCustomer>()

  const getKey = (c: WhatsAppCustomer) => {
    const raw = c.rawPhone || c.phone
    const norm = normalizePhoneKey(raw)
    return norm || c.id
  }

  // Insere baseList
  for (const item of baseList) {
    map.set(getKey(item), item)
  }

  // Faz o merge com incomingList
  for (const incoming of incomingList) {
    const key = getKey(incoming)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, incoming)
      continue
    }

    // Merge de mensagens deduplicando por id / messageId / (sender + text + timestamp aproximado)
    const seenMsgIds = new Set<string>()
    const mergedMessages: WhatsAppMessage[] = []

    const pushMsg = (m: WhatsAppMessage) => {
      const uniqueKey = m.messageId ? `mid-${m.messageId}` : m.id
      if (seenMsgIds.has(uniqueKey)) return
      seenMsgIds.add(uniqueKey)

      const isDupe = mergedMessages.some(
        (prev) =>
          prev.sender === m.sender &&
          prev.text.trim() === m.text.trim() &&
          Math.abs(prev.timestamp - m.timestamp) < 5000,
      )
      if (!isDupe) {
        mergedMessages.push(m)
      }
    }

    for (const m of existing.messages || []) pushMsg(m)
    for (const m of incoming.messages || []) pushMsg(m)
    mergedMessages.sort((a, b) => a.timestamp - b.timestamp)

    const lastMsg = mergedMessages[mergedMessages.length - 1]
    const lastActivity = lastMsg ? lastMsg.time : existing.lastActivity || incoming.lastActivity
    const lastTimestamp = lastMsg ? lastMsg.timestamp : Math.max(existing.lastTimestamp || 0, incoming.lastTimestamp || 0)

    // Preserva o nome de cliente cadastrado caso uma iteração traga apenas o número de telefone
    const isExistingPhoneOnly = existing.name === existing.phone || !existing.name
    const isIncomingPhoneOnly = incoming.name === incoming.phone || !incoming.name
    let chosenName = incoming.name
    if (isIncomingPhoneOnly && !isExistingPhoneOnly) {
      chosenName = existing.name
    }

    const merged: WhatsAppCustomer = {
      ...existing,
      ...incoming,
      id: existing.customerId || incoming.customerId || existing.id || incoming.id,
      customerId: existing.customerId || incoming.customerId,
      name: chosenName || existing.name || incoming.name,
      company: existing.company || incoming.company,
      messages: mergedMessages,
      lastActivity,
      lastTimestamp,
      lastReadAt: Math.max(existing.lastReadAt || 0, incoming.lastReadAt || 0),
      unreadCount: Math.max(existing.unreadCount || 0, incoming.unreadCount || 0),
      quotes: incoming.quotes && incoming.quotes.length > 0 ? incoming.quotes : existing.quotes,
    }

    map.set(key, merged)
  }

  const result = Array.from(map.values())
  result.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
  return result
}
export interface WhatsAppReadStateRecord extends RecordModel {
  phone: string
  lastReadAt: number
}

export interface WebhookReceivedRecord extends RecordModel {
  type?: string
  phone?: any
  fromMe?: boolean
  text?: any
  chat?: any
  sender?: any
  status?: string
  messageId?: string
  instanceId?: string
  moment?: number
  is_audio?: boolean
  audio_url?: string
  attachment_url?: string
  attachment_name?: string
  attachment_type?: string
}

export interface MessageProcessingRecord extends RecordModel {
  messageId: string
  phone: string
  status: 'received' | 'processing' | 'completed' | 'failed'
  replySent?: boolean
  incomingText?: string
  aiReplyText?: string
  aiModel?: string
  zapiStatus?: number
  errorMessage?: string
  retryCount?: number
  is_audio?: boolean
  audio_url?: string
}

/**
 * Verifica se um valor de telefone representa um WhatsApp LID (Linked Identity)
 * ou grupo que não deve gerar conversa separada
 */
export function isLidOrGroup(phoneVal: any): boolean {
  if (!phoneVal) return false
  const s =
    typeof phoneVal === 'object'
      ? String(phoneVal.phone || phoneVal.number || phoneVal.id || phoneVal.chatId || '')
      : String(phoneVal)
  if (s.toLowerCase().includes('@lid') || s.toLowerCase().includes('@g.us')) return true
  const digits = s.replace(/\D/g, '')
  // Telefones normais no Brasil com DDI 55 têm 12 (fixo) ou 13 dígitos (celular).
  // LIDs possuem 14 ou mais dígitos (ex: 224429321781298, 134196773261537)
  if (digits.length >= 14) return true
  return false
}

/**
 * Extrai telefone normalizado de qualquer estrutura (objeto ou string).
 * Retorna string vazia caso o telefone seja um @lid, grupo ou número não-telefônico inválido.
 */
export function extractNormalizedPhone(phoneVal: any): string {
  if (!phoneVal) return ''
  let raw = ''
  if (typeof phoneVal === 'string') {
    raw = phoneVal
  } else if (typeof phoneVal === 'object') {
    raw = String(phoneVal.phone || phoneVal.number || phoneVal.id || phoneVal.chatId || '')
  }
  if (raw.toLowerCase().includes('@g.us')) return ''
  if (raw.toLowerCase().includes('@lid')) return ''

  if (raw.includes('@')) {
    raw = raw.split('@')[0]
  }
  const digits = raw.replace(/\D/g, '')
  // Se tiver 14 ou mais dígitos ou menos de 8 dígitos, não é um número de telefone válido de cliente
  if (digits.length >= 14 || digits.length < 8) {
    return ''
  }
  return digits
}

/**
 * Extrai texto da mensagem de qualquer estrutura
 */
export function extractMessageText(textVal: any): string {
  if (!textVal) return ''
  if (typeof textVal === 'string') return textVal.trim()
  if (typeof textVal === 'object') {
    return String(textVal.message || textVal.text || textVal.conversation || '').trim()
  }
  return ''
}

/**
 * Formata um timestamp ou string ISO em exibição de hora ou data
 */
export function formatActivityTime(dateInput: Date | number | string): string {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return ''

  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()

  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const timeStr = `${hours}:${minutes}`

  if (isToday) {
    return timeStr
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()

  if (isYesterday) {
    return `Ontem ${timeStr}`
  }

  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month} ${timeStr}`
}

/**
 * Formata número de telefone brasileiro para exibição legível
 */
export function formatPhoneDisplay(phoneStr: string): string {
  const clean = phoneStr.replace(/\D/g, '')
  if (clean.length === 13 && clean.startsWith('55')) {
    const ddd = clean.slice(2, 4)
    const part1 = clean.slice(4, 9)
    const part2 = clean.slice(9)
    return `(${ddd}) ${part1}-${part2}`
  }
  if (clean.length === 12 && clean.startsWith('55')) {
    const ddd = clean.slice(2, 4)
    const part1 = clean.slice(4, 8)
    const part2 = clean.slice(8)
    return `(${ddd}) ${part1}-${part2}`
  }
  if (clean.length === 11) {
    const ddd = clean.slice(0, 2)
    const part1 = clean.slice(2, 7)
    const part2 = clean.slice(7)
    return `(${ddd}) ${part1}-${part2}`
  }
  if (clean.length === 10) {
    const ddd = clean.slice(0, 2)
    const part1 = clean.slice(2, 6)
    const part2 = clean.slice(6)
    return `(${ddd}) ${part1}-${part2}`
  }
  return phoneStr
}

/**
 * Normaliza uma chave de telefone para busca e persistência de leitura (sempre com 55 se 10/11 dígitos)
 */
export function normalizePhoneKey(phone: string): string {
  const norm = extractNormalizedPhone(phone)
  if (!norm) return phone.replace(/\D/g, '')
  if (norm.length === 10 || norm.length === 11) {
    return `55${norm}`
  }
  return norm
}

/**
 * Carrega todos os registros de leitura persistidos
 */
export async function loadWhatsAppReadStates(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const list = await withRetry(
      () =>
        pb
          .collection<WhatsAppReadStateRecord>('whatsapp_read_states')
          .getFullList({ sort: '-updated' }),
      { retries: 2, delayMs: 400 },
    )
    for (const rec of list) {
      if (rec.phone && typeof rec.lastReadAt === 'number') {
        const key = normalizePhoneKey(rec.phone)
        map.set(key, rec.lastReadAt)
      }
    }
  } catch (err) {
    console.warn('Erro ao carregar whatsapp_read_states:', err)
  }
  return map
}

// In-flight saving map para evitar concorrência de gravações da mesma conversa
const inFlightReadStateSaves = new Map<string, Promise<void>>()
// Cache do ID de read state por phone para acelerar e evitar concorrência
const readStateIdCache = new Map<string, string>()

/**
 * Marca uma conversa como lida até o timestamp especificado no banco PocketBase
 * Implementa upsert defensivo com in-flight dedup e tratamento para conflitos (erro 400).
 */
export async function markWhatsAppAsRead(rawPhone: string, readTimestamp: number): Promise<void> {
  if (!rawPhone || !readTimestamp) return
  const key = normalizePhoneKey(rawPhone)
  if (!key) return

  // Deduplicação defensiva in-flight para não disputar o mesmo registro
  if (inFlightReadStateSaves.has(key)) {
    return inFlightReadStateSaves.get(key)
  }

  const savePromise = (async () => {
    try {
      await withRetry(
        async () => {
          await persistReadStateRecord(key, readTimestamp)
        },
        { retries: 2, delayMs: 400 },
      )
    } catch (err) {
      console.warn(`[markWhatsAppAsRead] Falha ao marcar leitura para ${key}:`, err)
    } finally {
      inFlightReadStateSaves.delete(key)
    }
  })()

  inFlightReadStateSaves.set(key, savePromise)
  return savePromise
}

async function persistReadStateRecord(key: string, readTimestamp: number): Promise<void> {
  // 1. Tentar atualizar diretamente se já conhecemos o ID pelo cache
  const cachedId = readStateIdCache.get(key)
  if (cachedId) {
    try {
      await pb.collection('whatsapp_read_states').update(cachedId, { lastReadAt: readTimestamp })
      return
    } catch (err: any) {
      if (err?.status === 404) {
        readStateIdCache.delete(key)
      } else {
        throw err
      }
    }
  }

  // 2. Tenta encontrar registro existente por phone
  let existingRecord: WhatsAppReadStateRecord | null = null
  try {
    existingRecord = await pb
      .collection<WhatsAppReadStateRecord>('whatsapp_read_states')
      .getFirstListItem(`phone = "${key}"`)
  } catch (_) {
    // Registro não existe ainda
  }

  if (existingRecord) {
    readStateIdCache.set(key, existingRecord.id)
    if (readTimestamp >= (existingRecord.lastReadAt || 0)) {
      await pb
        .collection('whatsapp_read_states')
        .update(existingRecord.id, { lastReadAt: readTimestamp })
    }
  } else {
    // Se duas chamadas disputarem a criação simultânea, o create pode falhar com 400 (unique constraint).
    // Nesse caso, recuperamos o registro recém-criado e atualizamos.
    try {
      const created = await pb.collection<WhatsAppReadStateRecord>('whatsapp_read_states').create({
        phone: key,
        lastReadAt: readTimestamp,
      })
      readStateIdCache.set(key, created.id)
    } catch (createErr: any) {
      try {
        const found = await pb
          .collection<WhatsAppReadStateRecord>('whatsapp_read_states')
          .getFirstListItem(`phone = "${key}"`)
        if (found) {
          readStateIdCache.set(key, found.id)
          await pb
            .collection('whatsapp_read_states')
            .update(found.id, { lastReadAt: readTimestamp })
        }
      } catch (recoveryErr) {
        console.warn(
          `[persistReadStateRecord] Conflito de gravação recuperado para ${key}:`,
          recoveryErr,
        )
      }
    }
  }
}

/**
 * Busca registros paginados com Cursor Congelado (created <= T0) e merge idempotente.
 * Valida a integridade (total carregado vs total esperado) e reexecuta páginas faltantes se houver lacuna.
 *
 * NOTA DE DIAGNÓSTICO DE SORT:
 * O sort utilizado na paginação é 'created' (ascendente).
 * No sort ascendente (created), se novas mensagens chegassem concorrentemente durante a paginação,
 * o número total aumentaria, mas os itens novos entrariam no FINAL do dataset;
 * porém sem filtro de limite temporal superior (T0), a variação do total e os limites de página
 * geravam inconsistência entre as coleções ou perda de fronteira.
 * Com sort '-created' (decrescente), uma mensagem nova inserida desloca o ÍNDICE ZERO (o início de todas as páginas),
 * fazendo o offset pular registros da página anterior.
 * Ao congelar o cursor com `created <= T0`, a fronteira temporal fica 100% estática independente da direção do sort,
 * eliminando corridas por construção.
 */
async function fetchPagedCollectionWithFrozenCursor<T extends RecordModel>(
  collectionName: 'webhook_received' | 'message_processing',
  t0Iso: string,
  extraFilter = '',
  pageSize = 500,
): Promise<T[]> {
  const baseFilterParts = [`created <= "${t0Iso}"`]
  if (extraFilter && extraFilter.trim()) {
    baseFilterParts.push(`(${extraFilter.trim()})`)
  }
  const fullFilter = baseFilterParts.join(' && ')

  // 1. Obter a primeira página e o total esperado no momento do congelamento
  const firstPageRes = await withRetry(
    () =>
      pb.collection<T>(collectionName).getList(1, pageSize, {
        filter: fullFilter,
        sort: 'created',
      }),
    { retries: 3, delayMs: 600 },
  )

  const expectedTotal = firstPageRes.totalItems
  const totalPages = firstPageRes.totalPages

  // 2. Armazenar em Map para merge estritamente idempotente (conjunto, nunca duplica nem pula por ID)
  const itemsById = new Map<string, T>()
  for (const item of firstPageRes.items) {
    itemsById.set(item.id, item)
  }

  // Se tem mais páginas, carregar sequencialmente/paralelamente de forma resiliente
  if (totalPages > 1) {
    for (let page = 2; page <= totalPages; page++) {
      try {
        const pageRes = await withRetry(
          () =>
            pb.collection<T>(collectionName).getList(page, pageSize, {
              filter: fullFilter,
              sort: 'created',
            }),
          { retries: 3, delayMs: 500 },
        )
        for (const item of pageRes.items) {
          itemsById.set(item.id, item)
        }
      } catch (pageErr) {
        console.warn(`[CONV-LOAD] Falha ao carregar página ${page} de ${collectionName}:`, pageErr)
      }
    }
  }

  // 3. Validação de integridade (2ª linha de defesa):
  // Se o total carregado for menor que o esperado, verificar lacunas e rebuscar uma vez
  if (itemsById.size < expectedTotal) {
    console.warn(
      `[CONV-LOAD] [${collectionName}] Lacuna detectada: carregados ${itemsById.size} de ${expectedTotal} esperados. Rebuscando páginas faltantes...`,
    )
    for (let page = 1; page <= totalPages; page++) {
      // Se não atingiu o total, faz uma repassagem
      try {
        const retryRes = await pb.collection<T>(collectionName).getList(page, pageSize, {
          filter: fullFilter,
          sort: 'created',
        })
        for (const item of retryRes.items) {
          itemsById.set(item.id, item)
        }
        if (itemsById.size >= expectedTotal) break
      } catch (retryErr) {
        console.warn(`[CONV-LOAD] Repassagem falhou na página ${page}:`, retryErr)
      }
    }
  }

  console.log(
    `[CONV-LOAD] [${collectionName}] Total carregado: ${itemsById.size} | Esperado: ${expectedTotal} (T0: ${t0Iso})`,
  )

  return Array.from(itemsById.values())
}

/**
 * Carrega mensagens de um cliente específico sob demanda por telefone
 */
export async function loadCustomerConversationMessages(
  rawPhone: string,
): Promise<WhatsAppMessage[]> {
  if (!rawPhone) return []
  const norm = extractNormalizedPhone(rawPhone)
  if (!norm) return []
  const variants = getPhoneVariants(norm)

  const filterPartsWebhook = variants.map(
    (v) => `phone ~ "${v}" || chat ~ "${v}" || sender ~ "${v}"`,
  )
  const filterWebhook = filterPartsWebhook.join(' || ')

  const filterPartsProc = variants.map((v) => `phone ~ "${v}"`)
  const filterProc = filterPartsProc.join(' || ')

  const [webhookList, processingList] = await Promise.all([
    withRetry(
      () =>
        pb.collection<WebhookReceivedRecord>('webhook_received').getFullList({
          filter: filterWebhook,
          sort: 'created',
        }),
      { retries: 2, delayMs: 400 },
    ).catch(() => [] as WebhookReceivedRecord[]),
    withRetry(
      () =>
        pb.collection<MessageProcessingRecord>('message_processing').getFullList({
          filter: filterProc,
          sort: 'created',
        }),
      { retries: 2, delayMs: 400 },
    ).catch(() => [] as MessageProcessingRecord[]),
  ])

  // Mapear respostas de IA para evitar ecos
  const aiReplies: Array<{ text: string; time: number }> = []
  for (const proc of processingList) {
    const reply = (proc.aiReplyText || '').trim()
    if (reply && (proc.replySent || proc.status === 'completed')) {
      aiReplies.push({
        text: reply,
        time: new Date(proc.created).getTime(),
      })
    }
  }

  const messagesMap = new Map<string, WhatsAppMessage>()
  const seenMessageIds = new Set<string>()

  // 1. Mensagens do webhook
  for (const rec of webhookList) {
    let text = extractMessageText(rec.text)
    const hasAttachment = Boolean(rec.attachment_url)
    if (!text && !hasAttachment) continue
    if (!text && hasAttachment) {
      text = rec.attachment_name ? `Arquivo: ${rec.attachment_name}` : ''
    }

    const isFromMe = Boolean(rec.fromMe)
    const msgDate = rec.moment ? new Date(rec.moment * 1000) : new Date(rec.created)
    const timestamp = msgDate.getTime()
    const timeStr = formatActivityTime(msgDate)

    if (isFromMe && rec.type !== 'AgentSentMessage') {
      const isAiEcho = aiReplies.some(
        (ai) =>
          (ai.text === text || text.startsWith(ai.text.slice(0, 50))) &&
          Math.abs(timestamp - ai.time) < 30 * 60 * 1000,
      )
      if (isAiEcho) continue
    }

    let sender: WhatsAppSender = 'client'
    if (isFromMe) {
      const senderRole =
        rec.sender && typeof rec.sender === 'object'
          ? String(rec.sender.role || rec.sender.type || '')
          : ''
      const recType = String(rec.type || '')
      const msgIdStr = String(rec.messageId || '')

      if (
        senderRole === 'agent' ||
        recType === 'AgentSentMessage' ||
        msgIdStr.startsWith('agent_')
      ) {
        sender = 'agent'
      } else if (senderRole === 'ai' || recType === 'AISentMessage') {
        sender = 'ai'
      } else {
        sender = 'agent'
      }
    }

    const msgId = `wh-${rec.id}`
    messagesMap.set(msgId, {
      id: msgId,
      text,
      time: timeStr,
      sender,
      timestamp,
      messageId: rec.messageId,
      isAudio: Boolean(rec.is_audio),
      audioUrl: rec.audio_url || undefined,
      attachmentUrl: rec.attachment_url || undefined,
      attachmentName: rec.attachment_name || undefined,
      attachmentType:
        rec.attachment_type === 'image' ||
        rec.attachment_type === 'video' ||
        rec.attachment_type === 'document' ||
        rec.attachment_type === 'audio'
          ? (rec.attachment_type as 'image' | 'video' | 'document' | 'audio')
          : undefined,
    })

    if (rec.messageId) {
      seenMessageIds.add(rec.messageId)
    }
  }

  // 2. Mensagens do message_processing
  for (const proc of processingList) {
    if (proc.incomingText && proc.messageId && !seenMessageIds.has(proc.messageId)) {
      const procDate = new Date(proc.created)
      const msgId = `proc-in-${proc.id}`
      messagesMap.set(msgId, {
        id: msgId,
        text: proc.incomingText,
        time: formatActivityTime(procDate),
        sender: 'client',
        timestamp: procDate.getTime(),
        messageId: proc.messageId,
        isAudio: Boolean(proc.is_audio),
        audioUrl: proc.audio_url || undefined,
      })
      seenMessageIds.add(proc.messageId)
    }

    if (proc.aiReplyText && (proc.replySent || proc.status === 'completed')) {
      const replyDate = new Date(proc.updated || proc.created)
      const msgId = `proc-ai-${proc.id}`
      messagesMap.set(msgId, {
        id: msgId,
        text: proc.aiReplyText,
        time: formatActivityTime(replyDate),
        sender: 'ai',
        timestamp: replyDate.getTime(),
      })
    }
  }

  const list = Array.from(messagesMap.values())
  list.sort((a, b) => a.timestamp - b.timestamp)
  return list
}

/**
 * Carrega conversas reais do WhatsApp do banco de dados PocketBase com:
 * 1. Cursor congelado (created <= T0) para estabilidade absoluta durante paginação concorrente com o WhatsApp
 * 2. Merge idempotente por ID de registro (Map/dedupe)
 * 3. Validação de integridade: checagem de lacuna entre total esperado e total carregado
 * 4. Janela temporal configurável (default 60 dias para Atendimento; ilimitada para busca completa/específica)
 * 5. Suporte a busca sob demanda além da janela temporal por termo ou telefone
 */
export async function loadWhatsAppConversations(
  options: LoadWhatsAppConversationsOptions = {},
): Promise<WhatsAppCustomer[]> {
  try {
    const { daysWindow, searchQuery, phoneFilter, frozenT0Iso } = options

    // Captura o cursor congelado T0 no início exato da carga ou reusa o T0 fornecido
    const t0Iso = frozenT0Iso && frozenT0Iso.trim() ? frozenT0Iso.trim() : new Date().toISOString()
    const t0Date = new Date(t0Iso)

    // Construção do filtro temporal se janela for informada e não houver busca sob demanda ampla
    let timeFilter = ''
    if (daysWindow && daysWindow > 0 && !searchQuery) {
      const windowStartDate = new Date(t0Date.getTime() - daysWindow * 24 * 60 * 60 * 1000)
      const windowStartIso = windowStartDate.toISOString()
      timeFilter = `created >= "${windowStartIso}"`
    }

    // Se houver busca sob demanda por texto, nome ou telefone, montar extraFilter
    let extraFilterWebhook = timeFilter
    let extraFilterProc = timeFilter

    if (phoneFilter) {
      const norm = extractNormalizedPhone(phoneFilter)
      const variants = norm ? getPhoneVariants(norm) : [phoneFilter]
      const fWebhook = variants
        .map((v) => `phone ~ "${v}" || chat ~ "${v}" || sender ~ "${v}"`)
        .join(' || ')
      const fProc = variants.map((v) => `phone ~ "${v}"`).join(' || ')
      extraFilterWebhook = extraFilterWebhook
        ? `(${extraFilterWebhook}) && (${fWebhook})`
        : fWebhook
      extraFilterProc = extraFilterProc ? `(${extraFilterProc}) && (${fProc})` : fProc
    } else if (searchQuery && searchQuery.trim()) {
      const cleanTerm = searchQuery.trim().replace(/["\\]/g, '')
      const cleanDigits = cleanTerm.replace(/\D/g, '')

      // 1. Se tem dígitos suficientes para ser telefone
      if (cleanDigits.length >= 4) {
        const norm = extractNormalizedPhone(cleanDigits) || cleanDigits
        const variants = getPhoneVariants(norm)
        const phoneWebhookParts = variants.map(
          (v) => `phone ~ "${v}" || chat ~ "${v}" || sender ~ "${v}"`,
        )
        const phoneProcParts = variants.map((v) => `phone ~ "${v}"`)

        // Pode ser busca mista (ex: texto que tem números ou telefone direto)
        const textWebhook = `text ~ "${cleanTerm}"`
        const textProc = `incomingText ~ "${cleanTerm}" || aiReplyText ~ "${cleanTerm}"`

        extraFilterWebhook = `(${phoneWebhookParts.join(' || ')}) || (${textWebhook})`
        extraFilterProc = `(${phoneProcParts.join(' || ')}) || (${textProc})`
      } else {
        // 2. Busca textual pura: texto da mensagem no webhook ou message_processing
        // Também pode casar com clientes cujo nome contenha o termo (carregamos clientes e seus telefones abaixo)
        const matchedCusts = await pb
          .collection<Customer>('customers')
          .getList(1, 50, {
            filter: `name ~ "${cleanTerm}" || company ~ "${cleanTerm}"`,
          })
          .catch(() => ({ items: [] as Customer[] }))

        const custPhoneVariants = new Set<string>()
        for (const cust of matchedCusts.items) {
          if (cust.phone) {
            const n = extractNormalizedPhone(cust.phone)
            const vars = n ? getPhoneVariants(n) : [cust.phone]
            for (const v of vars) custPhoneVariants.add(v)
          }
        }

        const webhookConditions = [`text ~ "${cleanTerm}"`]
        const procConditions = [
          `incomingText ~ "${cleanTerm}"`,
          `aiReplyText ~ "${cleanTerm}"`,
        ]

        if (custPhoneVariants.size > 0) {
          const varArray = Array.from(custPhoneVariants).slice(0, 30)
          const phoneWParts = varArray.map(
            (v) => `phone ~ "${v}" || chat ~ "${v}" || sender ~ "${v}"`,
          )
          const phonePParts = varArray.map((v) => `phone ~ "${v}"`)
          webhookConditions.push(...phoneWParts)
          procConditions.push(...phonePParts)
        }

        extraFilterWebhook = webhookConditions.join(' || ')
        extraFilterProc = procConditions.join(' || ')
      }
    }

    const [webhookList, processingList, customersList, readStatesMap, allQuotesList] =
      await Promise.all([
        fetchPagedCollectionWithFrozenCursor<WebhookReceivedRecord>(
          'webhook_received',
          t0Iso,
          extraFilterWebhook,
        ).catch((err) => {
          console.warn('Erro ao carregar webhook_received com cursor congelado:', err)
          return [] as WebhookReceivedRecord[]
        }),
        fetchPagedCollectionWithFrozenCursor<MessageProcessingRecord>(
          'message_processing',
          t0Iso,
          extraFilterProc,
        ).catch((err) => {
          console.warn('Erro ao carregar message_processing com cursor congelado:', err)
          return [] as MessageProcessingRecord[]
        }),
        getCustomers().catch(() => [] as Customer[]),
        loadWhatsAppReadStates().catch(() => new Map<string, number>()),
        getQuotes().catch(() => [] as Quote[]),
      ])

    // Mapa de quotes por customerId
    const quotesByCustomerId = new Map<string, Quote[]>()
    for (const q of allQuotesList) {
      if (!q.customer) continue
      const list = quotesByCustomerId.get(q.customer) || []
      list.push(q)
      quotesByCustomerId.set(q.customer, list)
    }

    // Popula o cache global centralizado de clientes
    if (customersList.length > 0) {
      populateCustomerCache(customersList)
    }

    // Mapa de clientes para rápida associação por telefone cobrindo TODAS as variantes
    const customerMap = new Map<string, Customer>()
    for (const c of customersList) {
      if (!c) continue
      const variants = getPhoneVariants(c.phone || '')
      for (const v of variants) {
        if (!customerMap.has(v)) {
          customerMap.set(v, c)
        }
      }
    }

    // Mapa de conversas agrupadas por chave de telefone
    const conversations = new Map<
      string,
      {
        phoneKey: string
        rawPhone: string
        messages: WhatsAppMessage[]
      }
    >()

    const getOrCreateConv = (rawP: string) => {
      const normalized = extractNormalizedPhone(rawP)
      let key = normalized
      if (key.length === 10 || key.length === 11) {
        key = `55${key}`
      }

      if (!conversations.has(key)) {
        conversations.set(key, {
          phoneKey: key,
          rawPhone: rawP || key,
          messages: [],
        })
      }
      return conversations.get(key)!
    }

    // Conjunto de messageIds para evitar duplicidade entre webhook e message_processing
    const seenMessageIds = new Set<string>()

    // Conjunto de respostas da IA já mapeadas de message_processing por telefone e texto (para ignorar ecos)
    const aiRepliesByPhone = new Map<string, Array<{ text: string; time: number }>>()
    for (const proc of processingList) {
      if (!proc.phone) continue
      const norm = extractNormalizedPhone(proc.phone)
      if (!norm) continue
      const key = norm.length === 10 || norm.length === 11 ? `55${norm}` : norm
      const reply = (proc.aiReplyText || '').trim()
      if (reply && (proc.replySent || proc.status === 'completed')) {
        const list = aiRepliesByPhone.get(key) || []
        list.push({
          text: reply,
          time: new Date(proc.created).getTime(),
        })
        aiRepliesByPhone.set(key, list)
      }
    }

    // 1. Processar webhook_received
    for (const rec of webhookList) {
      let normalized = extractNormalizedPhone(rec.phone)
      if (!normalized) {
        normalized = extractNormalizedPhone(rec.chat)
      }
      if (!normalized) {
        normalized = extractNormalizedPhone(rec.sender)
      }

      if (!normalized) continue

      let text = extractMessageText(rec.text)
      const hasAttachment = Boolean(rec.attachment_url)
      if (!text && !hasAttachment) continue
      if (!text && hasAttachment) {
        text = rec.attachment_name ? `Arquivo: ${rec.attachment_name}` : ''
      }

      const isFromMe = Boolean(rec.fromMe)
      const msgDate = rec.moment ? new Date(rec.moment * 1000) : new Date(rec.created)
      const timestamp = msgDate.getTime()
      const timeStr = formatActivityTime(msgDate)

      const phoneKey =
        normalized.length === 10 || normalized.length === 11 ? `55${normalized}` : normalized

      if (isFromMe && rec.type !== 'AgentSentMessage') {
        const aiList = aiRepliesByPhone.get(phoneKey) || []
        const isAiEcho = aiList.some(
          (ai) =>
            (ai.text === text || text.startsWith(ai.text.slice(0, 50))) &&
            Math.abs(timestamp - ai.time) < 30 * 60 * 1000,
        )
        if (isAiEcho) {
          continue
        }
      }

      let sender: WhatsAppSender = 'client'
      if (isFromMe) {
        const senderRole =
          rec.sender && typeof rec.sender === 'object'
            ? String(rec.sender.role || rec.sender.type || '')
            : ''
        const recType = String(rec.type || '')
        const msgIdStr = String(rec.messageId || '')

        if (
          senderRole === 'agent' ||
          recType === 'AgentSentMessage' ||
          msgIdStr.startsWith('agent_')
        ) {
          sender = 'agent'
        } else if (senderRole === 'ai' || recType === 'AISentMessage') {
          sender = 'ai'
        } else {
          sender = 'agent'
        }
      }

      const conv = getOrCreateConv(normalized)

      const isDuplicateInConv = conv.messages.some(
        (m) =>
          m.sender === sender &&
          m.text.trim() === text.trim() &&
          Math.abs(m.timestamp - timestamp) < 5 * 60 * 1000,
      )

      if (isDuplicateInConv) {
        continue
      }

      conv.messages.push({
        id: `wh-${rec.id}`,
        text,
        time: timeStr,
        sender,
        timestamp,
        messageId: rec.messageId,
        isAudio: Boolean(rec.is_audio),
        audioUrl: rec.audio_url || undefined,
        attachmentUrl: rec.attachment_url || undefined,
        attachmentName: rec.attachment_name || undefined,
        attachmentType:
          rec.attachment_type === 'image' ||
          rec.attachment_type === 'video' ||
          rec.attachment_type === 'document' ||
          rec.attachment_type === 'audio'
            ? (rec.attachment_type as 'image' | 'video' | 'document' | 'audio')
            : undefined,
      })

      if (rec.messageId) {
        seenMessageIds.add(rec.messageId)
      }
    }

    // 2. Processar respostas de message_processing
    for (const proc of processingList) {
      if (!proc.phone) continue
      const normalized = extractNormalizedPhone(proc.phone)
      if (!normalized) continue

      const conv = getOrCreateConv(normalized)

      if (proc.incomingText && proc.messageId && !seenMessageIds.has(proc.messageId)) {
        const procDate = new Date(proc.created)
        conv.messages.push({
          id: `proc-in-${proc.id}`,
          text: proc.incomingText,
          time: formatActivityTime(procDate),
          sender: 'client',
          timestamp: procDate.getTime(),
          messageId: proc.messageId,
          isAudio: Boolean(proc.is_audio),
          audioUrl: proc.audio_url || undefined,
        })
        seenMessageIds.add(proc.messageId)
      }

      if (proc.aiReplyText && (proc.replySent || proc.status === 'completed')) {
        const alreadyExists = conv.messages.some(
          (m) => m.sender === 'ai' && m.text.trim() === proc.aiReplyText?.trim(),
        )

        if (!alreadyExists) {
          const replyDate = new Date(proc.updated || proc.created)
          conv.messages.push({
            id: `proc-ai-${proc.id}`,
            text: proc.aiReplyText,
            time: formatActivityTime(replyDate),
            sender: 'ai',
            timestamp: replyDate.getTime(),
          })
        }
      }
    }

    // 3. Montar a lista final de clientes de WhatsApp
    const result: WhatsAppCustomer[] = []

    for (const [, conv] of conversations) {
      conv.messages.sort((a, b) => a.timestamp - b.timestamp)

      if (conv.messages.length === 0) continue

      let matchedCustomer: Customer | null =
        customerMap.get(conv.phoneKey) || customerMap.get(conv.phoneKey.replace(/^55/, '')) || null
      if (!matchedCustomer) {
        const convVariants = getPhoneVariants(conv.phoneKey)
        for (const cv of convVariants) {
          const found = customerMap.get(cv)
          if (found) {
            matchedCustomer = found
            break
          }
        }
      }

      const lastMsg = conv.messages[conv.messages.length - 1]
      const lastActivity = lastMsg ? lastMsg.time : ''
      const lastTimestamp = lastMsg ? lastMsg.timestamp : 0

      const lastReadAt =
        readStatesMap.get(conv.phoneKey) || readStatesMap.get(conv.phoneKey.replace(/^55/, '')) || 0

      const unreadCount = conv.messages.filter(
        (m) => m.sender === 'client' && m.timestamp > lastReadAt,
      ).length

      let status: WhatsAppStatus = unreadCount > 0 ? 'novo' : 'em_atendimento'
      if (
        matchedCustomer?.whatsapp_status === 'resolvido' ||
        matchedCustomer?.whatsapp_status === 'em_atendimento' ||
        matchedCustomer?.whatsapp_status === 'novo'
      ) {
        status = matchedCustomer.whatsapp_status as WhatsAppStatus
      }

      const effectiveCustomer = matchedCustomer || getLastKnownCustomer(conv.phoneKey)

      const displayName = effectiveCustomer
        ? effectiveCustomer.name
        : formatPhoneDisplay(conv.phoneKey)
      const customerType: 'PF' | 'PJ' = effectiveCustomer
        ? effectiveCustomer.type || (effectiveCustomer.cnpj ? 'PJ' : 'PF')
        : 'PF'

      const customerQuotes = effectiveCustomer?.id
        ? quotesByCustomerId.get(effectiveCustomer.id) || []
        : []

      result.push({
        id: effectiveCustomer ? effectiveCustomer.id : `conv-${conv.phoneKey}`,
        customerId: effectiveCustomer?.id,
        name: displayName,
        type: customerType,
        phone: formatPhoneDisplay(conv.phoneKey),
        rawPhone: conv.phoneKey,
        company: effectiveCustomer?.company,
        status,
        unreadCount,
        lastReadAt,
        lastActivity,
        lastTimestamp,
        messages: conv.messages,
        quotes: customerQuotes,
      })
    }

    // 4. Ordenar a lista na lateral pela conversa mais recente (lastTimestamp desc)
    result.sort((a, b) => b.lastTimestamp - a.lastTimestamp)

    return result
  } catch (error) {
    console.error('Erro ao montar conversas do WhatsApp:', error)
    return []
  }
}
