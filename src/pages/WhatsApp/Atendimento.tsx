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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { openWhatsApp } from '@/lib/whatsapp'
import { useNavigate } from 'react-router-dom'
import {
  WhatsAppCustomer,
  WhatsAppMessage,
  WhatsAppStatus,
  loadWhatsAppConversations,
} from '@/services/whatsappChat'
import { useRealtime } from '@/hooks/use-realtime'
import { sendWhatsAppMessage } from '@/services/quotes'
import { ProductQuoteModal } from '@/components/WhatsApp/ProductQuoteModal'
import { CustomerQuoteHistory } from '@/components/WhatsApp/CustomerQuoteHistory'
import { createCustomer } from '@/services/customers'
import { toast } from '@/hooks/use-toast'

export type { WhatsAppStatus, WhatsAppMessage, WhatsAppCustomer }

export default function WhatsAppAtendimento() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<WhatsAppCustomer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todos' | WhatsAppStatus>('todos')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PF' | 'PJ'>('ALL')
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)

  // Estados dos novos recursos de Orçamentos e Histórico
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(true)

  const chatContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = useRef(true)
  const prevCustomerIdRef = useRef<string | null>(null)
  const prevMessagesCountRef = useRef<number>(0)
  const shouldScrollOnSendRef = useRef(false)

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true)
    try {
      const data = await loadWhatsAppConversations()
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

  // Carga inicial
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime subscription para webhook_received e message_processing
  useRealtime('webhook_received', () => {
    fetchData(true)
  })
  useRealtime('message_processing', () => {
    fetchData(true)
  })

  // Polling leve a cada 12 segundos para garantir sincronização caso realtime falhe
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(true)
    }, 12000)
    return () => clearInterval(interval)
  }, [fetchData])

  const activeCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0]

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
    const currentMessagesCount = activeCustomer.messages.length
    const isNewConversation = prevCustomerIdRef.current !== currentCustId
    const hadMessages = prevMessagesCountRef.current
    const messageAdded = currentMessagesCount > hadMessages

    if (isNewConversation) {
      // (a) Ao abrir/selecionar conversa pela primeira vez: rolar direto para o fim
      prevCustomerIdRef.current = currentCustId
      prevMessagesCountRef.current = currentMessagesCount
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
      prevMessagesCountRef.current = currentMessagesCount
      requestAnimationFrame(() => {
        scrollToBottom('smooth')
      })
      return
    }

    if (messageAdded) {
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

    prevMessagesCountRef.current = currentMessagesCount
  }, [activeCustomer?.id, activeCustomer?.messages])

  const filteredCustomers = customers.filter((c) => {
    if (statusFilter !== 'todos' && c.status !== statusFilter) return false
    if (typeFilter !== 'ALL' && c.type !== typeFilter) return false
    if (
      search &&
      !c.name.toLowerCase().includes(search.toLowerCase()) &&
      !c.phone.includes(search) &&
      !(c.company || '').toLowerCase().includes(search.toLowerCase())
    ) {
      return false
    }
    return true
  })

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
            messages: [...c.messages, newMsg],
          }
        }
        return c
      }),
    )

    setInputText('')

    // Enviar via backend Z-API se configurado
    try {
      const sendRes = await sendWhatsAppMessage(activeCustomer.rawPhone, textToSend)
      if (!sendRes.zapiSuccess) {
        console.log('Mensagem registrada localmente. Z-API offline ou não configurada.')
      }
    } catch (sendErr) {
      console.warn('Erro ao disparar mensagem para o backend:', sendErr)
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

  const handleUpdateStatus = (newStatus: WhatsAppStatus) => {
    if (!activeCustomer) return
    setCustomers((prev) =>
      prev.map((c) => (c.id === activeCustomer.id ? { ...c, status: newStatus } : c)),
    )
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row h-[calc(100vh-210px)] min-h-[580px]">
        {/* LADO ESQUERDO: Lista de conversas */}
        <div className="w-full md:w-[380px] lg:w-[420px] border-r border-slate-200 flex flex-col bg-slate-50/50">
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

              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setStatusFilter('todos')}
                  className={`px-2 py-1 rounded font-medium transition-colors ${
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
                  className={`px-2 py-1 rounded font-medium transition-colors ${
                    statusFilter === 'novo'
                      ? 'bg-amber-100 text-amber-800 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Novos
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('em_atendimento')}
                  className={`px-2 py-1 rounded font-medium transition-colors ${
                    statusFilter === 'em_atendimento'
                      ? 'bg-emerald-100 text-emerald-800 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Ativos
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
                const lastMsg = customer.messages[customer.messages.length - 1]

                return (
                  <div
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomerId(customer.id)
                      // marca lido
                      if (customer.unreadCount) {
                        setCustomers((prev) =>
                          prev.map((c) => (c.id === customer.id ? { ...c, unreadCount: 0 } : c)),
                        )
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
                  title="Histórico de orçamentos do cliente"
                >
                  <History className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  Histórico
                </Button>

                {/* Alterar status */}
                <select
                  aria-label="Status do atendimento"
                  value={activeCustomer.status}
                  onChange={(e) => handleUpdateStatus(e.target.value as WhatsAppStatus)}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 hidden sm:block"
                >
                  <option value="novo">Status: Novo</option>
                  <option value="em_atendimento">Status: Em atendimento</option>
                  <option value="resolvido">Status: Resolvido</option>
                </select>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openWhatsApp(activeCustomer.phone, 'Olá!')}
                  className="hidden md:flex text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                  title="Abrir WhatsApp oficial"
                >
                  <Phone className="w-3.5 h-3.5 mr-1" />
                  WhatsApp
                </Button>
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

              {activeCustomer.messages.map((msg) => {
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
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                              <Sparkles className="w-3 h-3 text-emerald-600" /> Assistente IA
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-slate-600">
                              Atendente RPA
                            </span>
                          )}
                        </div>
                      )}

                      {/* Texto da mensagem */}
                      <p className="whitespace-pre-wrap leading-relaxed text-sm break-words">
                        {msg.text}
                      </p>

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

            {/* Barra inferior: Campo de texto para resposta manual, Botão Buscar Produtos e botão Enviar */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              {/* Botão Buscar Produtos ao lado do campo de mensagem */}
              <Button
                type="button"
                onClick={handleOpenProductQuote}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold px-2 text-xs shrink-0 transition-colors shadow-2xs"
                title="Buscar produtos no estoque e montar orçamento"
              >
                <PackageSearch className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                <span>Produtos</span>
              </Button>

              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Responder a ${activeCustomer.name}...`}
                className="flex-1 bg-slate-50 border-slate-200 focus:bg-white text-sm"
              />
              <Button
                type="submit"
                disabled={!inputText.trim()}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 shrink-0 transition-colors shadow-sm"
              >
                <Send className="w-4 h-4 mr-1.5" />
                Enviar
              </Button>
            </form>
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
            fetchData(true)
          }}
        />
      )}
    </div>
  )
}
