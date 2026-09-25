import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  Search,
  Send,
  MessageCircle,
  CheckCheck,
  User,
  Building2,
  Clock,
  CheckCircle2,
  Phone,
  FileText,
  Sparkles,
  RefreshCw,
  ChevronDown,
  PackageSearch,
  History,
  Mic,
  Paperclip,
  File,
  X,
  Eye,
  Download,
  AlertTriangle,
  Square,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { openWhatsApp, formatCurrency } from '@/lib/whatsapp'
import { Quote } from '@/types/crm'
import { AlertCircle, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  WhatsAppCustomer,
  WhatsAppMessage,
  WhatsAppStatus,
  loadWhatsAppConversations,
  markWhatsAppAsRead,
} from '@/services/whatsappChat'
import { useRealtime } from '@/hooks/use-realtime'
import { sendWhatsAppMessage } from '@/services/quotes'
import { ProductQuoteModal } from '@/components/WhatsApp/ProductQuoteModal'
import { CustomerQuoteHistory } from '@/components/WhatsApp/CustomerQuoteHistory'
import { createCustomer, getCustomers, updateCustomer } from '@/services/customers'
import { useAuth } from '@/hooks/use-auth'
import { Customer } from '@/types/crm'
import { toast } from '@/hooks/use-toast'

export type { WhatsAppStatus, WhatsAppMessage, WhatsAppCustomer }

export default function WhatsAppAtendimento() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [customers, setCustomers] = useState<WhatsAppCustomer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [search, setSearch] = useState('')

  // Filtro de status persistido no localStorage por usuário
  const filterStorageKey = `rpa_whatsapp_status_filter_${user?.id || 'anon'}`
  const [statusFilter, setStatusFilter] = useState<
    'todos' | 'novo' | 'nao_lidos' | 'em_atendimento' | 'antigos' | 'inativos'
  >(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(`rpa_whatsapp_status_filter_${user?.id || 'anon'}`)
        if (
          saved &&
          ['todos', 'novo', 'nao_lidos', 'em_atendimento', 'antigos', 'inativos'].includes(saved)
        ) {
          return saved as 'todos' | 'novo' | 'nao_lidos' | 'em_atendimento' | 'antigos' | 'inativos'
        }
      }
    } catch {
      /* intentionally ignored */
    }
    return 'todos'
  })
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PF' | 'PJ'>('ALL')
  const [customersMap, setCustomersMap] = useState<Map<string, Customer>>(new Map())
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)

  // Divisor arrastável (redimensionamento da lista de conversas)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('rpa_whatsapp_sidebar_width')
        if (saved) {
          const parsed = Number(saved)
          if (!isNaN(parsed) && parsed >= 240 && parsed <= 1200) {
            return parsed
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    return 400
  })
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Estados dos novos recursos de Orçamentos e Histórico
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(true)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // Estados de envio de arquivos na conversa
  const [isWhatsAppConnected, setIsWhatsAppConnected] = useState<boolean | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBase64, setFileBase64] = useState<string>('')
  const [fileCaption, setFileCaption] = useState('')
  const [isSendingAttachment, setIsSendingAttachment] = useState(false)
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null)

  // Estados de gravação de áudio
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isSendingAudio, setIsSendingAudio] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const isDiscardingAudioRef = useRef<boolean>(false)

  // Cleanup de gravação ao desmontar componente
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop()
        } catch {
          /* intentionally ignored */
        }
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const startAudioRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({
        title: 'Microfone não suportado',
        description: 'Seu navegador não possui suporte para gravação de áudio.',
        variant: 'destructive',
      })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream

      let mimeType = 'audio/webm'
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      isDiscardingAudioRef.current = false

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach((track) => track.stop())
          audioStreamRef.current = null
        }
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }

        const wasDiscarded = isDiscardingAudioRef.current
        isDiscardingAudioRef.current = false
        setIsRecordingAudio(false)
        setRecordingSeconds(0)

        if (wasDiscarded) {
          audioChunksRef.current = []
          return
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        audioChunksRef.current = []

        if (audioBlob.size === 0) {
          return
        }

        await processAndSendAudio(audioBlob)
      }

      recorder.start(200)
      setIsRecordingAudio(true)
      setRecordingSeconds(0)

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1)
      }, 1000)
    } catch (err: any) {
      console.warn('Erro ao acessar microfone:', err)
      const isDenied =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        String(err).includes('Permission denied')
      toast({
        title: isDenied ? 'Permissão de microfone negada' : 'Erro no microfone',
        description: isDenied
          ? 'Por favor, libere o acesso ao microfone nas configurações do seu navegador para gravar áudios.'
          : err?.message || 'Não foi possível iniciar a gravação de áudio.',
        variant: 'destructive',
      })
    }
  }

  const cancelAudioRecording = () => {
    isDiscardingAudioRef.current = true
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        /* intentionally ignored */
      }
    }
  }

  const stopAndSendAudioRecording = () => {
    isDiscardingAudioRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        /* intentionally ignored */
      }
    }
  }

  const processAndSendAudio = async (audioBlob: Blob) => {
    if (!activeCustomer) return

    setIsSendingAudio(true)
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(audioBlob)
      })

      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes(),
      ).padStart(2, '0')}`

      const optimisticMsg: WhatsAppMessage = {
        id: `agent-audio-${Date.now()}`,
        text: '',
        time: timeStr,
        sender: 'agent',
        timestamp: now.getTime(),
        isAudio: true,
        audioUrl: base64Data,
        attachmentUrl: base64Data,
        attachmentName: 'Mensagem de voz',
        attachmentType: 'audio',
      }

      shouldScrollOnSendRef.current = true

      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id === activeCustomer.id) {
            return {
              ...c,
              lastActivity: timeStr,
              messages: [...c.messages, optimisticMsg],
            }
          }
          return c
        }),
      )

      const targetPhone = activeCustomer.rawPhone || activeCustomer.phone
      const sendRes = await sendWhatsAppMessage(targetPhone, '', {
        audioBase64: base64Data,
        audioMimeType: audioBlob.type || 'audio/webm',
      })

      if (sendRes.ok && sendRes.zapiSuccess) {
        toast({
          title: 'Áudio Enviado!',
          description: `Mensagem de voz enviada com sucesso para ${activeCustomer.name}.`,
        })
      } else {
        toast({
          title: 'Aviso de envio',
          description: sendRes.zapiError || 'Não foi possível confirmar a entrega do áudio.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Erro ao enviar áudio gravado:', err)
      toast({
        title: 'Falha no envio do áudio',
        description: err?.message || 'Erro ao processar ou despachar o áudio gravado.',
        variant: 'destructive',
      })
    } finally {
      setIsSendingAudio(false)
    }
  }

  const formatAudioTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const [previewMediaTitle, setPreviewMediaTitle] = useState('')
  const [previewMediaType, setPreviewMediaType] = useState<'image' | 'video'>('image')

  const chatContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = useRef(true)
  const prevCustomerIdRef = useRef<string | null>(null)
  const prevMessagesCountRef = useRef<number>(0)
  const shouldScrollOnSendRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true)
    try {
      const [data, custList] = await Promise.all([
        loadWhatsAppConversations(),
        getCustomers().catch(() => [] as Customer[]),
      ])
      const map = new Map<string, Customer>()
      for (const c of custList) {
        map.set(c.id, c)
      }
      setCustomersMap(map)
      setCustomers(data)
      setSelectedCustomerId((prevId) => {
        if (!prevId && data.length > 0) {
          return data[0].id
        }
        if (prevId && data.some((c) => c.id === prevId)) {
          return prevId
        }
        return data.length > 0 ? data[0].id : ''
      })
    } catch (err) {
      console.error('Erro ao carregar conversas do WhatsApp:', err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Controle de arrasto (drag-to-resize) do divisor horizontal
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - containerRect.left
      const minWidth = 240
      const maxWidth = Math.max(minWidth, Math.floor(containerRect.width * 0.5))

      const clamped = Math.min(Math.max(newWidth, minWidth), maxWidth)
      setSidebarWidth(clamped)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing])

  // Persistir largura no localStorage quando ela mudar
  useEffect(() => {
    try {
      localStorage.setItem('rpa_whatsapp_sidebar_width', String(Math.round(sidebarWidth)))
    } catch (e) {
      /* ignore */
    }
  }, [sidebarWidth])

  // Persistir filtro de status selecionado no localStorage por usuário
  useEffect(() => {
    try {
      localStorage.setItem(filterStorageKey, statusFilter)
    } catch (_) {
      /* ignore */
    }
  }, [filterStorageKey, statusFilter])

  // Checagem de status de conexão do WhatsApp (Z-API)
  const checkConnectionStatus = useCallback(async (): Promise<boolean> => {
    setCheckingConnection(true)
    try {
      const res = await pb.send<{ ok?: boolean; connected?: boolean }>(
        '/backend/v1/whatsapp/test-zapi',
        {
          method: 'GET',
        },
      )
      const connected = Boolean(res?.ok && res?.connected)
      setIsWhatsAppConnected(connected)
      return connected
    } catch (err) {
      console.warn('Erro ao verificar conexão Z-API:', err)
      setIsWhatsAppConnected(false)
      return false
    } finally {
      setCheckingConnection(false)
    }
  }, [])

  // Carga inicial e verificação de status do WhatsApp
  useEffect(() => {
    fetchData()
    checkConnectionStatus()
  }, [fetchData, checkConnectionStatus])

  // Realtime subscription com debounce para evitar tempestade de requisições e 429
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const debouncedFetchData = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    realtimeDebounceRef.current = setTimeout(() => {
      fetchData(true)
    }, 500)
  }, [fetchData])

  useRealtime('webhook_received', debouncedFetchData)
  useRealtime('message_processing', debouncedFetchData)
  useRealtime('whatsapp_read_states', debouncedFetchData)
  useRealtime('quotes', () => {
    setHistoryRefreshKey((k) => k + 1)
    debouncedFetchData()
  })

  // Polling moderado a cada 25 segundos (somente se a aba estiver visível) para evitar 429
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData(true)
      }
    }, 25000)
    return () => clearInterval(interval)
  }, [fetchData])

  const activeCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0]

  // Unifica mensagens e orçamentos em uma timeline cronológica única de eventos
  type ChatTimelineItem =
    | { kind: 'message'; data: WhatsAppMessage; timestamp: number }
    | { kind: 'quote'; data: Quote; timestamp: number }

  const timelineItems: ChatTimelineItem[] = activeCustomer
    ? [
        ...(activeCustomer.messages || []).map(
          (m): ChatTimelineItem => ({
            kind: 'message',
            data: m,
            timestamp: m?.timestamp || 0,
          }),
        ),
        ...(activeCustomer.quotes || []).map(
          (q): ChatTimelineItem => ({
            kind: 'quote',
            data: q,
            timestamp: q?.created ? new Date(q.created).getTime() : 0,
          }),
        ),
      ].sort((a, b) => a.timestamp - b.timestamp)
    : []

  // Persistir leitura sempre que uma conversa for selecionada / aberta
  useEffect(() => {
    if (!activeCustomer) return
    const msgs = activeCustomer.messages || []
    if (msgs.length === 0) return

    const lastMsg = msgs[msgs.length - 1]
    const targetPhone = activeCustomer.rawPhone || activeCustomer.phone
    const currentLastRead = activeCustomer.lastReadAt || 0

    // Se houver mensagens não lidas ou o último timestamp for maior que lastReadAt
    if (
      lastMsg.timestamp > currentLastRead ||
      (activeCustomer.unreadCount && activeCustomer.unreadCount > 0)
    ) {
      // Atualiza o estado local imediatamente
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === activeCustomer.id
            ? { ...c, unreadCount: 0, lastReadAt: lastMsg.timestamp, status: 'em_atendimento' }
            : c,
        ),
      )
      // Grava no banco de dados para persistência definitiva
      markWhatsAppAsRead(targetPhone, lastMsg.timestamp)
    }
  }, [activeCustomer?.id, activeCustomer?.messages?.length])

  const checkIfNearBottom = () => {
    const el = chatContainerRef.current
    if (!el) return true
    const threshold = 120
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceToBottom <= threshold
  }

  const handleChatScroll = () => {
    const isNear = checkIfNearBottom()
    isNearBottomRef.current = isNear
    if (isNear && hasUnreadBelow) {
      setHasUnreadBelow(false)
    }
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior,
      })
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior })
    }
    setHasUnreadBelow(false)
    isNearBottomRef.current = true
  }

  // Controle inteligente de scroll
  useLayoutEffect(() => {
    if (!activeCustomer) return

    const currentCustId = activeCustomer.id
    const currentItemsCount = timelineItems.length
    const isNewConversation = prevCustomerIdRef.current !== currentCustId
    const hadItems = prevMessagesCountRef.current
    const itemAdded = currentItemsCount > hadItems

    if (isNewConversation) {
      // (a) Ao abrir/selecionar conversa pela primeira vez: rolar direto para o fim
      prevCustomerIdRef.current = currentCustId
      prevMessagesCountRef.current = currentItemsCount
      setHasUnreadBelow(false)
      // timeout pequeno para dar tempo do container medir layout se acabou de renderizar
      requestAnimationFrame(() => {
        scrollToBottom('auto')
      })
      return
    }

    // Mesmo cliente já aberto
    if (shouldScrollOnSendRef.current) {
      // (b) Envio do próprio usuário: sempre rolar para o fim
      shouldScrollOnSendRef.current = false
      prevMessagesCountRef.current = currentItemsCount
      requestAnimationFrame(() => {
        scrollToBottom('smooth')
      })
      return
    }

    if (itemAdded) {
      // Nova mensagem de terceiro ou atualização de dados
      if (isNearBottomRef.current) {
        // Usuário já está perto do fim: rolar suavemente
        requestAnimationFrame(() => {
          scrollToBottom('smooth')
        })
      } else {
        // Usuário está rolando para cima lendo histórico: NÃO mover o scroll
        setHasUnreadBelow(true)
      }
    }

    prevMessagesCountRef.current = currentItemsCount
  }, [activeCustomer?.id, timelineItems.length])

  const filteredCustomers = customers
    .filter((c) => {
      // Filtro de status customizado com 6 botões
      if (statusFilter === 'todos') {
        if (c.customerId) {
          const linkedCust = customersMap.get(c.customerId)
          if (linkedCust?.pipeline_status === 'perdido') {
            return false
          }
        }
      } else if (statusFilter === 'novo') {
        // "Novos": todas as conversas sem filtro de status
      } else if (statusFilter === 'nao_lidos') {
        if (!(c.unreadCount && c.unreadCount > 0)) return false
      } else if (statusFilter === 'em_atendimento') {
        if (c.status !== 'em_atendimento') return false
      } else if (statusFilter === 'antigos') {
        const msgs = c.messages || []
        const lastMsgTime =
          c.lastTimestamp || (msgs.length > 0 ? msgs[msgs.length - 1]?.timestamp || 0 : 0)
        const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000
        if (!lastMsgTime || lastMsgTime > sevenDaysAgo) return false
      } else if (statusFilter === 'inativos') {
        if (c.status !== 'resolvido') return false
      }

      // Filtro PF / PJ
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false

      // Busca por texto
      if (
        search &&
        !(c.name || '').toLowerCase().includes(search.toLowerCase()) &&
        !(c.phone || '').includes(search) &&
        !(c.company || '').toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    })
    .sort((a, b) => {
      const getArrivalTimestamp = (conv: WhatsAppCustomer): number => {
        const msgs = conv.messages || []
        if (msgs.length > 0 && msgs[0]) {
          return msgs[0].timestamp || 0
        }
        return conv.lastTimestamp || 0
      }

      const getLastTimestamp = (conv: WhatsAppCustomer): number => {
        const msgs = conv.messages || []
        if (msgs.length > 0 && msgs[msgs.length - 1]) {
          return msgs[msgs.length - 1].timestamp || 0
        }
        return conv.lastTimestamp || 0
      }

      switch (statusFilter) {
        case 'todos':
        case 'novo': {
          // Ordenar por chegada: mais recente → mais antiga
          const tA = getArrivalTimestamp(a)
          const tB = getArrivalTimestamp(b)
          return tB - tA
        }
        case 'nao_lidos': {
          // Ordenar da mais antiga → mais recente
          const tA = getLastTimestamp(a)
          const tB = getLastTimestamp(b)
          return tA - tB
        }
        case 'em_atendimento': {
          // Ordenar mais recente → mais antiga
          const tA = getLastTimestamp(a)
          const tB = getLastTimestamp(b)
          return tB - tA
        }
        case 'antigos': {
          // Ordenar da mais antiga → mais nova
          const tA = getLastTimestamp(a)
          const tB = getLastTimestamp(b)
          return tA - tB
        }
        case 'inativos': {
          // Ordenar pela data de fechamento: mais recente → mais antiga (usar updated do registro da conversa; se não houver, a última atividade)
          const convRecordA = a as any
          const convRecordB = b as any
          const tA = convRecordA.updated
            ? new Date(convRecordA.updated).getTime()
            : getLastTimestamp(a)
          const tB = convRecordB.updated
            ? new Date(convRecordB.updated).getTime()
            : getLastTimestamp(b)
          return tB - tA
        }
        default:
          return b.lastTimestamp - a.lastTimestamp
      }
    })

  // Manipulação de seleção de arquivo
  const handleClipClick = async () => {
    if (!activeCustomer) return

    // Checar conexão do WhatsApp antes de abrir seletor ou permitir envio
    const connected = await checkConnectionStatus()
    if (!connected) {
      toast({
        title: 'WhatsApp Desconectado',
        description:
          'O envio de anexos só funciona com o WhatsApp conectado à Z-API. Conecte o WhatsApp nas configurações.',
        variant: 'destructive',
      })
      return
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const MAX_SIZE_MB = 15
    const MAX_BYTES = MAX_SIZE_MB * 1024 * 1024
    if (file.size > MAX_BYTES) {
      toast({
        title: 'Arquivo muito grande',
        description: `O limite máximo por anexo é de ${MAX_SIZE_MB}MB. O arquivo selecionado tem ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
        variant: 'destructive',
      })
      return
    }

    // Converter para base64 data URL
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setSelectedFile(file)
      setFileBase64(result)
      setFileCaption('')
      setIsAttachmentModalOpen(true)
    }
    reader.onerror = () => {
      toast({
        title: 'Erro ao ler arquivo',
        description: 'Não foi possível carregar os dados do arquivo.',
        variant: 'destructive',
      })
    }
    reader.readAsDataURL(file)
  }

  const handleSendAttachment = async () => {
    if (!selectedFile || !fileBase64 || !activeCustomer) return

    // Revalidar conexão antes do envio
    const connected = await checkConnectionStatus()
    if (!connected) {
      toast({
        title: 'WhatsApp Desconectado',
        description:
          'O envio de anexos só funciona com o WhatsApp conectado à Z-API e não é permitido neste modo.',
        variant: 'destructive',
      })
      return
    }

    setIsSendingAttachment(true)
    const captionTrimmed = fileCaption.trim()
    const fileName = selectedFile.name
    const isImg =
      selectedFile.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName)
    const attachType: 'image' | 'document' = isImg ? 'image' : 'document'

    const now = new Date()
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0',
    )}`

    // Mensagem otimista imediata para aparecer na conversa na hora
    const optimisticMsg: WhatsAppMessage = {
      id: `agent-file-${Date.now()}`,
      text: captionTrimmed,
      time: timeStr,
      sender: 'agent',
      timestamp: now.getTime(),
      attachmentUrl: fileBase64,
      attachmentName: fileName,
      attachmentType: attachType,
    }

    shouldScrollOnSendRef.current = true

    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === activeCustomer.id) {
          return {
            ...c,
            lastActivity: timeStr,
            messages: [...(c.messages || []), optimisticMsg],
          }
        }
        return c
      }),
    )

    try {
      const targetPhone = activeCustomer.rawPhone || activeCustomer.phone
      const sendRes = await sendWhatsAppMessage(targetPhone, captionTrimmed, {
        document: fileBase64,
        fileName: fileName,
        isImage: isImg,
        caption: captionTrimmed,
      })

      if (sendRes.ok && sendRes.zapiSuccess) {
        toast({
          title: 'Anexo Enviado!',
          description: isImg
            ? `Imagem enviada com sucesso para ${activeCustomer.name}.`
            : `Documento "${fileName}" enviado com sucesso para ${activeCustomer.name}.`,
        })
      } else {
        toast({
          title: 'Aviso de envio',
          description: sendRes.zapiError || 'Não foi possível confirmar a entrega do anexo.',
          variant: 'destructive',
        })
      }

      // Fechar modal e limpar estado
      setIsAttachmentModalOpen(false)
      setSelectedFile(null)
      setFileBase64('')
      setFileCaption('')
    } catch (err: any) {
      console.error('Erro ao enviar anexo via Z-API:', err)
      toast({
        title: 'Falha no envio do anexo',
        description: err?.message || 'Erro ao comunicar com a Z-API.',
        variant: 'destructive',
      })
    } finally {
      setIsSendingAttachment(false)
    }
  }

  const handleDownloadAttachment = (dataUrl: string, name: string) => {
    try {
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = name || 'arquivo'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      console.error('Erro ao baixar anexo:', err)
      window.open(dataUrl, '_blank')
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || !activeCustomer) return

    const textToSend = inputText.trim()
    const now = new Date()
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0',
    )}`

    const newMsg: WhatsAppMessage = {
      id: `msg-${Date.now()}`,
      text: textToSend,
      time: timeStr,
      sender: 'agent',
      timestamp: now.getTime(),
    }

    shouldScrollOnSendRef.current = true

    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === activeCustomer.id) {
          return {
            ...c,
            lastActivity: timeStr,
            messages: [...(c.messages || []), newMsg],
          }
        }
        return c
      }),
    )

    setInputText('')

    // Enviar via backend Z-API se configurado
    try {
      const targetPhone = activeCustomer.rawPhone || activeCustomer.phone
      const sendRes = await sendWhatsAppMessage(targetPhone, textToSend)
      if (!sendRes.zapiSuccess) {
        console.log('Mensagem registrada localmente. Z-API offline ou não configurada.')
      }
    } catch (sendErr: any) {
      console.warn('Erro ao disparar mensagem para o backend:', sendErr)
      toast({
        title: 'Aviso de envio',
        description: sendErr?.message || 'Falha ao despachar mensagem pelo WhatsApp.',
        variant: 'destructive',
      })
    }
  }

  // Garante que o cliente selecionado tenha um customerId no banco para vincular orçamentos
  const handleOpenProductQuote = async () => {
    if (!activeCustomer) return

    if (!activeCustomer.customerId) {
      try {
        const created = await createCustomer({
          name: activeCustomer.name,
          phone: activeCustomer.rawPhone || activeCustomer.phone,
          type: activeCustomer.type,
          company: activeCustomer.company,
        })
        activeCustomer.customerId = created.id
        // atualiza estado local
        setCustomers((prev) =>
          prev.map((c) => (c.id === activeCustomer.id ? { ...c, customerId: created.id } : c)),
        )
      } catch (err) {
        console.warn('Erro ao auto-vincular cliente para orçamento:', err)
      }
    }

    setIsProductModalOpen(true)
  }

  const handleUpdateStatus = async (newStatus: WhatsAppStatus) => {
    if (!activeCustomer) return
    // Atualização otimista na lista local
    setCustomers((prev) =>
      prev.map((c) => (c.id === activeCustomer.id ? { ...c, status: newStatus } : c)),
    )

    // Se a conversa já tem customerId cadastrado em customers, salva direto na base
    let custId = activeCustomer.customerId
    try {
      if (!custId) {
        // Auto-cria cliente se ainda não tiver cadastro para persistir o whatsapp_status
        const targetPhone = activeCustomer.rawPhone || activeCustomer.phone
        const created = await createCustomer({
          name: activeCustomer.name,
          phone: targetPhone,
          type: activeCustomer.type,
          company: activeCustomer.company,
          whatsapp_status: newStatus,
        })
        custId = created.id
        activeCustomer.customerId = created.id
        setCustomers((prev) =>
          prev.map((c) => (c.id === activeCustomer.id ? { ...c, customerId: created.id } : c)),
        )
      } else {
        await updateCustomer(custId, {
          whatsapp_status: newStatus,
        })
      }
      toast({
        title: 'Status atualizado',
        description: `Conversa marcada como ${newStatus === 'resolvido' ? 'Resolvido' : newStatus === 'em_atendimento' ? 'Em atendimento' : 'Novo'}.`,
      })
    } catch (err: any) {
      console.error('Erro ao salvar whatsapp_status no customer:', err)
      toast({
        title: 'Aviso ao persistir status',
        description: err?.message || 'Não foi possível gravar o status da conversa no banco.',
        variant: 'destructive',
      })
    }
  }

  const getStatusBadge = (status: WhatsAppStatus) => {
    switch (status) {
      case 'novo':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
            <Clock className="w-3 h-3" /> Novo
          </span>
        )
      case 'em_atendimento':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
            <MessageCircle className="w-3 h-3" /> Em atendimento
          </span>
        )
      case 'resolvido':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
            <CheckCircle2 className="w-3 h-3" /> Resolvido
          </span>
        )
    }
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da página */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-emerald-600" />
            Atendimento WhatsApp
          </h1>
          <p className="text-sm text-slate-500">
            Central unificada de conversas com clientes (PF/PJ), integração com IA e resposta manual
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(false)}
            disabled={isRefreshing}
            className="text-slate-700"
            title="Atualizar mensagens agora"
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 text-emerald-600 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/orcamentos/novo')}
            className="text-slate-700"
          >
            <FileText className="h-4 w-4 mr-1.5 text-emerald-600" />
            Criar Orçamento
          </Button>
        </div>
      </div>

      {/* Container principal no estilo WhatsApp Web */}
      <div
        ref={containerRef}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row h-[calc(100vh-210px)] min-h-[580px]"
      >
        {/* LADO ESQUERDO: Lista de conversas */}
        <div
          style={
            {
              '--sidebar-width': `${sidebarWidth}px`,
            } as React.CSSProperties
          }
          className="w-full md:w-[var(--sidebar-width)] border-r border-slate-200 flex flex-col bg-slate-50/50 shrink-0 md:border-r-0"
        >
          {/* Barra de busca e filtros */}
          <div className="p-3 bg-white border-b border-slate-200 space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar cliente, telefone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-slate-50 border-slate-200"
              />
            </div>

            {/* Filtros de Tipo e Status */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md text-[11px]">
                <button
                  type="button"
                  onClick={() => setTypeFilter('ALL')}
                  className={`px-2 py-1 rounded font-medium transition-colors ${
                    typeFilter === 'ALL'
                      ? 'bg-white text-emerald-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('PF')}
                  className={`px-2 py-1 rounded font-medium transition-colors ${
                    typeFilter === 'PF'
                      ? 'bg-white text-emerald-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  PF
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('PJ')}
                  className={`px-2 py-1 rounded font-medium transition-colors ${
                    typeFilter === 'PJ'
                      ? 'bg-white text-emerald-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  PJ
                </button>
              </div>

              <div className="flex items-center gap-1 text-[11px] overflow-x-auto no-scrollbar py-0.5">
                <button
                  type="button"
                  onClick={() => setStatusFilter('todos')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'todos'
                      ? 'bg-emerald-50 text-emerald-700 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('novo')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'novo'
                      ? 'bg-amber-100 text-amber-800 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Novos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('nao_lidos')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'nao_lidos'
                      ? 'bg-emerald-500 text-white font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Não lidos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('em_atendimento')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'em_atendimento'
                      ? 'bg-emerald-100 text-emerald-800 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Ativos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('antigos')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'antigos'
                      ? 'bg-slate-200 text-slate-800 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Antigos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('inativos')}
                  className={`px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    statusFilter === 'inativos'
                      ? 'bg-slate-100 text-slate-700 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Inativos
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Clientes com scroll */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="h-5 w-5 animate-spin text-emerald-600" />
                <span>Carregando conversas do WhatsApp...</span>
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhuma conversa encontrada.
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const isSelected = customer.id === activeCustomer?.id
                const custMsgs = customer.messages || []
                const lastMsg = custMsgs.length > 0 ? custMsgs[custMsgs.length - 1] : undefined

                return (
                  <div
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomerId(customer.id)
                      const cMsgs = customer.messages || []
                      const clickedLastMsg = cMsgs.length > 0 ? cMsgs[cMsgs.length - 1] : undefined
                      if (clickedLastMsg) {
                        const targetPhone = customer.rawPhone || customer.phone
                        setCustomers((prev) =>
                          prev.map((c) =>
                            c.id === customer.id
                              ? {
                                  ...c,
                                  unreadCount: 0,
                                  lastReadAt: clickedLastMsg.timestamp,
                                  status: 'em_atendimento',
                                }
                              : c,
                          ),
                        )
                        markWhatsAppAsRead(targetPhone, clickedLastMsg.timestamp)
                      }
                    }}
                    className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors border-l-4 ${
                      isSelected
                        ? 'bg-emerald-50/70 border-emerald-500'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    {/* Avatar do cliente */}
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        customer.type === 'PJ'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {customer.type === 'PJ' ? (
                        <Building2 className="w-5 h-5" />
                      ) : (
                        <User className="w-5 h-5" />
                      )}
                    </div>

                    {/* Dados do cliente e última mensagem */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-bold text-slate-800 text-sm truncate">
                            {customer.name}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                              customer.type === 'PJ'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {customer.type}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {customer.lastActivity}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500 truncate flex-1">
                          {lastMsg ? (
                            <>
                              {lastMsg.sender === 'agent' && (
                                <span className="font-medium text-slate-700">Você: </span>
                              )}
                              {lastMsg.sender === 'ai' && (
                                <span className="font-medium text-emerald-700">IA: </span>
                              )}
                              {lastMsg.text}
                            </>
                          ) : (
                            'Sem mensagens'
                          )}
                        </p>
                        {customer.unreadCount ? (
                          <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                            {customer.unreadCount}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex items-center gap-2">
                        {getStatusBadge(customer.status)}
                        {customer.company && (
                          <span className="text-[11px] text-slate-400 truncate">
                            • {customer.company}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Divisor arrastável (apenas md+) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar lista de conversas"
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsResizing(true)
          }}
          className={`hidden md:flex w-2 shrink-0 relative cursor-col-resize select-none items-center justify-center transition-colors border-l border-r border-slate-200 hover:border-emerald-400 group z-20 ${
            isResizing
              ? 'bg-emerald-500/15 border-emerald-500 shadow-inner'
              : 'bg-slate-50 hover:bg-emerald-50/60'
          }`}
          title="Clique e arraste para ajustar a largura da lista de conversas"
        >
          {/* Linha vertical central e pequenas ranhuras de pegada/grip */}
          <div
            className={`w-[2px] h-8 rounded-full transition-colors ${
              isResizing ? 'bg-emerald-600' : 'bg-slate-300 group-hover:bg-emerald-500'
            }`}
          />
        </div>

        {/* LADO DIREITO: Área do Chat WhatsApp */}
        {activeCustomer ? (
          <div className="flex-1 flex flex-col bg-[#efeae2]/40 relative min-w-0">
            {/* Header do Chat */}
            <div className="p-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shadow-xs z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                    activeCustomer.type === 'PJ'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {activeCustomer.type === 'PJ' ? (
                    <Building2 className="w-5 h-5" />
                  ) : (
                    <User className="w-5 h-5" />
                  )}
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-slate-900 text-sm truncate">
                      {activeCustomer.name}
                    </h2>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 font-semibold border-none ${
                        activeCustomer.type === 'PJ'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {activeCustomer.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-2">
                    <span>{activeCustomer.phone}</span>
                    {activeCustomer.company && <span>• {activeCustomer.company}</span>}
                  </p>
                </div>
              </div>

              {/* Ações do Chat */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Alternar painel de histórico de orçamentos */}
                <Button
                  size="sm"
                  variant={showHistoryPanel ? 'secondary' : 'outline'}
                  onClick={() => setShowHistoryPanel((prev) => !prev)}
                  className={`text-xs h-8 ${
                    showHistoryPanel
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'text-slate-700'
                  }`}
                >
                  <History className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  Histórico
                </Button>

                {/* Alterar status */}
                <select
                  aria-label="Status do atendimento"
                  value={activeCustomer.status}
                  onChange={(e) => handleUpdateStatus(e.target.value as WhatsAppStatus)}
                  className={`text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                    showHistoryPanel ? 'hidden xl:block' : 'hidden sm:block'
                  }`}
                >
                  <option value="novo">Status: Novo</option>
                  <option value="em_atendimento">Status: Em atendimento</option>
                  <option value="resolvido">Status: Resolvido</option>
                </select>

                {/* Botão WhatsApp externo: oculto quando o painel de histórico estiver aberto para evitar aperto e sobreposição */}
                {!showHistoryPanel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openWhatsApp(activeCustomer.phone, 'Olá!')}
                    className="hidden md:flex text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                  >
                    <Phone className="w-3.5 h-3.5 mr-1" />
                    WhatsApp
                  </Button>
                )}
              </div>
            </div>

            {/* Histórico de Mensagens no estilo WhatsApp */}
            {/*
              Conforme pedido:
              - Mensagens do cliente à direita (verde)
              - Respostas da IA ou do atendente à esquerda (branco/cinza)
            */}
            <div
              ref={chatContainerRef}
              onScroll={handleChatScroll}
              className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5 relative"
            >
              <div className="flex justify-center my-2">
                <span className="text-[11px] bg-white/80 border border-slate-200 text-slate-500 px-3 py-1 rounded-full shadow-xs">
                  Criptografia de ponta a ponta simulada • Atendimento RPA Auto Parts
                </span>
              </div>

              {timelineItems.map((item) => {
                if (item.kind === 'quote') {
                  const q = item.data
                  // Calcular status derivado para o badge do cartão
                  const createdDate = new Date(q.created)
                  const now = new Date()
                  const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24)
                  let displayStatus = q.status
                  if (diffDays > 7 && (q.status === 'enviado' || q.status === 'rascunho')) {
                    displayStatus = 'vencido' as any
                  }

                  const formattedDate = createdDate.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                  const timeFormatted = `${String(createdDate.getHours()).padStart(2, '0')}:${String(
                    createdDate.getMinutes(),
                  ).padStart(2, '0')}`

                  const statusConfig = {
                    pago: {
                      badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                      label: 'Pago',
                      icon: CheckCircle,
                    },
                    aprovado: {
                      badge: 'bg-green-100 text-green-800 border-green-200',
                      label: 'Aprovado',
                      icon: CheckCircle,
                    },
                    enviado: {
                      badge: 'bg-blue-100 text-blue-800 border-blue-200',
                      label: 'Enviado',
                      icon: Clock,
                    },
                    vencido: {
                      badge: 'bg-amber-100 text-amber-800 border-amber-200',
                      label: 'Vencido',
                      icon: AlertCircle,
                    },
                    rejeitado: {
                      badge: 'bg-rose-100 text-rose-800 border-rose-200',
                      label: 'Rejeitado',
                      icon: AlertCircle,
                    },
                    rascunho: {
                      badge: 'bg-slate-100 text-slate-700 border-slate-200',
                      label: 'Rascunho',
                      icon: Clock,
                    },
                  }[displayStatus as string] || {
                    badge: 'bg-blue-100 text-blue-800 border-blue-200',
                    label: displayStatus,
                    icon: Clock,
                  }

                  const StatusIcon = statusConfig.icon

                  return (
                    <div key={`timeline-quote-${q.id}`} className="flex justify-center my-3">
                      <div className="w-full max-w-md bg-white border border-indigo-200 rounded-xl p-3.5 shadow-sm hover:border-indigo-400 transition-all bg-gradient-to-r from-indigo-50/40 via-white to-indigo-50/20">
                        <div className="flex items-center justify-between gap-2 border-b border-indigo-100 pb-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 text-xs font-mono">
                                Orçamento Nº {q.number}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {formattedDate} às {timeFormatted}
                              </span>
                            </div>
                          </div>
                          <Badge className={`${statusConfig.badge} text-[10px] font-bold`}>
                            <StatusIcon className="w-3 h-3 mr-1 inline" />
                            {statusConfig.label}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between py-1">
                          <span className="text-xs text-slate-600 font-medium">Valor Total:</span>
                          <span className="text-base font-extrabold text-emerald-700">
                            {formatCurrency(q.total)}
                          </span>
                        </div>

                        {q.notes && (
                          <p className="text-[11px] text-slate-500 italic bg-slate-50 p-1.5 rounded mt-1 border border-slate-100 line-clamp-2">
                            "{q.notes}"
                          </p>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-2 mt-2 border-t border-indigo-100/60">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/orcamentos/${q.id}`)}
                            className="h-7 text-xs text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 px-2 font-medium"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            Ver Orçamento
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                }

                const msg = item.data
                const isClient = msg.sender === 'client'
                const isAi = msg.sender === 'ai'

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`relative max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm ${
                        isClient
                          ? 'bg-[#d9fdd3] text-slate-900 rounded-tr-xs border border-[#c1e8ba]'
                          : 'bg-white text-slate-900 rounded-tl-xs border border-slate-200'
                      }`}
                    >
                      {/* Indicador de remetente caso seja IA ou Atendente */}
                      {!isClient && (
                        <div className="flex items-center gap-1 mb-1">
                          {isAi ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              <Sparkles className="w-3 h-3 text-emerald-600" /> Assistente IA
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                              <User className="w-3 h-3 text-blue-600" /> Atendente RPA
                            </span>
                          )}
                        </div>
                      )}

                      {/* Badge discreto quando a mensagem do cliente veio de áudio transcrito */}
                      {isClient && msg.isAudio && (
                        <div className="flex items-center gap-1 mb-1">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-600/10 text-emerald-800 border border-emerald-600/20">
                            <Mic className="w-2.5 h-2.5 text-emerald-700" /> Áudio transcrito
                          </span>
                        </div>
                      )}

                      {/* Bloco de Anexo (Áudio, Imagem, Vídeo ou Documento) se houver */}
                      {(msg.attachmentUrl || (msg.isAudio && msg.audioUrl)) && (
                        <div className="mb-2">
                          {msg.attachmentType === 'audio' ||
                          msg.isAudio ||
                          (msg.attachmentUrl &&
                            (msg.attachmentUrl.startsWith('data:audio/') ||
                              /\.(ogg|mp3|wav|m4a|aac|opus|weba)$/i.test(
                                msg.attachmentName || '',
                              ) ||
                              /\.(ogg|mp3|wav|m4a|aac|opus|weba)(\?.*)?$/i.test(
                                msg.attachmentUrl,
                              ))) ? (
                            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/90 flex flex-col gap-1.5 min-w-[260px] max-w-sm">
                              <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <Mic className="w-3.5 h-3.5 text-emerald-600" />
                                  {msg.attachmentName || 'Mensagem de voz'}
                                </span>
                                {(msg.attachmentUrl || msg.audioUrl) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDownloadAttachment(
                                        (msg.attachmentUrl || msg.audioUrl)!,
                                        msg.attachmentName || 'audio.mp3',
                                      )
                                    }
                                    className="text-slate-500 hover:text-emerald-700 p-0.5"
                                    title="Baixar áudio"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              <audio
                                controls
                                preload="metadata"
                                src={msg.attachmentUrl || msg.audioUrl}
                                className="w-full h-8"
                              >
                                Seu navegador não suporta a reprodução de áudio.
                              </audio>
                            </div>
                          ) : msg.attachmentType === 'image' ||
                            (msg.attachmentUrl && msg.attachmentUrl.startsWith('data:image/')) ||
                            /\.(jpg|jpeg|png|webp|gif)$/i.test(msg.attachmentName || '') ? (
                            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50 relative group">
                              <img
                                src={msg.attachmentUrl}
                                alt={msg.attachmentName || 'Imagem anexada'}
                                className="max-h-64 w-auto object-cover rounded-lg cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={() => {
                                  setPreviewMediaUrl(msg.attachmentUrl!)
                                  setPreviewMediaTitle(msg.attachmentName || 'Visualizar Imagem')
                                  setPreviewMediaType('image')
                                }}
                              />
                              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-md p-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreviewMediaUrl(msg.attachmentUrl!)
                                    setPreviewMediaTitle(msg.attachmentName || 'Visualizar Imagem')
                                    setPreviewMediaType('image')
                                  }}
                                  className="text-white hover:text-emerald-300 p-1"
                                  title="Expandir"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadAttachment(
                                      msg.attachmentUrl!,
                                      msg.attachmentName || 'imagem.png',
                                    )
                                  }
                                  className="text-white hover:text-emerald-300 p-1"
                                  title="Baixar imagem"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : msg.attachmentType === 'video' ||
                            (msg.attachmentUrl && msg.attachmentUrl.startsWith('data:video/')) ||
                            /\.(mp4|webm|mov|m4v|3gp)$/i.test(msg.attachmentName || '') ? (
                            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-900 relative group max-w-sm">
                              <video
                                controls
                                preload="metadata"
                                src={msg.attachmentUrl}
                                className="max-h-64 w-full object-cover rounded-lg bg-black"
                              >
                                Seu navegador não suporta a reprodução de vídeo.
                              </video>
                              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/90 text-white text-[11px]">
                                <span className="truncate font-medium text-slate-300 max-w-[200px]">
                                  {msg.attachmentName || 'Vídeo'}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPreviewMediaUrl(msg.attachmentUrl!)
                                      setPreviewMediaTitle(msg.attachmentName || 'Visualizar Vídeo')
                                      setPreviewMediaType('video')
                                    }}
                                    className="p-1 text-slate-300 hover:text-white"
                                    title="Ampliar vídeo"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDownloadAttachment(
                                        msg.attachmentUrl!,
                                        msg.attachmentName || 'video.mp4',
                                      )
                                    }
                                    className="p-1 text-slate-300 hover:text-white"
                                    title="Baixar vídeo"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-slate-100/90 transition-colors">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                                  <File className="w-5 h-5" />
                                </div>
                                <div className="truncate">
                                  <p className="text-xs font-semibold text-slate-800 truncate">
                                    {msg.attachmentName || 'Documento Anexo'}
                                  </p>
                                  <span className="text-[10px] text-slate-500 font-medium">
                                    Documento WhatsApp
                                  </span>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleDownloadAttachment(
                                    msg.attachmentUrl!,
                                    msg.attachmentName || 'documento.pdf',
                                  )
                                }
                                className="h-8 px-2 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 shrink-0 font-medium"
                                title="Baixar documento"
                              >
                                <Download className="w-3.5 h-3.5 mr-1" />
                                Baixar
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Texto da mensagem / Legenda */}
                      {msg.text ? (
                        <p className="whitespace-pre-wrap leading-relaxed text-sm break-words">
                          {msg.text}
                        </p>
                      ) : null}

                      {/* Horário e confirmação de leitura */}
                      <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-500">
                        <span>{msg.time}</span>
                        {isClient && (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-600 ml-0.5 inline" />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Indicador discreto "Novas mensagens ↓" se o usuário estiver navegando o histórico */}
            {hasUnreadBelow && (
              <div className="absolute bottom-16 right-6 z-20">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => scrollToBottom('smooth')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs shadow-md rounded-full px-3 py-1.5 flex items-center gap-1.5 border border-emerald-500 animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <span>Novas mensagens</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* Input oculto de arquivo com limites de 15MB e tipos de arquivo permitidos */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Aviso fixo caso o WhatsApp não esteja conectado */}
            {isWhatsAppConnected === false && (
              <div className="bg-amber-50 border-t border-amber-200 px-3 py-1.5 flex items-center justify-between text-xs text-amber-900">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    WhatsApp não conectado (modo wa.me ativo). Envio de anexos desabilitado neste
                    modo.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => checkConnectionStatus()}
                  disabled={checkingConnection}
                  className="text-[11px] underline font-medium text-amber-800 hover:text-amber-950"
                >
                  {checkingConnection ? 'Verificando...' : 'Reverificar'}
                </button>
              </div>
            )}

            {/* Barra inferior: Modo de Gravação de Áudio OU Formulário de Envio (Anexo, Produtos, Input, Mic, Enviar) */}
            {isRecordingAudio ? (
              <div className="p-3 bg-rose-50/70 border-t border-rose-200 flex items-center justify-between gap-3 animate-in fade-in duration-150">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600" />
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-rose-900">Gravando áudio...</span>
                    <span className="font-mono text-xs font-bold text-rose-700 bg-white/80 px-2 py-0.5 rounded border border-rose-200">
                      {formatAudioTimer(recordingSeconds)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={cancelAudioRecording}
                    disabled={isSendingAudio}
                    className="h-8 px-3 text-xs border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800 font-medium"
                    title="Descartar gravação"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={stopAndSendAudioRecording}
                    disabled={isSendingAudio}
                    className="h-8 px-3.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                    title="Concluir gravação e enviar mensagem de voz"
                  >
                    <Send className="w-3.5 h-3.5 mr-1" />
                    {isSendingAudio ? 'Enviando...' : 'Enviar'}
                  </Button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSendMessage}
                className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
              >
                {/* Botão de Anexo (ícone de clipe) */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClipClick}
                  disabled={checkingConnection}
                  className="h-9 w-9 p-0 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 border-slate-200 shrink-0"
                  title={
                    isWhatsAppConnected === false
                      ? 'Anexo indisponível: WhatsApp desconectado'
                      : 'Anexar arquivo (PDF, imagens, documentos até 15MB)'
                  }
                >
                  <Paperclip className="w-4 h-4" />
                </Button>

                {/* Botão Buscar Produtos ao lado do campo de mensagem */}
                <Button
                  type="button"
                  onClick={handleOpenProductQuote}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold px-2 text-xs shrink-0 transition-colors shadow-2xs h-9"
                  title="Buscar produtos no estoque e montar orçamento"
                >
                  <PackageSearch className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  <span>Produtos</span>
                </Button>

                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Responder a ${activeCustomer.name}...`}
                  className="flex-1 bg-slate-50 border-slate-200 focus:bg-white text-sm h-9"
                />

                {/* Botão de Microfone para gravar áudio */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={startAudioRecording}
                  disabled={isSendingAudio || checkingConnection}
                  className="h-9 w-9 p-0 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 border-slate-200 shrink-0"
                  title="Gravar mensagem de voz"
                >
                  <Mic className="w-4 h-4" />
                </Button>

                <Button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 shrink-0 transition-colors shadow-sm h-9"
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  Enviar
                </Button>
              </form>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-slate-400">
            <div className="max-w-xs space-y-2">
              <MessageCircle className="w-12 h-12 mx-auto text-slate-300" />
              <p className="font-semibold text-slate-600">Nenhuma conversa selecionada</p>
              <p className="text-xs text-slate-400">
                Selecione um cliente na barra lateral para visualizar as mensagens e responder.
              </p>
            </div>
          </div>
        )}

        {/* LADO DIREITO EXTREMO: Histórico de Orçamentos do Cliente Vinculado */}
        {activeCustomer && showHistoryPanel && (
          <CustomerQuoteHistory
            customerId={activeCustomer.customerId}
            customerPhone={activeCustomer.rawPhone}
            customerName={activeCustomer.name}
            onOpenCreateQuote={handleOpenProductQuote}
            refreshTrigger={historyRefreshKey}
          />
        )}
      </div>

      {/* Modal de Busca de Produtos no Estoque e Montagem de Orçamento */}
      {activeCustomer && (
        <ProductQuoteModal
          isOpen={isProductModalOpen}
          onClose={() => setIsProductModalOpen(false)}
          customer={{
            id: activeCustomer.customerId,
            name: activeCustomer.name,
            phone: activeCustomer.rawPhone || activeCustomer.phone,
            company: activeCustomer.company,
          }}
          onQuoteSent={(quoteNumber) => {
            setHistoryRefreshKey((k) => k + 1)
            fetchData(true)
          }}
        />
      )}

      {/* Modal de Envio de Arquivo com Legenda Opcional */}
      <Dialog
        open={isAttachmentModalOpen}
        onOpenChange={(open) => {
          if (!open && !isSendingAttachment) {
            setIsAttachmentModalOpen(false)
            setSelectedFile(null)
            setFileBase64('')
            setFileCaption('')
          }
        }}
      >
        <DialogContent className="max-w-md p-0 overflow-hidden bg-white">
          <DialogHeader className="p-4 border-b border-slate-200 bg-slate-50/70">
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-emerald-600" />
              Enviar Anexo via WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="p-5 space-y-4 text-xs">
            {selectedFile && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  {selectedFile.type.startsWith('image/') ? (
                    <Eye className="w-5 h-5" />
                  ) : (
                    <File className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{selectedFile.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB •{' '}
                    {selectedFile.type.startsWith('image/') ? 'Imagem' : 'Documento'}
                  </p>
                </div>
              </div>
            )}

            {/* Prévia da imagem se for imagem */}
            {selectedFile && selectedFile.type.startsWith('image/') && fileBase64 && (
              <div className="rounded-lg overflow-hidden border border-slate-200 max-h-52 flex items-center justify-center bg-slate-100">
                <img src={fileBase64} alt="Prévia" className="max-h-52 max-w-full object-contain" />
              </div>
            )}

            {/* Campo de legenda opcional */}
            <div className="space-y-1.5">
              <label htmlFor="file-caption-input" className="font-semibold text-slate-700 block">
                Legenda (opcional):
              </label>
              <Input
                id="file-caption-input"
                value={fileCaption}
                onChange={(e) => setFileCaption(e.target.value)}
                placeholder="Escreva uma mensagem junto com o arquivo..."
                className="text-xs bg-slate-50"
                disabled={isSendingAttachment}
              />
            </div>

            <p className="text-[11px] text-slate-500">
              O arquivo será enviado diretamente para o WhatsApp do cliente através da conexão ativa
              da RPA Auto Parts.
            </p>
          </div>

          <DialogFooter className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSendingAttachment}
              onClick={() => {
                setIsAttachmentModalOpen(false)
                setSelectedFile(null)
                setFileBase64('')
                setFileCaption('')
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSendAttachment}
              disabled={isSendingAttachment || !selectedFile}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
            >
              {isSendingAttachment ? 'Enviando anexo...' : 'Enviar Arquivo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Prévia Ampliada de Imagens ou Vídeos */}
      <Dialog
        open={!!previewMediaUrl}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewMediaUrl(null)
            setPreviewMediaTitle('')
            setPreviewMediaType('image')
          }
        }}
      >
        <DialogContent className="max-w-3xl p-4 bg-black/90 border-slate-800 text-white">
          <div className="flex items-center justify-between pb-2 border-b border-slate-700">
            <span className="text-sm font-semibold truncate text-slate-200">
              {previewMediaTitle ||
                (previewMediaType === 'video' ? 'Visualização do Vídeo' : 'Visualização da Imagem')}
            </span>
            <div className="flex items-center gap-2">
              {previewMediaUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    handleDownloadAttachment(
                      previewMediaUrl,
                      previewMediaTitle ||
                        (previewMediaType === 'video' ? 'video.mp4' : 'imagem.png'),
                    )
                  }
                  className="h-7 text-xs bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700 hover:text-white"
                >
                  <Download className="w-3.5 h-3.5 mr-1" /> Baixar
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center p-2 max-h-[75vh] overflow-auto">
            {previewMediaUrl && previewMediaType === 'video' ? (
              <video
                controls
                autoPlay
                src={previewMediaUrl}
                className="max-h-[70vh] max-w-full object-contain rounded"
              >
                Seu navegador não suporta o formato de vídeo.
              </video>
            ) : previewMediaUrl ? (
              <img
                src={previewMediaUrl}
                alt={previewMediaTitle || 'Imagem'}
                className="max-h-[70vh] max-w-full object-contain rounded"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
