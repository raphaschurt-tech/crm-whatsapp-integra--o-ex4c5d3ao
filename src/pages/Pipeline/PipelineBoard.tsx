import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Filter,
  RefreshCw,
  AlertTriangle,
  Plus,
  Users,
  Search,
  DollarSign,
  UserCheck,
  Calendar,
  ArrowUpDown,
} from 'lucide-react'
import {
  PIPELINE_COLUMNS,
  PipelineColumnId,
  PipelineCardData,
  loadPipelineBoardData,
  updateCustomerPipelineStatus,
} from '@/services/pipelineService'
import { deleteCustomer } from '@/services/customers'
import { useAuth } from '@/hooks/use-auth'
import { getUsers } from '@/services/users'
import { User } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'
import { useNavigate } from 'react-router-dom'
import { PipelineCard } from './PipelineCard'
import { PipelineCustomerDrawer } from './PipelineCustomerDrawer'
import { LostReasonModal } from './LostReasonModal'

export default function PipelineBoard() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  // Handler de exclusão de lead (apenas admin)
  const handleDeleteLead = async (customerId: string, customerName: string) => {
    try {
      await deleteCustomer(customerId)
      toast({
        title: 'Lead excluído',
        description: `O lead "${customerName}" foi removido do funil.`,
      })
      // Remove do estado local imediatamente
      setCards((prev) => prev.filter((c) => c.customer.id !== customerId))
      if (selectedCard && selectedCard.customer.id === customerId) {
        setSelectedCard(null)
      }
    } catch (err: any) {
      console.error('Erro ao excluir lead:', err)
      const errorMsg =
        err?.status === 403 || err?.data?.message?.includes('administradores')
          ? 'Apenas administradores têm permissão para excluir clientes ou leads.'
          : err?.message || 'Falha ao excluir o lead.'
      toast({
        title: 'Erro ao excluir lead',
        description: errorMsg,
        variant: 'destructive',
      })
    }
  }

  // Estado dos dados
  const [cards, setCards] = useState<PipelineCardData[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Filtros
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PF' | 'PJ'>('ALL')
  const [entityFilter, setEntityFilter] = useState<'ALL' | 'cliente' | 'fornecedor'>('ALL')
  const [sourceFilter, setSourceFilter] = useState<
    'ALL' | 'whatsapp' | 'instagram' | 'google' | 'other'
  >('ALL')
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Ordenação dos cards nas colunas: 'recentes' (padrão) ou 'antigos'
  // Persistência durante a sessão via sessionStorage
  const [sortOrder, setSortOrder] = useState<'recentes' | 'antigos'>(() => {
    try {
      const saved = sessionStorage.getItem('pipeline_sort_order')
      if (saved === 'recentes' || saved === 'antigos') {
        return saved
      }
    } catch {
      // sessionStorage não disponível (ex: modo restrito)
    }
    return 'recentes'
  })

  // Atualiza sessionStorage quando a ordem mudar
  const handleSortOrderChange = (order: 'recentes' | 'antigos') => {
    setSortOrder(order)
    try {
      sessionStorage.setItem('pipeline_sort_order', order)
    } catch {
      // ignore
    }
  }

  // Drag and drop state
  const [draggedCustomerId, setDraggedCustomerId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<PipelineColumnId | null>(null)

  // Drawer lateral
  const [selectedCard, setSelectedCard] = useState<PipelineCardData | null>(null)

  // Modal de Motivo de Perda
  const [lostReasonTarget, setLostReasonTarget] = useState<{
    customerId: string
    customerName: string
  } | null>(null)
  const [isSavingLostReason, setIsSavingLostReason] = useState(false)

  // Carga dos dados
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true)
    try {
      const [boardData, userList] = await Promise.all([
        loadPipelineBoardData(),
        getUsers().catch(() => [] as User[]),
      ])
      setCards(boardData.cards)
      setUsers(userList || [])
      setLoadError(null)

      // Atualizar o card selecionado no drawer se estiver aberto
      setSelectedCard((prev) => {
        if (!prev) return null
        const updated = boardData.cards.find((c) => c.customer.id === prev.customer.id)
        return updated || null
      })
    } catch (err: any) {
      console.error('Erro ao carregar Pipeline:', err)
      setLoadError(
        err?.message || 'Falha ao conectar com o servidor. O serviço pode estar reiniciando.',
      )
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Assinaturas realtime para atualizar automaticamente
  useRealtime('customers', () => loadData(true))
  useRealtime('quotes', () => loadData(true))
  useRealtime('webhook_received', () => loadData(true))
  useRealtime('message_processing', () => loadData(true))
  useRealtime('purchase_requests', () => loadData(true))

  // Filtros aplicados sobre os cards
  const filteredCards = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime()
    const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).getTime()

    return cards.filter((item) => {
      // Classificação Cliente ou Fornecedor
      const isSupplier = item.customer.customer_type === 'fornecedor'
      if (entityFilter === 'cliente' && isSupplier) return false
      if (entityFilter === 'fornecedor' && !isSupplier) return false

      // 1. Tipo (PF / PJ / ALL)
      const cType = item.customer.type || (item.customer.cnpj ? 'PJ' : 'PF')
      if (typeFilter !== 'ALL' && cType !== typeFilter) {
        return false
      }

      // Origem do Lead (Filtro por Canal)
      if (sourceFilter !== 'ALL') {
        const itemSource = item.customer.lead_source || 'other'
        if (itemSource !== sourceFilter) {
          return false
        }
      }

      // 2. Período baseado na última interação ou data de criação do cliente
      const targetTime = item.lastInteractionTimestamp || new Date(item.customer.created).getTime()
      if (periodFilter === 'today' && targetTime < startOfToday) {
        return false
      }
      if (periodFilter === 'week' && targetTime < startOfWeek) {
        return false
      }
      if (periodFilter === 'month' && targetTime < startOfMonth) {
        return false
      }

      // 3. Responsável / Colaborador
      if (selectedUser !== 'all') {
        // Se houver filtro específico de usuário
        // Em customers ou quotes, caso não haja campo dedicado,
        // mantemos compatibilidade verificando se coincide com autor/owner se existir
        // Caso não coincida, retorna falso
        const matchUser =
          (item.customer as any).owner === selectedUser ||
          (item.customer as any).assigned_to === selectedUser
        if (!matchUser) return false
      }

      // 4. Busca por texto
      if (search.trim()) {
        const s = search.toLowerCase()
        const match =
          item.customer.name.toLowerCase().includes(s) ||
          (item.customer.contact_name || '').toLowerCase().includes(s) ||
          item.customer.phone.includes(s) ||
          (item.customer.company || '').toLowerCase().includes(s) ||
          (item.customer.cpf || '').includes(s) ||
          (item.customer.cnpj || '').includes(s) ||
          (item.activeQuote && item.activeQuote.number.toLowerCase().includes(s))
        if (!match) return false
      }

      return true
    })
  }, [cards, entityFilter, typeFilter, sourceFilter, periodFilter, selectedUser, search])

  // Agrupamento por colunas
  const columnsData = useMemo(() => {
    const grouped: Record<PipelineColumnId, PipelineCardData[]> = {
      fornecedores: [],
      novo_lead: [],
      em_atendimento: [],
      orcamento_enviado: [],
      aguardando_pagamento: [],
      fechado: [],
      perdido: [],
    }

    for (const card of filteredCards) {
      if (grouped[card.columnId]) {
        grouped[card.columnId].push(card)
      } else if (card.customer.customer_type === 'fornecedor') {
        grouped.fornecedores.push(card)
      } else {
        grouped.novo_lead.push(card)
      }
    }

    // Ordenar cards de TODAS as colunas simultaneamente com base na data de entrada na etapa
    // 'recentes': primeiro os que entraram por último na etapa (descendente: maior timestamp primeiro)
    // 'antigos': primeiro os que estão há mais tempo na etapa (ascendente: menor timestamp primeiro)
    ;(Object.keys(grouped) as PipelineColumnId[]).forEach((colId) => {
      grouped[colId].sort((a, b) => {
        const timeA =
          a.stageEnteredTimestamp || new Date(a.customer.updated || a.customer.created).getTime()
        const timeB =
          b.stageEnteredTimestamp || new Date(b.customer.updated || b.customer.created).getTime()
        return sortOrder === 'recentes' ? timeB - timeA : timeA - timeB
      })
    })

    return grouped
  }, [filteredCards, sortOrder])

  // Métricas gerais
  const metrics = useMemo(() => {
    const totalPipelineValue = filteredCards.reduce(
      (acc, c) => acc + (c.totalQuoteAmount || c.activeQuote?.total || 0),
      0,
    )
    const closedValue = (columnsData.fechado || []).reduce(
      (acc, c) => acc + (c.totalQuoteAmount || c.activeQuote?.total || 0),
      0,
    )
    return {
      totalCards: filteredCards.length,
      totalPipelineValue,
      closedValue,
    }
  }, [filteredCards, columnsData])

  // Executa efetivamente a movimentação da coluna com ou sem dados de motivo de perda
  const executeMoveCustomer = async (
    customerId: string,
    targetCol: PipelineColumnId,
    lostReasonData?: { lost_reason?: string; lost_reason_detail?: string },
  ) => {
    const targetCard = cards.find((c) => c.customer.id === customerId)
    if (!targetCard) return

    // Otimisticamente atualizar no estado local
    setCards((prev) =>
      prev.map((c) => {
        if (c.customer.id === customerId) {
          const nowIso = new Date().toISOString()
          const updatedCustomer = {
            ...c.customer,
            pipeline_status: targetCol,
            updated: nowIso,
            lost_reason: targetCol === 'perdido' ? lostReasonData?.lost_reason || '' : '',
            lost_reason_detail:
              targetCol === 'perdido' ? lostReasonData?.lost_reason_detail || '' : '',
          }
          return {
            ...c,
            customer: updatedCustomer,
            columnId: targetCol,
            stageEnteredTimestamp: Date.now(),
            isManualOverride: true,
          }
        }
        return c
      }),
    )

    if (selectedCard && selectedCard.customer.id === customerId) {
      setSelectedCard((prev) => {
        if (!prev) return null
        const nowIso = new Date().toISOString()
        const updatedCustomer = {
          ...prev.customer,
          pipeline_status: targetCol,
          updated: nowIso,
          lost_reason: targetCol === 'perdido' ? lostReasonData?.lost_reason || '' : '',
          lost_reason_detail:
            targetCol === 'perdido' ? lostReasonData?.lost_reason_detail || '' : '',
        }
        return {
          ...prev,
          customer: updatedCustomer,
          columnId: targetCol,
          stageEnteredTimestamp: Date.now(),
          isManualOverride: true,
        }
      })
    }

    try {
      await updateCustomerPipelineStatus(customerId, targetCol, lostReasonData)
      const colDef = PIPELINE_COLUMNS.find((col) => col.id === targetCol)
      toast({
        title: 'Status atualizado',
        description: `${targetCard.customer.name} movido para "${colDef?.label}".`,
      })
    } catch (err: any) {
      console.error('Erro ao mover cliente:', err)
      toast({
        title: 'Erro ao atualizar status',
        description: err?.message || 'Falha ao salvar no servidor.',
        variant: 'destructive',
      })
      // Reverter
      loadData(true)
    }
  }

  // Movimentação de coluna (Drag and Drop ou Drawer)
  const handleMoveCustomerToColumn = async (customerId: string, targetCol: PipelineColumnId) => {
    // Encontrar o card
    const targetCard = cards.find((c) => c.customer.id === customerId)
    if (!targetCard) return

    if (targetCard.columnId === targetCol) return

    // Se estiver sendo movido para a coluna 'perdido', intercepta para abrir o modal de motivo
    if (targetCol === 'perdido') {
      setLostReasonTarget({
        customerId,
        customerName: targetCard.customer.name,
      })
      return
    }

    // Se for outra coluna, move direto (se estava em perdido, limpa lost_reason no backend e frontend)
    await executeMoveCustomer(customerId, targetCol)
  }

  // Confirmação do motivo no modal
  const handleConfirmLostReason = async ({
    reason,
    detail,
  }: {
    reason: string
    detail?: string
  }) => {
    if (!lostReasonTarget) return
    setIsSavingLostReason(true)
    try {
      await executeMoveCustomer(lostReasonTarget.customerId, 'perdido', {
        lost_reason: reason,
        lost_reason_detail: detail,
      })
      setLostReasonTarget(null)
    } finally {
      setIsSavingLostReason(false)
    }
  }

  // Cancelamento do modal: mantém o card onde está
  const handleCancelLostReason = () => {
    setLostReasonTarget(null)
  }

  // Restaurar cálculo automático
  const handleResetToAuto = async (customerId: string) => {
    try {
      await updateCustomerPipelineStatus(customerId, '')
      toast({
        title: 'Modo automático reativado',
        description: 'O status do cliente agora é calculado pelas interações e orçamentos.',
      })
      loadData(true)
    } catch (err: any) {
      console.error('Erro ao resetar status:', err)
      toast({
        title: 'Erro ao resetar status',
        variant: 'destructive',
      })
    }
  }

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, customerId: string) => {
    setDraggedCustomerId(customerId)
  }

  const handleDragOverColumn = (e: React.DragEvent<HTMLDivElement>, colId: PipelineColumnId) => {
    e.preventDefault()
    if (dragOverCol !== colId) {
      setDragOverCol(colId)
    }
  }

  const handleDragLeaveColumn = (e: React.DragEvent<HTMLDivElement>, colId: PipelineColumnId) => {
    e.preventDefault()
    if (dragOverCol === colId) {
      setDragOverCol(null)
    }
  }

  const handleDropColumn = (e: React.DragEvent<HTMLDivElement>, colId: PipelineColumnId) => {
    e.preventDefault()
    setDragOverCol(null)
    const custId = e.dataTransfer.getData('text/plain') || draggedCustomerId
    if (custId) {
      handleMoveCustomerToColumn(custId, colId)
    }
    setDraggedCustomerId(null)
  }

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Filter className="h-6 w-6 text-emerald-600" />
            Pipeline de Vendas
          </h1>
          <p className="text-sm text-slate-500">
            Funil comercial inteligente integrado com WhatsApp, orçamentos e pagamentos
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(false)}
            disabled={isRefreshing}
            className="text-slate-700"
            title="Recarregar dados do pipeline"
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 text-emerald-600 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Atualizar
          </Button>

          <Button
            onClick={() => navigate('/orcamentos/novo')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs text-xs sm:text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Orçamento
          </Button>
        </div>
      </div>

      {/* Mini Resumo de Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Clientes no Funil</span>
            <p className="text-xl font-bold text-slate-900 mt-0.5">{metrics.totalCards}</p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Volume Total em Negociação</span>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {formatCurrency(metrics.totalPipelineValue)}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs col-span-2 sm:col-span-1">
          <div>
            <span className="text-xs text-slate-500 font-medium">Negócios Fechados</span>
            <p className="text-xl font-bold text-emerald-700 mt-0.5">
              {formatCurrency(metrics.closedValue)}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <UserCheck className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Barra de Filtros no Topo */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Busca e Tipo */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar cliente, telefone, orçamento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 focus:bg-white"
            />
          </div>

          {/* Filtro Cliente / Fornecedor e PF / PJ */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg self-start sm:self-auto text-xs">
              <button
                type="button"
                onClick={() => setEntityFilter('ALL')}
                className={`px-2.5 py-1 font-semibold rounded-md transition-colors ${
                  entityFilter === 'ALL'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setEntityFilter('cliente')}
                className={`px-2.5 py-1 font-semibold rounded-md transition-colors ${
                  entityFilter === 'cliente'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Clientes
              </button>
              <button
                type="button"
                onClick={() => setEntityFilter('fornecedor')}
                className={`px-2.5 py-1 font-semibold rounded-md transition-colors ${
                  entityFilter === 'fornecedor'
                    ? 'bg-white text-amber-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fornecedores
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg self-start sm:self-auto text-xs">
              <button
                type="button"
                onClick={() => setTypeFilter('ALL')}
                className={`px-2 py-1 font-semibold rounded-md transition-colors ${
                  typeFilter === 'ALL'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('PF')}
                className={`px-2 py-1 font-semibold rounded-md transition-colors ${
                  typeFilter === 'PF'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PF
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('PJ')}
                className={`px-2 py-1 font-semibold rounded-md transition-colors ${
                  typeFilter === 'PJ'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PJ
              </button>
            </div>
          </div>
        </div>

        {/* Filtros de Período e Responsável */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Origem do Lead */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <select
              aria-label="Filtrar por origem do lead"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="ALL">Todas as origens</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="google">Google</option>
              <option value="other">Outros</option>
            </select>
          </div>

          {/* Período */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <select
              aria-label="Filtrar por período"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as any)}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="all">Todo o período</option>
              <option value="today">Hoje</option>
              <option value="week">Últimos 7 dias</option>
              <option value="month">Últimos 30 dias</option>
            </select>
          </div>

          {/* Responsável */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <Users className="h-3.5 w-3.5 text-slate-400" />
            <select
              aria-label="Filtrar por responsável"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer max-w-[150px] truncate"
            >
              <option value="all">Todos os responsáveis</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </div>

          {/* Seletor de Ordenação de Cards (Mais recentes / Mais antigos) */}
          <div
            className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs"
            title="Ordenar cards em todas as colunas por data de entrada na etapa"
          >
            <span className="flex items-center gap-1 px-1.5 text-slate-500 font-medium text-[11px]">
              <ArrowUpDown className="h-3 w-3 text-slate-400" />
              Ordem:
            </span>
            <button
              type="button"
              onClick={() => handleSortOrderChange('recentes')}
              className={`px-2 py-1 font-semibold rounded-md transition-colors ${
                sortOrder === 'recentes'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mais recentes
            </button>
            <button
              type="button"
              onClick={() => handleSortOrderChange('antigos')}
              className={`px-2 py-1 font-semibold rounded-md transition-colors ${
                sortOrder === 'antigos'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mais antigos
            </button>
          </div>
        </div>
      </div>

      {/* Estados de Carga / Erro */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-7 w-7 animate-spin text-emerald-600" />
          <p className="font-medium text-sm">Carregando quadro do Pipeline...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center space-y-3 shadow-xs">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-800 font-semibold">Não foi possível carregar o Pipeline.</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : (
        /* Quadro Kanban com 7 Colunas (Fornecedores primeiro + 6 etapas) */
        <div className="overflow-x-auto pb-6">
          <div className="flex gap-4 min-w-[1540px] items-start">
            {PIPELINE_COLUMNS.map((col) => {
              const columnCards = columnsData[col.id] || []
              const columnTotalAmount = columnCards.reduce(
                (acc, c) => acc + (c.totalQuoteAmount || c.activeQuote?.total || 0),
                0,
              )
              const isOver = dragOverCol === col.id

              return (
                <div
                  key={col.id}
                  onDragOver={(e) => handleDragOverColumn(e, col.id)}
                  onDragLeave={(e) => handleDragLeaveColumn(e, col.id)}
                  onDrop={(e) => handleDropColumn(e, col.id)}
                  className={`flex-1 min-w-[210px] max-w-[240px] bg-slate-100/70 rounded-xl border border-slate-200/80 flex flex-col transition-all ${
                    isOver
                      ? 'ring-2 ring-emerald-500 bg-emerald-50/40 border-emerald-300'
                      : 'hover:border-slate-300'
                  }`}
                >
                  {/* Cabeçalho da Coluna com border top colorido */}
                  <div
                    className={`p-3 bg-white rounded-t-xl border-b border-slate-200 border-t-4 ${col.borderColor}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <h3 className="font-bold text-slate-900 text-xs truncate" title={col.label}>
                        {col.label}
                      </h3>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {columnCards.length}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Total:</span>
                      <strong className="text-slate-800">
                        {formatCurrency(columnTotalAmount)}
                      </strong>
                    </div>
                  </div>

                  {/* Lista de Cards da Coluna */}
                  <div className="p-2.5 flex-1 space-y-2.5 min-h-[420px] max-h-[calc(100vh-340px)] overflow-y-auto">
                    {columnCards.length === 0 ? (
                      <div className="h-32 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-center p-3 text-slate-400 text-xs">
                        {isOver ? 'Soltar aqui' : 'Nenhum lead nesta etapa'}
                      </div>
                    ) : (
                      columnCards.map((card) => (
                        <PipelineCard
                          key={card.customer.id}
                          card={card}
                          isAdmin={isAdmin}
                          onDelete={handleDeleteLead}
                          onClick={() => setSelectedCard(card)}
                          onDragStart={handleDragStart}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Drawer Lateral com Histórico Completo do Cliente */}
      {selectedCard && (
        <PipelineCustomerDrawer
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onMoveColumn={handleMoveCustomerToColumn}
          onResetAuto={handleResetToAuto}
          onMessageSent={() => loadData(true)}
        />
      )}

      {/* Modal Obrigatório de Motivo de Perda */}
      <LostReasonModal
        isOpen={Boolean(lostReasonTarget)}
        customerName={lostReasonTarget?.customerName || ''}
        onClose={handleCancelLostReason}
        onConfirm={handleConfirmLostReason}
        isSubmitting={isSavingLostReason}
      />
    </div>
  )
}
