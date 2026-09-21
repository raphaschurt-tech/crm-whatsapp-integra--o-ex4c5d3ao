import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { Customer, Quote } from '@/types/crm'
import { getCustomers } from '@/services/customers'
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
  id: string // pode ser o phone normalizado ou o customer.id
  customerId?: string
  name: string
  type: 'PF' | 'PJ'
  phone: string
  rawPhone: string
  company?: string
  status: WhatsAppStatus
  unreadCount?: number
  lastActivity: string
  lastTimestamp: number
  lastReadAt?: number
  messages: WhatsAppMessage[]
  quotes?: import('@/types/crm').Quote[]
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

/**
 * Marca uma conversa como lida até o timestamp especificado no banco PocketBase
 */
export async function markWhatsAppAsRead(rawPhone: string, readTimestamp: number): Promise<void> {
  if (!rawPhone || !readTimestamp) return
  const key = normalizePhoneKey(rawPhone)
  if (!key) return

  try {
    // Tenta encontrar registro existente por phone
    let existingRecord: WhatsAppReadStateRecord | null = null
    try {
      existingRecord = await pb
        .collection<WhatsAppReadStateRecord>('whatsapp_read_states')
        .getFirstListItem(`phone = "${key}"`)
    } catch (_) {
      // Registro não existe ainda
    }

    if (existingRecord) {
      // Atualiza se o novo timestamp for maior ou igual ao gravado
      if (readTimestamp >= (existingRecord.lastReadAt || 0)) {
        await pb
          .collection('whatsapp_read_states')
          .update(existingRecord.id, { lastReadAt: readTimestamp })
      }
    } else {
      await pb.collection('whatsapp_read_states').create({
        phone: key,
        lastReadAt: readTimestamp,
      })
    }
  } catch (err) {
    console.error(`Erro ao salvar marcação de leitura para ${key}:`, err)
  }
}

/**
 * Carrega todas as conversas reais do WhatsApp do banco de dados PocketBase:
 * 1. Busca mensagens de `webhook_received`
 * 2. Busca respostas da IA de `message_processing`
 * 3. Busca lista de clientes cadastrados em `customers` para cruzar por telefone
 * 4. Agrupa por cliente/número de telefone, unifica o histórico em ordem cronológica
 * 5. Ordena as conversas pela mensagem mais recente
 */
export async function loadWhatsAppConversations(): Promise<WhatsAppCustomer[]> {
  try {
    const [webhookList, processingList, customersList, readStatesMap, allQuotesList] =
      await Promise.all([
        withRetry(
          () =>
            pb
              .collection<WebhookReceivedRecord>('webhook_received')
              .getFullList({ sort: 'created' }),
          { retries: 3, delayMs: 800 },
        ).catch((err) => {
          console.warn('Erro ao carregar webhook_received:', err)
          return [] as WebhookReceivedRecord[]
        }),
        withRetry(
          () =>
            pb
              .collection<MessageProcessingRecord>('message_processing')
              .getFullList({ sort: 'created' }),
          { retries: 3, delayMs: 800 },
        ).catch((err) => {
          console.warn('Erro ao carregar message_processing:', err)
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

    // Mapa de clientes para rápida associação por telefone normalizado
    // Um cliente pode ter telefone formatado "(11) 96397-0333" ou "11963970333" ou "5511963970333"
    const customerMap = new Map<string, Customer>()
    for (const c of customersList) {
      const clean = c.phone.replace(/\D/g, '')
      if (clean) {
        customerMap.set(clean, c)
        // Mapear também sem o prefixo 55 ou com prefixo 55
        if (clean.startsWith('55')) {
          customerMap.set(clean.slice(2), c)
        } else {
          customerMap.set(`55${clean}`, c)
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
      // Normalização padrão com 55 se aplicável
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
      // Tenta extrair telefone válido de múltiplos campos possíveis
      let normalized = extractNormalizedPhone(rec.phone)
      if (!normalized) {
        normalized = extractNormalizedPhone(rec.chat)
      }
      if (!normalized) {
        normalized = extractNormalizedPhone(rec.sender)
      }

      // Se após todas as tentativas o número ainda for um LID ou vazio, ignoramos para não criar conversa-fantasma
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

      // Se for fromMe e o texto coincide exatamente com uma resposta enviada pela IA no message_processing
      // para esse mesmo número, trata-se de um eco assíncrono da Z-API (ReceivedCallback) que não deve
      // ser exibido como Atendente RPA duplicado.
      if (isFromMe && rec.type !== 'AgentSentMessage') {
        const aiList = aiRepliesByPhone.get(phoneKey) || []
        const isAiEcho = aiList.some(
          (ai) =>
            (ai.text === text || text.startsWith(ai.text.slice(0, 50))) &&
            Math.abs(timestamp - ai.time) < 30 * 60 * 1000,
        )
        if (isAiEcho) {
          // Ignora o eco — a resposta da IA legítima já é carregada via message_processing
          continue
        }
      }

      // Determinar remetente:
      // Se não for fromMe: 'client'
      // Se for fromMe: diferenciar atendente humano de IA
      // Verifica marcações de atendente (ex: type: AgentSentMessage, sender.role: agent, ou ID agent_*)
      // Versus respostas de IA gravadas pelo ai_message_worker / Z-API
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
          // Mensagem enviada pelo celular (WhatsApp oficial) pelo atendente:
          // A IA só envia quando ai_message_worker processa (e cria com messageId específico).
          // Se veio pelo celular ou webhook sem marcação explícita de IA, é resposta manual do Atendente!
          sender = 'agent'
        }
      }

      const conv = getOrCreateConv(normalized)

      // Deduplicação defensiva: se a mesma conversa já tiver uma mensagem do mesmo remetente
      // com o mesmo texto em intervalo de até 5 minutos (eco de AgentSentMessage recebido como ReceivedCallback),
      // não duplica na visualização!
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

    // 2. Processar respostas de message_processing (garantir respostas de IA enviadas)
    for (const proc of processingList) {
      if (!proc.phone) continue
      const normalized = extractNormalizedPhone(proc.phone)
      if (!normalized) continue

      const conv = getOrCreateConv(normalized)

      // Se o incomingText do cliente não foi incluído pelo webhook (por exemplo webhook falhou ou foi limpo)
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

      // Se a IA respondeu com sucesso (completed ou replySent) e tem texto
      if (proc.aiReplyText && (proc.replySent || proc.status === 'completed')) {
        // Verificar se esse texto já não existe como última resposta
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
      // Ordenar mensagens da conversa em ordem cronológica crescente
      conv.messages.sort((a, b) => a.timestamp - b.timestamp)

      // Se não há mensagens após o filtro, ignorar conversa vazia
      if (conv.messages.length === 0) continue

      // Verificar se este telefone pertence a algum cliente cadastrado em customers
      const matchedCustomer =
        customerMap.get(conv.phoneKey) || customerMap.get(conv.phoneKey.replace(/^55/, '')) || null

      const lastMsg = conv.messages[conv.messages.length - 1]
      const lastActivity = lastMsg ? lastMsg.time : ''
      const lastTimestamp = lastMsg ? lastMsg.timestamp : 0

      // Estado de leitura persistido
      const lastReadAt =
        readStatesMap.get(conv.phoneKey) || readStatesMap.get(conv.phoneKey.replace(/^55/, '')) || 0

      // Contar quantas mensagens do cliente são estritamente posteriores a lastReadAt
      const unreadCount = conv.messages.filter(
        (m) => m.sender === 'client' && m.timestamp > lastReadAt,
      ).length

      // Se houver mensagens não lidas do cliente, marcar como "novo"; caso contrário "em_atendimento"
      const status: WhatsAppStatus = unreadCount > 0 ? 'novo' : 'em_atendimento'

      const displayName = matchedCustomer ? matchedCustomer.name : formatPhoneDisplay(conv.phoneKey)
      const customerType: 'PF' | 'PJ' = matchedCustomer
        ? matchedCustomer.type || (matchedCustomer.cnpj ? 'PJ' : 'PF')
        : 'PF'

      // Orçamentos associados ao cliente (por customerId ou fallback de telefone via matchedCustomer)
      const customerQuotes = matchedCustomer?.id
        ? quotesByCustomerId.get(matchedCustomer.id) || []
        : []

      result.push({
        id: matchedCustomer ? matchedCustomer.id : `conv-${conv.phoneKey}`,
        customerId: matchedCustomer?.id,
        name: displayName,
        type: customerType,
        phone: formatPhoneDisplay(conv.phoneKey),
        rawPhone: conv.phoneKey,
        company: matchedCustomer?.company,
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
