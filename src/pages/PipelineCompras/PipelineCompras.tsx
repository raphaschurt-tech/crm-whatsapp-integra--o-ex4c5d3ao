import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShoppingBag,
  RefreshCw,
  AlertTriangle,
  Plus,
  Search,
  DollarSign,
  TrendingUp,
  Package,
  ArrowUpDown,
  Car,
} from 'lucide-react'
import { Customer, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'
import {
  PURCHASE_COLUMNS,
  getPurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequest,
  movePurchaseRequestStatus,
  deletePurchaseRequest,
  normalizePurchaseItems,
  formatPurchaseItemsSummary,
  getTotalItemQuantity,
  getPurchaseTotals,
} from '@/services/purchaseRequestsService'
import { getCustomers } from '@/services/customers'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PurchaseCard } from './PurchaseCard'
import { PurchaseDrawer } from './PurchaseDrawer'
import { NewPurchaseModal } from './NewPurchaseModal'

export default function PipelineCompras() {
  const { toast } = useToast()

  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Drawer & Modal states
  const [selectedCard, setSelectedCard] = useState<PurchaseRequest | null>(null)
  const [isNewModalOpen, setIsNewModalOpen] = useState(false)

  // Drag & drop state
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<PurchaseRequestStatus | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('ALL')
  const [supplierFilter, setSupplierFilter] = useState('ALL')

  // Seletor "Mais recentes / Mais antigos" (consistência com Pipeline de Vendas)
  const [sortOrder, setSortOrder] = useState<'recentes' | 'antigos'>(() => {
    try {
      const saved = sessionStorage.getItem('pipeline_compras_sort_order')
      if (saved === 'recentes' || saved === 'antigos') {
        return saved
      }
    } catch {
      // sessionStorage indisponível
    }
    return 'recentes'
  })

  const handleSortOrderChange = (order: 'recentes' | 'antigos') => {
    setSortOrder(order)
    try {
      sessionStorage.setItem('pipeline_compras_sort_order', order)
    } catch {
      // ignore
    }
  }

  // Carregar dados
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true)
    try {
      const [reqList, custList] = await Promise.all([getPurchaseRequests(), getCustomers()])
      setRequests(reqList)
      setCustomers(custList)
      setLoadError(null)

      // Atualiza card selecionado se drawer estiver aberto
      setSelectedCard((prev) => {
        if (!prev) return null
        return reqList.find((r) => r.id === prev.id) || null
      })
    } catch (err: any) {
      console.error('Erro ao carregar Pipeline de Compras:', err)
      setLoadError(err?.message || 'Falha ao conectar com o servidor.')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Realtime updates
  useRealtime('purchase_requests', () => loadData(true))
  useRealtime('customers', () => loadData(true))

  // Lista de fornecedores (clientes com customer_type === 'fornecedor')
  const suppliers = useMemo(() => {
    return customers.filter((c) => c.customer_type === 'fornecedor')
  }, [customers])

  // Mapa de fornecedores id -> nome
  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const sup of suppliers) {
      map[sup.id] = sup.name || sup.company || ''
    }
    return map
  }, [suppliers])

  // Filtragem
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      const items = normalizePurchaseItems(req)

      // Filtro por cliente
      if (customerFilter !== 'ALL' && req.customer !== customerFilter) {
        return false
      }

      // Filtro por fornecedor: verifica fornecedor mestre e fornecedores em qualquer item
      if (supplierFilter !== 'ALL') {
        const hasSupplierInItems = items.some((it) => it.supplier_id === supplierFilter)
        if (req.supplier !== supplierFilter && !hasSupplierInItems) {
          return false
        }
      }

      // Busca por texto: OS, itens, fornecedor, cliente, veículo, observações
      if (search.trim()) {
        const s = search.toLowerCase()
        const customerName = (req.expand?.customer?.name || '').toLowerCase()
        const legacySupplierName = (
          req.expand?.supplier?.name ||
          req.expand?.supplier?.company ||
          ''
        ).toLowerCase()
        const part = (req.part_name || '').toLowerCase()
        const vehicle = (req.vehicle || '').toLowerCase()
        const notes = (req.notes || '').toLowerCase()
        const os = (req.os_number || '').toLowerCase()

        // Itens (peça, veículo e fornecedor do item)
        const itemsMatch = items.some((it) => {
          const itemPart = (it.part_name || '').toLowerCase()
          const itemVeh = (it.vehicle || '').toLowerCase()
          const itemSupName = (
            it.supplier_name ||
            (it.supplier_id ? supplierMap[it.supplier_id] : '') ||
            ''
          ).toLowerCase()
          return itemPart.includes(s) || itemVeh.includes(s) || itemSupName.includes(s)
        })

        const match =
          part.includes(s) ||
          vehicle.includes(s) ||
          os.includes(s) ||
          itemsMatch ||
          customerName.includes(s) ||
          legacySupplierName.includes(s) ||
          notes.includes(s)

        if (!match) return false
      }

      return true
    })
  }, [requests, customerFilter, supplierFilter, search, supplierMap])

  // Agrupamento por colunas kanban
  const columnsData = useMemo(() => {
    const grouped: Record<PurchaseRequestStatus, PurchaseRequest[]> = {
      solicitada: [],
      cotacao: [],
      aprovada: [],
      pedido_emitido: [],
      em_transito: [],
      recebida: [],
      entregue: [],
    }

    for (const req of filteredRequests) {
      if (grouped[req.status]) {
        grouped[req.status].push(req)
      } else {
        grouped.solicitada.push(req)
      }
    }

    // Ordenação "Mais recentes / Mais antigos"
    ;(Object.keys(grouped) as PurchaseRequestStatus[]).forEach((colId) => {
      grouped[colId].sort((a, b) => {
        const timeA = new Date(a.updated || a.created).getTime()
        const timeB = new Date(b.updated || b.created).getTime()
        return sortOrder === 'recentes' ? timeB - timeA : timeA - timeB
      })
    })

    return grouped
  }, [filteredRequests, sortOrder])

  // Métricas: totais do topo do quadro passam a somar o total de venda, custo e margem de todos os itens de todas as compras
  const metrics = useMemo(() => {
    const totalCount = filteredRequests.length
    let totalItems = 0
    let totalCost = 0
    let totalSell = 0

    for (const req of filteredRequests) {
      totalItems += getTotalItemQuantity(req)
      const t = getPurchaseTotals(req)
      totalCost += t.totalCost
      totalSell += t.totalSell
    }

    const totalMargin = totalSell - totalCost
    const completedCount = filteredRequests.filter(
      (r) => r.is_completed || r.status === 'entregue',
    ).length

    return {
      totalCount,
      totalItems,
      totalCost,
      totalSell,
      totalMargin,
      completedCount,
    }
  }, [filteredRequests])

  // Ações de Drag & Drop
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, cardId: string) => {
    setDraggedCardId(cardId)
    e.dataTransfer.setData('text/plain', cardId)
  }

  const handleDragOverColumn = (
    e: React.DragEvent<HTMLDivElement>,
    colId: PurchaseRequestStatus,
  ) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol !== colId) {
      setDragOverCol(colId)
    }
  }

  const handleDragLeaveColumn = (
    e: React.DragEvent<HTMLDivElement>,
    colId: PurchaseRequestStatus,
  ) => {
    e.preventDefault()
    if (dragOverCol === colId) {
      setDragOverCol(null)
    }
  }

  const handleDropColumn = async (
    e: React.DragEvent<HTMLDivElement>,
    targetCol: PurchaseRequestStatus,
  ) => {
    e.preventDefault()
    setDragOverCol(null)
    const cardId = e.dataTransfer.getData('text/plain') || draggedCardId
    setDraggedCardId(null)

    if (!cardId) return
    const card = requests.find((r) => r.id === cardId)
    if (!card || card.status === targetCol) return

    await handleMoveStatus(cardId, targetCol)
  }

  // Movimentação de Status
  const handleMoveStatus = async (cardId: string, targetCol: PurchaseRequestStatus) => {
    const currentCard = requests.find((r) => r.id === cardId)
    if (!currentCard) return

    // Otimístico
    const nowIso = new Date().toISOString()
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id === cardId) {
          return {
            ...r,
            status: targetCol,
            updated: nowIso,
            received_at: targetCol === 'recebida' && !r.received_at ? nowIso : r.received_at,
            is_completed: targetCol === 'entregue' ? true : r.is_completed,
          }
        }
        return r
      }),
    )

    try {
      const updated = await movePurchaseRequestStatus(cardId, targetCol, currentCard)
      const colDef = PURCHASE_COLUMNS.find((c) => c.id === targetCol)
      toast({
        title: 'Status atualizado',
        description: `Peça "${currentCard.part_name}" movida para "${colDef?.label}".`,
      })
      // Atualiza com dados completos retornados
      setRequests((prev) => prev.map((r) => (r.id === cardId ? updated : r)))
    } catch (err: any) {
      console.error('Erro ao mover compra:', err)
      toast({
        title: 'Erro ao mover status',
        description: err?.message || 'Falha ao atualizar no servidor.',
        variant: 'destructive',
      })
      loadData(true)
    }
  }

  // Criação de nova compra
  const handleCreatePurchase = async (data: Partial<PurchaseRequest>) => {
    try {
      const created = await createPurchaseRequest(data)
      setRequests((prev) => [created, ...prev])
      const summary = formatPurchaseItemsSummary(created, supplierMap)
      toast({
        title: 'Solicitação criada',
        description: `Solicitação para "${summary}" criada com sucesso na etapa "Solicitada".`,
      })
    } catch (err: any) {
      console.error('Erro ao criar solicitação de compra:', err)
      toast({
        title: 'Erro ao criar solicitação',
        description: err?.message || 'Falha ao salvar no banco.',
        variant: 'destructive',
      })
    }
  }

  // Atualização no Drawer
  const handleUpdatePurchase = async (id: string, data: Partial<PurchaseRequest>) => {
    try {
      const updated = await updatePurchaseRequest(id, data)
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)))
      setSelectedCard(updated)
      toast({
        title: 'Card atualizado',
        description: 'As alterações foram salvas com sucesso.',
      })
    } catch (err: any) {
      console.error('Erro ao atualizar solicitação:', err)
      toast({
        title: 'Erro ao atualizar',
        description: err?.message || 'Falha ao atualizar dados.',
        variant: 'destructive',
      })
    }
  }

  // Exclusão
  const handleDeletePurchase = async (id: string, partName?: string) => {
    try {
      await deletePurchaseRequest(id)
      setRequests((prev) => prev.filter((r) => r.id !== id))
      if (selectedCard?.id === id) {
        setSelectedCard(null)
      }
      toast({
        title: 'Solicitação removida',
        description: `A solicitação de "${partName || 'compra'}" foi excluída.`,
      })
    } catch (err: any) {
      console.error('Erro ao excluir solicitação:', err)
      toast({
        title: 'Erro ao excluir',
        description: err?.message || 'Falha ao remover registro.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-amber-600" />
            Pipeline de Compras
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Gestão de aquisição de peças: da solicitação do cliente até a entrega.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            disabled={isRefreshing}
            className="text-slate-600"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>

          <Button
            size="sm"
            onClick={() => setIsNewModalOpen(true)}
            className="bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Nova Solicitação
          </Button>
        </div>
      </div>

      {/* Métricas do Pipeline de Compras */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Total de Peças / Itens</span>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {metrics.totalItems}{' '}
              <span className="text-xs font-normal text-slate-500">
                ({metrics.totalCount} {metrics.totalCount === 1 ? 'compra' : 'compras'})
              </span>
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Package className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Custo Total Previsto</span>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {formatCurrency(metrics.totalCost)}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Venda Total Prevista</span>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {formatCurrency(metrics.totalSell)}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs text-slate-500 font-medium">Margem Total Estimada</span>
            <p
              className={`text-xl font-bold mt-0.5 ${
                metrics.totalMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {formatCurrency(metrics.totalMargin)}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
            <TrendingUp className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Ordenação */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar peça, veículo, OS, cliente, fornecedor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro por Cliente */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-xs text-slate-500 font-medium">Cliente:</span>
              <select
                aria-label="Filtrar por cliente"
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer max-w-[140px] truncate"
              >
                <option value="ALL">Todos os clientes</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro por Fornecedor */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-xs text-slate-500 font-medium">Fornecedor:</span>
              <select
                aria-label="Filtrar por fornecedor"
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer max-w-[140px] truncate"
              >
                <option value="ALL">Todos os fornecedores</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.company ? `(${s.company})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Seletor "Mais recentes / Mais antigos" (Idêntico ao Pipeline de Vendas) */}
        <div
          className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs self-start lg:self-auto"
          title="Ordenar cards em todas as colunas por data de atualização ou criação"
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
                ? 'bg-white text-amber-700 shadow-xs'
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
                ? 'bg-white text-amber-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Mais antigos
          </button>
        </div>
      </div>

      {/* Estados de Carga / Erro */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-7 w-7 animate-spin text-amber-600" />
          <p className="font-medium text-sm">Carregando quadro de Compras...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center space-y-3 shadow-xs">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-800 font-semibold">
            Não foi possível carregar o Pipeline de Compras.
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : (
        /* Quadro Kanban com as 7 etapas especificadas */
        <div className="overflow-x-auto pb-6">
          <div className="flex gap-4 min-w-[1540px] items-start">
            {PURCHASE_COLUMNS.map((col) => {
              const columnCards = columnsData[col.id] || []
              const columnCostTotal = columnCards.reduce(
                (acc, c) => acc + getPurchaseTotals(c).totalCost,
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
                      ? 'ring-2 ring-amber-500 bg-amber-50/40 border-amber-300'
                      : 'hover:border-slate-300'
                  }`}
                >
                  {/* Cabeçalho da Coluna com border top colorido */}
                  <div
                    className={`p-3 bg-white rounded-t-xl border-b border-slate-200 border-t-4 ${col.borderColor}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <h3
                        className="font-bold text-slate-900 text-xs truncate"
                        title={col.description}
                      >
                        {col.label}
                      </h3>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {columnCards.length}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Custo total:</span>
                      <strong className="text-slate-800">{formatCurrency(columnCostTotal)}</strong>
                    </div>
                  </div>

                  {/* Lista de Cards da Coluna */}
                  <div className="p-2.5 flex-1 space-y-2.5 min-h-[420px] max-h-[calc(100vh-340px)] overflow-y-auto">
                    {columnCards.length === 0 ? (
                      <div className="h-32 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-center p-3 text-slate-400 text-xs">
                        {isOver ? 'Soltar aqui' : 'Nenhuma peça nesta etapa'}
                      </div>
                    ) : (
                      columnCards.map((card) => (
                        <PurchaseCard
                          key={card.id}
                          card={card}
                          supplierMap={supplierMap}
                          onClick={() => setSelectedCard(card)}
                          onDragStart={handleDragStart}
                          onDelete={(id, name) => handleDeletePurchase(id, name)}
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

      {/* Drawer de Detalhes / Edição */}
      {selectedCard && (
        <PurchaseDrawer
          card={selectedCard}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleUpdatePurchase}
          onDelete={(id) =>
            handleDeletePurchase(id, formatPurchaseItemsSummary(selectedCard, supplierMap))
          }
          onMoveStatus={(id, targetCol) => handleMoveStatus(id, targetCol)}
        />
      )}

      {/* Modal de Nova Solicitação */}
      <NewPurchaseModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        customers={customers}
        suppliers={suppliers}
        onSubmit={handleCreatePurchase}
      />
    </div>
  )
}
