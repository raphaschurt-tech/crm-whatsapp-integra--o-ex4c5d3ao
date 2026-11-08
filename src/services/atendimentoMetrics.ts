import pb from '@/lib/pocketbase/client'

/**
 * Interface dos dados do chat_control (conforme schema real)
 */
export interface ChatControlRecord {
  id: string
  phone: string
  human_mode: boolean
  paused_by?: string
  paused_reason?: string
  created?: string
  updated?: string
}

/**
 * Interface dos dados do chat_summaries (conforme schema real)
 */
export interface ChatSummaryRecord {
  id: string
  canonical_phone: string
  raw_phone: string
  first_message_at?: string
  last_message_at?: string
  tem_mensagens: boolean
  unread_count?: number
  created?: string
  updated?: string
}

/**
 * Interface dos dados de message_processing (conforme schema real)
 */
export interface MessageProcessingRecord {
  id: string
  phone: string
  incomingText: string
  aiReplyText: string
  replySent: boolean
  status: string
  created: string
  updated: string
}

export interface MetricEscalationItem {
  reason: string
  label: string
  count: number
  percent: number
}

export interface DailyVolumeItem {
  dateKey: string // YYYY-MM-DD em Brasília
  label: string // dd/MM
  count: number
}

export interface AtendimentoMetricsData {
  windowDays: number
  periodStartBrasilia: string // YYYY-MM-DD
  periodEndBrasilia: string // YYYY-MM-DD

  // KPI 1: Tempo médio de 1ª resposta
  averageFirstResponseSeconds: number | null
  averageFirstResponseFormatted: string
  totalResponsesEvaluated: number
  kpiResponseTimeNotes: string

  // KPI 2: % resolvida pela IA vs. escalada
  totalConversationsInWindow: number
  aiResolvedCount: number
  humanEscalatedCount: number
  aiResolvedPercent: number
  humanEscalatedPercent: number
  kpiResolutionNotes: string

  // KPI 3: Volume/dia (últimos 30 dias)
  dailyVolume: DailyVolumeItem[]
  totalVolume30Days: number
  averageConversationsPerDay: number

  // Seção complementar: Motivos de escalada
  escalationReasons: MetricEscalationItem[]
  totalEscalationsRecorded: number
}

/**
 * Converte Date ou ISO string para o fuso horário de Brasília (UTC-3)
 * Retorna string YYYY-MM-DD
 */
export function toBrasiliaDateKey(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(d.getTime())) return ''
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000
  const brMs = utcMs - 3 * 3600000
  const brDate = new Date(brMs)
  return brDate.toISOString().slice(0, 10)
}

/**
 * Formata data/hora ISO no padrão de Brasília (DD/MM/YYYY HH:mm:ss)
 */
export function formatBrasiliaDateTime(isoDateString?: string | null): string {
  if (!isoDateString) return '—'
  const d = new Date(isoDateString)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Formata segundos em texto legível (ex: "4.2s", "1m 15s")
 */
export function formatSecondsDisplay(seconds: number | null): string {
  if (seconds === null || isNaN(seconds) || seconds < 0) {
    return '0s'
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const mins = Math.floor(seconds / 60)
  const remSecs = Math.round(seconds % 60)
  return `${mins}m ${remSecs}s`
}

/**
 * Mapeamento amigável para rótulos dos motivos de escalada (Camada 3 + comando_atendente)
 */
export const ESCALATION_REASON_LABELS: Record<string, string> = {
  reclamacao: 'Reclamação de cliente',
  nota: 'Solicitação de Nota Fiscal',
  cobranca: 'Assunto financeiro / Cobrança',
  interesse_compra: 'Interesse de compra / Cotação complexa',
  aplicacao: 'Dúvida técnica de aplicação',
  comando_atendente: 'Comando direto /atendente',
  sem_motivo: 'Sem motivo especificado (manual)',
}

/**
 * Busca e calcula os 3 KPIs reais do atendimento em leitura, sem collections ou jobs novos.
 * Janela padrão: 30 dias em horário de Brasília.
 */
export async function getAtendimentoMetrics(windowDays = 30): Promise<AtendimentoMetricsData> {
  const now = new Date()
  const todayBrasilia = toBrasiliaDateKey(now)

  // Janela de X dias atrás em Brasília
  const pastDate = new Date(now.getTime() - windowDays * 24 * 3600000)
  const pastIso = pastDate.toISOString()
  const startDateBrasilia = toBrasiliaDateKey(pastDate)

  // 1. Buscar coleções reais em paralelo
  const [summariesResult, chatControlsResult, messageProcessingResult] = await Promise.allSettled([
    pb.collection('chat_summaries').getFullList<ChatSummaryRecord>({
      sort: '-last_message_at',
      filter: `last_message_at >= "${pastIso}" || updated >= "${pastIso}"`,
    }),
    pb.collection('chat_control').getFullList<ChatControlRecord>({
      sort: '-updated',
    }),
    pb.collection('message_processing').getFullList<MessageProcessingRecord>({
      filter: `replySent = true && created >= "${pastIso}"`,
      sort: '-created',
    }),
  ])

  const summaries = summariesResult.status === 'fulfilled' ? summariesResult.value : []
  const chatControls = chatControlsResult.status === 'fulfilled' ? chatControlsResult.value : []
  const messageProcessing =
    messageProcessingResult.status === 'fulfilled' ? messageProcessingResult.value : []

  // Mapa de controle por telefone canônico (10 ou 11 dígitos)
  const controlByPhone = new Map<string, ChatControlRecord>()
  for (const c of chatControls) {
    if (!c.phone) continue
    const cleanDigits = c.phone.replace(/\D/g, '')
    // Chave canônica sem DDI 55 se vier com ele
    const canon =
      cleanDigits.startsWith('55') && cleanDigits.length > 11 ? cleanDigits.slice(2) : cleanDigits
    controlByPhone.set(canon, c)
    controlByPhone.set(cleanDigits, c)
  }

  // -------------------------------------------------------------
  // KPI 1: Tempo médio de 1ª resposta
  // Mensagem recebida até envio (created -> updated de message_processing com replySent = true)
  // -------------------------------------------------------------
  let totalDeltaSeconds = 0
  let evaluatedCount = 0

  for (const mp of messageProcessing) {
    if (!mp.created || !mp.updated || !mp.replySent) continue
    const createdMs = new Date(mp.created).getTime()
    const updatedMs = new Date(mp.updated).getTime()
    if (isNaN(createdMs) || isNaN(updatedMs) || updatedMs < createdMs) continue
    const deltaSec = (updatedMs - createdMs) / 1000
    // Descartar anomalias absurdas (> 1 hora de fila represada ou < 0)
    if (deltaSec >= 0 && deltaSec <= 3600) {
      totalDeltaSeconds += deltaSec
      evaluatedCount++
    }
  }

  const averageFirstResponseSeconds = evaluatedCount > 0 ? totalDeltaSeconds / evaluatedCount : null
  const averageFirstResponseFormatted = formatSecondsDisplay(averageFirstResponseSeconds)
  const kpiResponseTimeNotes =
    evaluatedCount > 0
      ? `Baseado em ${evaluatedCount} respostas automáticas enviadas (replySent=true) nos últimos ${windowDays} dias.`
      : `Nenhuma resposta enviada no período de ${windowDays} dias avaliado.`

  // -------------------------------------------------------------
  // KPI 2: % resolvida pela IA vs. escalada
  // Proporção de conversas ativas na janela com chat_control.human_mode=false vs. true
  // -------------------------------------------------------------
  let aiResolvedCount = 0
  let humanEscalatedCount = 0

  // Contabilizar sobre as conversas ativas no período (chat_summaries)
  for (const s of summaries) {
    const phone = s.canonical_phone || s.raw_phone || ''
    const cleanDigits = phone.replace(/\D/g, '')
    const canon =
      cleanDigits.startsWith('55') && cleanDigits.length > 11 ? cleanDigits.slice(2) : cleanDigits

    const ctrl = controlByPhone.get(canon) || controlByPhone.get(cleanDigits)
    if (ctrl?.human_mode) {
      humanEscalatedCount++
    } else {
      aiResolvedCount++
    }
  }

  const totalConversationsInWindow = summaries.length
  const aiResolvedPercent =
    totalConversationsInWindow > 0
      ? Math.round((aiResolvedCount / totalConversationsInWindow) * 1000) / 10
      : 0
  const humanEscalatedPercent =
    totalConversationsInWindow > 0
      ? Math.round((humanEscalatedCount / totalConversationsInWindow) * 1000) / 10
      : 0

  const kpiResolutionNotes =
    totalConversationsInWindow > 0
      ? `${aiResolvedCount} conversas sob controle da IA (${aiResolvedPercent}%) e ${humanEscalatedCount} escaladas para atendente humano (${humanEscalatedPercent}%).`
      : 'Nenhuma conversa registrada nos últimos 30 dias.'

  // -------------------------------------------------------------
  // KPI 3: Volume/dia (conversas por dia nos últimos 30 dias em Brasília)
  // -------------------------------------------------------------
  // Montar array de todos os 30 dias até hoje
  const daysMap = new Map<string, number>()
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600000)
    const key = toBrasiliaDateKey(d)
    if (key) {
      daysMap.set(key, 0)
    }
  }

  for (const s of summaries) {
    const dateStr = s.last_message_at || s.updated || s.created || ''
    const key = toBrasiliaDateKey(dateStr)
    if (key && daysMap.has(key)) {
      daysMap.set(key, (daysMap.get(key) || 0) + 1)
    }
  }

  const dailyVolume: DailyVolumeItem[] = Array.from(daysMap.entries()).map(([dateKey, count]) => {
    const parts = dateKey.split('-')
    const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateKey
    return { dateKey, label, count }
  })

  const totalVolume30Days = dailyVolume.reduce((acc, curr) => acc + curr.count, 0)
  const averageConversationsPerDay =
    windowDays > 0 ? Math.round((totalVolume30Days / windowDays) * 10) / 10 : 0

  // -------------------------------------------------------------
  // Seção complementar: Motivos de escalada
  // Contagem por paused_reason dos registros de chat_control
  // -------------------------------------------------------------
  const reasonCounts: Record<string, number> = {}
  let totalEscalationsRecorded = 0

  for (const c of chatControls) {
    if (!c.human_mode) continue
    totalEscalationsRecorded++
    const rawReason = (c.paused_reason || '').trim() || 'sem_motivo'
    reasonCounts[rawReason] = (reasonCounts[rawReason] || 0) + 1
  }

  const escalationReasons: MetricEscalationItem[] = Object.entries(reasonCounts)
    .map(([reason, count]) => ({
      reason,
      label: ESCALATION_REASON_LABELS[reason] || reason,
      count,
      percent:
        totalEscalationsRecorded > 0
          ? Math.round((count / totalEscalationsRecorded) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    windowDays,
    periodStartBrasilia: startDateBrasilia,
    periodEndBrasilia: todayBrasilia,
    averageFirstResponseSeconds,
    averageFirstResponseFormatted,
    totalResponsesEvaluated: evaluatedCount,
    kpiResponseTimeNotes,
    totalConversationsInWindow,
    aiResolvedCount,
    humanEscalatedCount,
    aiResolvedPercent,
    humanEscalatedPercent,
    kpiResolutionNotes,
    dailyVolume,
    totalVolume30Days,
    averageConversationsPerDay,
    escalationReasons,
    totalEscalationsRecorded,
  }
}
