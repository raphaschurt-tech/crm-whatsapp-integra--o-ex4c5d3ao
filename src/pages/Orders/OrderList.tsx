import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  Eye,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Clock,
  User as UserIcon,
  ShoppingBag,
  ExternalLink,
  Ban,
  CheckCircle2,
  Calendar,
} from 'lucide-react'
import { getOrders, getOrderItems, cancelOrder } from '@/services/ordersService'
import { Order, OrderItem, OrderCommercialStatus, OrderFinancialStatus } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export default function OrderList() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [commercialFilter, setCommercialFilter] = useState<string>('todos')
  const [financialFilter, setFinancialFilter] = useState<string>('todos')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Modal de Detalhes do Pedido
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)

  // Modal de Cancelamento de Pedido
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null)
  const [canceling, setCanceling] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getOrders()
      setOrders(data)
    } catch (e: any) {
      console.error('Erro ao carregar pedidos:', e)
      setLoadError(e?.message || 'Falha ao comunicar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('orders', () => {
    loadData()
  })

  const openOrderDetail = async (order: Order) => {
    setSelectedOrder(order)
    setDetailModalOpen(true)
    setLoadingItems(true)
    try {
      const items = await getOrderItems(order.id)
      setOrderItems(items)
    } catch (err: any) {
      console.error('Erro ao carregar itens do pedido:', err)
      toast({
        title: 'Erro ao carregar itens do pedido',
        variant: 'destructive',
      })
      setOrderItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const handleConfirmCancel = async () => {
    if (!orderToCancel) return
    setCanceling(true)
    try {
      const res = await cancelOrder(orderToCancel.id)
      if (res.success) {
        toast({
          title: res.idempotent ? 'Pedido já cancelado' : 'Pedido cancelado com sucesso!',
          description: 'As reservas de estoque foram liberadas sem alterar o estoque físico.',
        })
        setOrderToCancel(null)
        if (selectedOrder && selectedOrder.id === orderToCancel.id) {
          setDetailModalOpen(false)
        }
        await loadData()
      } else {
        toast({
          title: 'Erro ao cancelar pedido',
          description: res.error || 'Falha na operação.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro inesperado',
        description: err.message || 'Falha ao processar cancelamento.',
        variant: 'destructive',
      })
    } finally {
      setCanceling(false)
    }
  }

  const filteredOrders = orders.filter((o) => {
    const term = search.toLowerCase()
    const matchSearch =
      o.code.toLowerCase().includes(term) ||
      (o.client_name || '').toLowerCase().includes(term) ||
      (o.expand?.responsible?.name || '').toLowerCase().includes(term)
    const matchCommercial = commercialFilter === 'todos' || o.commercial_status === commercialFilter
    const matchFinancial = financialFilter === 'todos' || o.financial_status === financialFilter
    return matchSearch && matchCommercial && matchFinancial
  })

  const getCommercialBadge = (status: OrderCommercialStatus) => {
    if (status === 'cancelado') {
      return (
        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 font-semibold">
          <XCircle className="h-3 w-3 mr-1 text-rose-600" /> Cancelado
        </Badge>
      )
    }
    return (
      <Badge
        variant="outline"
        className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold"
      >
        <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" /> Aberto
      </Badge>
    )
  }

  const getFinancialBadge = (status: OrderFinancialStatus) => {
    if (status === 'pago') {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]">
          Pago
        </Badge>
      )
    }
    return (
      <Badge
        variant="outline"
        className="bg-amber-50 text-amber-800 border-amber-300 font-semibold text-[11px]"
      >
        Pendente
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Pedidos</h1>
            <Badge variant="secondary" className="font-semibold text-slate-700">
              PCP & Vendas
            </Badge>
          </div>
          <p className="text-sm text-slate-500">
            Gerencie os pedidos gerados a partir de orçamentos e suas reservas de estoque
          </p>
        </div>
        <Button
          onClick={() => navigate('/orcamentos')}
          variant="outline"
          className="text-xs font-semibold"
        >
          <ShoppingBag className="mr-1.5 h-4 w-4 text-slate-600" /> Ver Orçamentos para Converter
        </Button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por código, cliente ou responsável..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Select value={commercialFilter} onValueChange={setCommercialFilter}>
            <SelectTrigger className="w-full sm:w-40 text-xs">
              <SelectValue placeholder="Status Comercial" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos" className="text-xs">
                Todos Comerciais
              </SelectItem>
              <SelectItem value="aberto" className="text-xs">
                Aberto
              </SelectItem>
              <SelectItem value="cancelado" className="text-xs">
                Cancelado
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={financialFilter} onValueChange={setFinancialFilter}>
            <SelectTrigger className="w-full sm:w-40 text-xs">
              <SelectValue placeholder="Status Financeiro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos" className="text-xs">
                Todos Financeiros
              </SelectItem>
              <SelectItem value="pendente" className="text-xs">
                Pendente
              </SelectItem>
              <SelectItem value="pago" className="text-xs">
                Pago
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
          <p className="text-sm">Carregando pedidos...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white p-8 rounded-xl border border-red-200 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-700 font-medium">Não foi possível carregar os pedidos.</p>
          <p className="text-xs text-slate-500">{loadError}</p>
          <Button onClick={() => loadData()} variant="outline" size="sm">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center space-y-3">
          <ShoppingBag className="h-10 w-10 text-slate-400 mx-auto" />
          <p className="text-slate-600 font-medium">Nenhum pedido encontrado.</p>
          <p className="text-xs text-slate-400">
            Abra um orçamento aprovado ou pago e clique em "Converter em Pedido" para criar um.
          </p>
          <Button onClick={() => navigate('/orcamentos')} variant="outline" size="sm">
            Ir para Orçamentos
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                  <th className="p-3.5">Código</th>
                  <th className="p-3.5">Cliente</th>
                  <th className="p-3.5">Prazo Prometido</th>
                  <th className="p-3.5">Responsável</th>
                  <th className="p-3.5">Total</th>
                  <th className="p-3.5">Financeiro</th>
                  <th className="p-3.5">Comercial</th>
                  <th className="p-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-blue-700">{order.code}</td>
                    <td className="p-3.5 font-semibold text-slate-800">{order.client_name}</td>
                    <td className="p-3.5 text-xs text-slate-600">
                      {order.promised_delivery_date ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          {new Date(order.promised_delivery_date).toLocaleDateString('pt-BR')}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Não informado</span>
                      )}
                    </td>
                    <td className="p-3.5 text-xs text-slate-600">
                      {order.expand?.responsible?.name || (
                        <span className="text-slate-400 italic">Não atribuído</span>
                      )}
                    </td>
                    <td className="p-3.5 font-bold text-slate-900">
                      {formatCurrency(order.total || 0)}
                    </td>
                    <td className="p-3.5">{getFinancialBadge(order.financial_status)}</td>
                    <td className="p-3.5">{getCommercialBadge(order.commercial_status)}</td>
                    <td className="p-3.5 text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openOrderDetail(order)}
                        className="text-xs h-8"
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> Detalhes
                      </Button>
                      {order.commercial_status !== 'cancelado' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOrderToCancel(order)}
                          className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          title="Cancelar pedido e liberar reservas"
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" /> Cancelar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-100">
            {filteredOrders.map((order) => (
              <div key={order.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-blue-700 text-sm">{order.code}</span>
                  <div className="flex gap-1.5 items-center">
                    {getFinancialBadge(order.financial_status)}
                    {getCommercialBadge(order.commercial_status)}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{order.client_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Prazo:{' '}
                    {order.promised_delivery_date
                      ? new Date(order.promised_delivery_date).toLocaleDateString('pt-BR')
                      : 'Não informado'}
                  </p>
                  {order.expand?.responsible?.name && (
                    <p className="text-xs text-slate-500">Resp: {order.expand.responsible.name}</p>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-base font-bold text-slate-900">
                    {formatCurrency(order.total || 0)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openOrderDetail(order)}
                      className="text-xs h-8"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> Detalhes
                    </Button>
                    {order.commercial_status !== 'cancelado' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOrderToCancel(order)}
                        className="text-xs h-8 text-rose-600 hover:bg-rose-50"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Pedido com Itens e Reservas */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 text-slate-900">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-blue-600" />
                <span>Pedido {selectedOrder?.code}</span>
              </div>
              {selectedOrder && (
                <div className="flex items-center gap-2">
                  {getFinancialBadge(selectedOrder.financial_status)}
                  {getCommercialBadge(selectedOrder.commercial_status)}
                </div>
              )}
            </DialogTitle>
            <DialogDescription>
              Snapshot congelado dos itens, preços e status de reserva em estoque.
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Cliente
                  </span>
                  <span className="font-semibold text-slate-800">{selectedOrder.client_name}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Prazo Prometido
                  </span>
                  <span className="font-semibold text-slate-800">
                    {selectedOrder.promised_delivery_date
                      ? new Date(selectedOrder.promised_delivery_date).toLocaleDateString('pt-BR')
                      : 'Não definido'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Responsável
                  </span>
                  <span className="font-semibold text-slate-800">
                    {selectedOrder.expand?.responsible?.name || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">
                    Orçamento Origem
                  </span>
                  <Link
                    to={`/orcamentos/${selectedOrder.quote_id}`}
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold"
                  >
                    Ver Orçamento <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-2">
                  Itens do Pedido & Reservas
                </h4>
                {loadingItems ? (
                  <div className="p-4 text-center text-slate-500 flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                    Carregando itens...
                  </div>
                ) : orderItems.length === 0 ? (
                  <p className="text-slate-500 italic p-3 text-center">Nenhum item cadastrado.</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-100 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
                          <th className="p-2.5">Item / SKU</th>
                          <th className="p-2.5 text-center">Qtd Pedida</th>
                          <th className="p-2.5 text-center">Qtd Reservada</th>
                          <th className="p-2.5 text-right">Preço Unit.</th>
                          <th className="p-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {orderItems.map((it) => (
                          <tr key={it.id} className="hover:bg-slate-50/60">
                            <td className="p-2.5">
                              <p className="font-semibold text-slate-800">{it.name}</p>
                              {it.sku && (
                                <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                                  {it.sku}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-bold text-slate-700">
                              {it.quantity_ordered}
                            </td>
                            <td className="p-2.5 text-center">
                              {it.quantity_reserved >= it.quantity_ordered ? (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">
                                  {it.quantity_reserved} un. (Total)
                                </Badge>
                              ) : it.quantity_reserved > 0 ? (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                                  {it.quantity_reserved} de {it.quantity_ordered} un. (Parcial)
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] font-bold">
                                  0 un. (Sem reserva)
                                </Badge>
                              )}
                            </td>
                            <td className="p-2.5 text-right text-slate-600">
                              {formatCurrency(it.unit_price)}
                            </td>
                            <td className="p-2.5 text-right font-bold text-slate-900">
                              {formatCurrency(it.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-sm font-semibold text-slate-700">Valor Total do Pedido:</span>
                <span className="text-lg font-bold text-emerald-600">
                  {formatCurrency(selectedOrder.total)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {selectedOrder && selectedOrder.commercial_status !== 'cancelado' && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setOrderToCancel(selectedOrder)}
                className="mr-auto text-xs"
              >
                <Ban className="h-3.5 w-3.5 mr-1" /> Cancelar Pedido
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDetailModalOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Cancelamento de Pedido */}
      <Dialog
        open={Boolean(orderToCancel)}
        onOpenChange={(open) => !open && setOrderToCancel(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <Ban className="h-5 w-5 text-rose-600" />
              Cancelar Pedido {orderToCancel?.code}?
            </DialogTitle>
            <DialogDescription>
              Ao cancelar este pedido:
              <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-slate-600">
                <li>
                  O status comercial do pedido será alterado para <strong>Cancelado</strong>.
                </li>
                <li>
                  Todas as reservas de estoque (<code>reserved_quantity</code>) serão liberadas
                  imediatamente.
                </li>
                <li>
                  O saldo físico do estoque (<code>stock_quantity</code>) não será alterado.
                </li>
                <li>O orçamento original continuará intacto.</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOrderToCancel(null)}
              disabled={canceling}
            >
              Não, manter pedido
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancel}
              disabled={canceling}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {canceling ? 'Cancelando...' : 'Sim, cancelar pedido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
