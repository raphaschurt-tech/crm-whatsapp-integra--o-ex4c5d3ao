import { useEffect, useState } from 'react'
import {
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
  Package,
  Layers,
  ChevronRight,
  ArrowRight,
  DollarSign,
  Boxes,
} from 'lucide-react'
import {
  getProductionOrders,
  createProductionOrder,
  completeProductionOrder,
  updateProductionOrder,
  deleteProductionOrder,
  getResolvedItemUnitCost,
} from '@/services/productionOrders'
import { getProducts, getProduct } from '@/services/products'
import { getFamilies } from '@/services/families'
import { getCompositionsByProduct } from '@/services/compositions'
import {
  ProductionOrder,
  Product,
  ItemFamily,
  SelectedProductionItem,
  ProductionOrderStatus,
} from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'

interface AllowedItemInfo {
  product: Product
  unitCost: number
  isProduced: boolean
}

interface FamilyRequirementState {
  familyId: string
  familyName: string
  required: boolean
  allowedItems: AllowedItemInfo[]
  selectedProductId: string
  selectedItemInfo?: AllowedItemInfo
}

export default function ProductionOrderList() {
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('todos')

  // Produtos do tipo Produzido para criar OP
  const [producedProducts, setProducedProducts] = useState<Product[]>([])
  const [allProducts, setAllProducts] = useState<Product[]>([])

  // Modal de Nova OP
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [quantity, setQuantity] = useState<number>(1)
  const [notes, setNotes] = useState('')
  const [familyRequirements, setFamilyRequirements] = useState<FamilyRequirementState[]>([])
  const [loadingRequirements, setLoadingRequirements] = useState(false)
  const [creating, setCreating] = useState(false)

  // Modal de Detalhes da OP
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [orderList, prods] = await Promise.all([getProductionOrders(), getProducts()])
      setOrders(orderList)
      setAllProducts(prods)
      // Regra: "ao criar uma nova OP, o usuário seleciona um produto com flag 'Produzido'"
      setProducedProducts(
        prods.filter((p) => Boolean(p.is_produced ?? p.product_type === 'produzido')),
      )
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao carregar Ordens de Produção', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Quando o usuário seleciona um produto no modal de criação de OP,
  // carrega automaticamente as famílias obrigatórias e os itens permitidos com estoque e custos reais
  const handleProductSelectionChange = async (productId: string) => {
    setSelectedProductId(productId)
    if (!productId) {
      setFamilyRequirements([])
      return
    }

    setLoadingRequirements(true)
    try {
      const [compositions, families] = await Promise.all([
        getCompositionsByProduct(productId),
        getFamilies(),
      ])

      const reqStates: FamilyRequirementState[] = []

      for (const comp of compositions) {
        // Encontra os detalhes da família
        const fam = families.find((f) => f.id === comp.family)
        const familyName = fam ? fam.name : 'Família de Insumos'

        // IDs dos itens permitidos:
        // Regra do usuário: "Para cada família, o operador vê apenas os insumos permitidos para aquele produto,
        // com estoque disponível e custo. Apenas produtos com a flag 'Composto (insumo)' aparecem como opções."
        const allowedIds = Array.isArray(comp.allowed_products) ? comp.allowed_products : []
        const allowedItems: AllowedItemInfo[] = []

        for (const pId of allowedIds) {
          let itemProd = allProducts.find((p) => p.id === pId)
          if (!itemProd) {
            try {
              itemProd = await getProduct(pId)
            } catch {
              /* intentionally ignored */
            }
          }

          // Insumo deve existir e ter a flag is_component marcada
          if (itemProd && Boolean(itemProd.is_component)) {
            // Resolver custo real (se for produzido, busca custo da última OP que o produziu)
            const { unitCost, isProduced } = await getResolvedItemUnitCost(itemProd)
            allowedItems.push({
              product: itemProd,
              unitCost,
              isProduced,
            })
          }
        }

        // Escolhe o primeiro item permitido como padrão (se houver)
        const defaultSelected = allowedItems.length > 0 ? allowedItems[0] : undefined

        reqStates.push({
          familyId: comp.family,
          familyName,
          required: comp.required ?? true,
          allowedItems,
          selectedProductId: defaultSelected ? defaultSelected.product.id : '',
          selectedItemInfo: defaultSelected,
        })
      }

      setFamilyRequirements(reqStates)
    } catch (err) {
      console.error('Erro ao carregar famílias do produto selecionado:', err)
      toast({
        title: 'Erro ao carregar composição do produto',
        variant: 'destructive',
      })
    } finally {
      setLoadingRequirements(false)
    }
  }

  // Operador escolhe o item para uma família específica
  const handleSelectFamilyItem = (familyId: string, productId: string) => {
    setFamilyRequirements((prev) =>
      prev.map((req) => {
        if (req.familyId === familyId) {
          const itemInfo = req.allowedItems.find((item) => item.product.id === productId)
          return {
            ...req,
            selectedProductId: productId,
            selectedItemInfo: itemInfo,
          }
        }
        return req
      }),
    )
  }

  // Cálculo automático do custo da OP
  // Custo unitário = soma dos custos reais dos itens selecionados
  // Custo total = custo unitário * quantidade a produzir
  const calculateTotalCost = () => {
    let unitCost = 0
    for (const req of familyRequirements) {
      if (req.selectedItemInfo) {
        unitCost += req.selectedItemInfo.unitCost
      }
    }
    const total = unitCost * (quantity > 0 ? quantity : 1)
    return {
      unitCost: Number(unitCost.toFixed(2)),
      totalCost: Number(total.toFixed(2)),
    }
  }

  const { unitCost: calculatedUnitCost, totalCost: calculatedTotalCost } = calculateTotalCost()

  const handleOpenCreateModal = () => {
    setSelectedProductId('')
    setQuantity(1)
    setNotes('')
    setFamilyRequirements([])
    setModalOpen(true)
  }

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProductId) {
      toast({ title: 'Selecione o produto a ser fabricado', variant: 'destructive' })
      return
    }

    if (quantity <= 0) {
      toast({ title: 'A quantidade deve ser maior que zero', variant: 'destructive' })
      return
    }

    // Verificar se todas as famílias obrigatórias possuem um item selecionado
    for (const req of familyRequirements) {
      if (req.required && !req.selectedProductId) {
        toast({
          title: `Selecione um insumo para a família "${req.familyName}"`,
          variant: 'destructive',
        })
        return
      }
    }

    setCreating(true)
    try {
      const selectedItemsData: SelectedProductionItem[] = familyRequirements
        .filter((req) => req.selectedItemInfo)
        .map((req) => {
          const info = req.selectedItemInfo!
          const itemQtyUsed = 1 * quantity // 1 unidade do insumo por unidade final
          return {
            family_id: req.familyId,
            family_name: req.familyName,
            product_id: info.product.id,
            product_name: info.product.name,
            sku: info.product.sku,
            unit_cost: info.unitCost,
            quantity_used: itemQtyUsed,
            total_cost: Number((info.unitCost * itemQtyUsed).toFixed(2)),
            is_produced: info.isProduced,
            stock_available: info.product.stock_quantity,
          }
        })

      await createProductionOrder({
        product: selectedProductId,
        quantity,
        status: 'aberta',
        unit_cost: calculatedUnitCost,
        total_cost: calculatedTotalCost,
        selected_items: selectedItemsData,
        notes,
      })

      toast({ title: 'Ordem de Produção criada com sucesso!' })
      setModalOpen(false)
      loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao gerar Ordem de Produção', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleCompleteOrder = async (orderId: string) => {
    if (
      !confirm(
        'Deseja concluir esta OP? Isso dará baixa no estoque dos insumos e registrará a entrada do produto fabricado com o custo real.',
      )
    ) {
      return
    }

    setCompletingId(orderId)
    try {
      await completeProductionOrder(orderId)
      toast({
        title: 'Ordem de Produção Concluída!',
        description: 'Baixa de insumos e entrada do produto final realizadas no estoque.',
      })
      if (detailModalOpen && selectedOrder?.id === orderId) {
        setDetailModalOpen(false)
      }
      loadData()
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao concluir OP',
        description: err?.message || 'Falha na baixa de estoque.',
        variant: 'destructive',
      })
    } finally {
      setCompletingId(null)
    }
  }

  const handleUpdateStatus = async (orderId: string, newStatus: ProductionOrderStatus) => {
    if (newStatus === 'concluida') {
      handleCompleteOrder(orderId)
      return
    }

    try {
      await updateProductionOrder(orderId, { status: newStatus })
      toast({ title: `Status alterado para ${newStatus}` })
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao alterar status', variant: 'destructive' })
    }
  }

  const handleDelete = async (order: ProductionOrder) => {
    if (!confirm(`Deseja excluir a OP ${order.code}?`)) return
    try {
      await deleteProductionOrder(order.id)
      toast({ title: 'Ordem de Produção excluída' })
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao excluir OP', variant: 'destructive' })
    }
  }

  const getStatusBadge = (status: ProductionOrderStatus) => {
    switch (status) {
      case 'aberta':
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Aberta
          </Badge>
        )
      case 'em_producao':
        return (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 flex items-center gap-1">
            <Boxes className="h-3 w-3" /> Em Produção
          </Badge>
        )
      case 'concluida':
        return (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 flex items-center gap-1 font-semibold">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Concluída
          </Badge>
        )
      case 'cancelada':
        return (
          <Badge variant="outline" className="text-slate-500 bg-slate-100 flex items-center gap-1">
            <Ban className="h-3 w-3" /> Cancelada
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const filteredOrders = orders.filter((o) => {
    const matchSearch =
      o.code.toLowerCase().includes(search.toLowerCase()) ||
      (o.expand?.product?.name &&
        o.expand.product.name.toLowerCase().includes(search.toLowerCase())) ||
      (o.expand?.product?.sku && o.expand.product.sku.toLowerCase().includes(search.toLowerCase()))

    const matchStatus = statusFilter === 'todos' ? true : o.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ordens de Produção (PCP)</h1>
          <p className="text-sm text-slate-500">
            Planejamento, seleção de famílias de insumos, cálculo de custos e baixa em estoque
          </p>
        </div>
        <Button
          onClick={handleOpenCreateModal}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Nova Ordem de Produção
        </Button>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por código, produto ou SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Label className="text-xs text-slate-500 shrink-0">Filtrar por Status:</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="aberta">Abertas</SelectItem>
              <SelectItem value="em_producao">Em Produção</SelectItem>
              <SelectItem value="concluida">Concluídas</SelectItem>
              <SelectItem value="cancelada">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela de OPs */}
      {loading ? (
        <div className="p-8 text-center text-slate-500">Carregando ordens de produção...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
          Nenhuma ordem de produção encontrada.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b">
                  <th className="p-4">OP / Código</th>
                  <th className="p-4">Produto Fabricado</th>
                  <th className="p-4 text-center">Quantidade</th>
                  <th className="p-4">Custo Unitário</th>
                  <th className="p-4">Custo Total</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredOrders.map((order) => {
                  const prod = order.expand?.product
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4 font-mono font-bold text-slate-900">
                        {order.code}
                        <p className="text-[11px] font-sans font-normal text-slate-400">
                          {new Date(order.created).toLocaleDateString('pt-BR')}
                        </p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-purple-600 shrink-0" />
                          <div>
                            <p className="font-bold text-slate-900">
                              {prod?.name || 'Produto Removido'}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">
                              SKU: {prod?.sku || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center font-bold text-slate-800">
                        {order.quantity} un.
                      </td>
                      <td className="p-4 font-semibold text-emerald-700">
                        {formatCurrency(order.unit_cost || 0)}
                      </td>
                      <td className="p-4 font-bold text-slate-900">
                        {formatCurrency(order.total_cost || 0)}
                      </td>
                      <td className="p-4">{getStatusBadge(order.status)}</td>
                      <td className="p-4 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedOrder(order)
                            setDetailModalOpen(true)
                          }}
                          className="text-xs font-semibold text-slate-700"
                        >
                          Ver Detalhes
                        </Button>
                        {order.status !== 'concluida' && order.status !== 'cancelada' && (
                          <Button
                            size="sm"
                            disabled={completingId === order.id}
                            onClick={() => handleCompleteOrder(order.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            {completingId === order.id ? 'Baixando...' : 'Concluir OP'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Nova Ordem de Produção */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Gerar Nova Ordem de Produção (OP)
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateOrder} className="space-y-5 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">
                  Produto Fabricado (Flag: Produzido) *
                </Label>
                <Select value={selectedProductId} onValueChange={handleProductSelectionChange}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Selecione o produto a produzir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {producedProducts.map((p) => {
                      const costDisplay =
                        p.cost && p.cost > 0 ? ` • Custo base: ${formatCurrency(p.cost)}` : ''
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.sku}) — Estoque atual: {p.stock_quantity} un.{costDisplay}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {producedProducts.length === 0 && (
                  <p className="text-[11px] text-amber-600">
                    Nenhum produto com a flag &quot;Produzido&quot; encontrado. Marque a flag em
                    Cadastro de Produtos.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Quantidade a Produzir *</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  className="bg-white"
                  required
                />
              </div>
            </div>

            {/* Carregamento automático das famílias e insumos permitidos */}
            {selectedProductId && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                      Famílias Obrigatórias e Seleção de Insumos
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">
                    {familyRequirements.length} famílias configuradas
                  </span>
                </div>

                {loadingRequirements ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Carregando requisitos de famílias e calculando custos reais dos itens...
                  </div>
                ) : familyRequirements.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Este produto ainda não possui famílias obrigatórias configuradas. Edite o
                      produto no Estoque e defina a <strong>Composição por Famílias</strong>.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {familyRequirements.map((req) => (
                      <div
                        key={req.familyId}
                        className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">
                              Família: {req.familyName}
                            </span>
                            {req.required && (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                Obrigatória
                              </Badge>
                            )}
                          </div>
                          {req.selectedItemInfo && (
                            <span className="text-xs font-semibold text-emerald-700">
                              Custo do item: {formatCurrency(req.selectedItemInfo.unitCost)}
                              {req.selectedItemInfo.isProduced && (
                                <span className="text-[10px] text-purple-700 ml-1 font-normal">
                                  (da última OP)
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {req.allowedItems.length === 0 ? (
                          <p className="text-xs text-red-500 italic">
                            Nenhum item permitido configurado para esta família neste produto.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">
                              Selecione qual item usar na produção:
                            </Label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {req.allowedItems.map((item) => {
                                const isSelected = req.selectedProductId === item.product.id
                                const isOut = item.product.stock_quantity < quantity
                                return (
                                  <label
                                    key={item.product.id}
                                    className={`p-2.5 rounded-lg border text-xs cursor-pointer flex flex-col justify-between transition-colors ${
                                      isSelected
                                        ? 'bg-emerald-50/60 border-emerald-400 ring-1 ring-emerald-400'
                                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-1">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="radio"
                                          name={`fam_${req.familyId}`}
                                          checked={isSelected}
                                          onChange={() =>
                                            handleSelectFamilyItem(req.familyId, item.product.id)
                                          }
                                          className="text-emerald-600 focus:ring-emerald-500"
                                        />
                                        <span className="font-semibold text-slate-900 truncate">
                                          {item.product.name}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                                      <span
                                        className={`font-medium ${
                                          isOut ? 'text-amber-700' : 'text-slate-600'
                                        }`}
                                      >
                                        Estoque: {item.product.stock_quantity} un.{' '}
                                        {isOut ? '(insuficiente)' : ''}
                                      </span>
                                      <span className="font-bold text-emerald-800">
                                        {formatCurrency(item.unitCost)}
                                        {item.isProduced && (
                                          <span className="text-[9px] text-purple-700 block text-right font-normal">
                                            (OP anterior)
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Resumo de Custos e Totais */}
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      Cálculo de Custos da OP
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Soma dos custos reais dos itens selecionados por unidade fabricada.
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <span className="text-[11px] text-slate-500 block uppercase font-medium">
                        Custo Unitário Real
                      </span>
                      <span className="text-lg font-bold text-emerald-800">
                        {formatCurrency(calculatedUnitCost)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block uppercase font-medium">
                        Custo Total ({quantity} un.)
                      </span>
                      <span className="text-xl font-extrabold text-emerald-950">
                        {formatCurrency(calculatedTotalCost)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Observações da Ordem (opcional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Lote especial, prioridade alta, ordem para cliente X..."
              />
            </div>

            <DialogFooter className="pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={creating || !selectedProductId || familyRequirements.length === 0}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
              >
                {creating ? 'Gerando OP...' : 'Gerar Ordem de Produção'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes da OP */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle className="text-lg font-bold text-slate-900">
                Ordem de Produção: {selectedOrder?.code}
              </DialogTitle>
              {selectedOrder && getStatusBadge(selectedOrder.status)}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 flex-1 overflow-y-auto pr-1 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Produto
                  </span>
                  <span className="font-bold text-slate-900 text-sm">
                    {selectedOrder.expand?.product?.name || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Quantidade
                  </span>
                  <span className="font-bold text-slate-900 text-sm">
                    {selectedOrder.quantity} un.
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Custo Unitário
                  </span>
                  <span className="font-bold text-emerald-700 text-sm">
                    {formatCurrency(selectedOrder.unit_cost || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Custo Total
                  </span>
                  <span className="font-extrabold text-slate-900 text-sm">
                    {formatCurrency(selectedOrder.total_cost || 0)}
                  </span>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="p-3 bg-slate-50 rounded-lg text-slate-600">
                  <strong>Observações:</strong> {selectedOrder.notes}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 uppercase text-[11px] tracking-wider">
                  Insumos Selecionados para esta Produção
                </h4>
                <div className="border rounded-xl divide-y overflow-hidden">
                  {Array.isArray(selectedOrder.selected_items) &&
                  selectedOrder.selected_items.length > 0 ? (
                    selectedOrder.selected_items.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-center justify-between hover:bg-slate-50/60"
                      >
                        <div>
                          <p className="font-bold text-slate-900">{item.product_name}</p>
                          <p className="text-[11px] text-slate-400">
                            Família: <strong>{item.family_name}</strong> • SKU: {item.sku}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-slate-800">
                            Qtd usada: {item.quantity_used} un.
                          </p>
                          <p className="text-emerald-700 font-semibold text-[11px]">
                            Custo un: {formatCurrency(item.unit_cost)}
                            {item.is_produced && ' (OP)'} | Total: {formatCurrency(item.total_cost)}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="p-4 text-center text-slate-400">
                      Nenhum item discriminado nesta OP.
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t text-slate-400 text-[11px]">
                <span>Criada em: {new Date(selectedOrder.created).toLocaleString('pt-BR')}</span>
                {selectedOrder.completed_at && (
                  <span className="text-emerald-700 font-semibold">
                    Concluída em: {new Date(selectedOrder.completed_at).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="pt-3 border-t flex flex-row items-center justify-between sm:justify-between w-full">
            <div>
              {selectedOrder && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(selectedOrder)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs"
                >
                  Excluir OP
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {selectedOrder && selectedOrder.status === 'aberta' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUpdateStatus(selectedOrder.id, 'em_producao')}
                  className="text-xs"
                >
                  Iniciar Produção
                </Button>
              )}

              {selectedOrder &&
                (selectedOrder.status === 'aberta' || selectedOrder.status === 'em_producao') && (
                  <Button
                    size="sm"
                    disabled={completingId === selectedOrder.id}
                    onClick={() => handleCompleteOrder(selectedOrder.id)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    {completingId === selectedOrder.id
                      ? 'Concluindo...'
                      : 'Concluir OP e Baixar Estoque'}
                  </Button>
                )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailModalOpen(false)}
                className="text-xs"
              >
                Fechar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
