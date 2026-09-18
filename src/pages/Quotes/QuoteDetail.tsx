import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Copy,
  Check,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
  Upload,
  FileCheck,
  ArrowLeft,
  Share2,
  ShoppingBag,
  Download,
  Send,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react'
import { getQuote, getQuoteItems, updateQuoteStatus, deleteQuote } from '@/services/quotes'
import { getPaymentsForQuote, createPayment } from '@/services/payments'
import {
  getPurchaseRequestsForQuote,
  createPurchaseFromQuoteItems,
} from '@/services/purchaseRequestsService'
import { Quote, QuoteItem, Payment, PurchaseRequest, Order, User } from '@/types/crm'
import { convertQuoteToOrder, getActiveOrderByQuoteId } from '@/services/ordersService'
import { getUsers } from '@/services/users'
import { useAuth } from '@/hooks/use-auth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ShoppingBag } from 'lucide-react'
import {
  formatCurrency,
  openWhatsApp,
  buildPaymentLinkMessage,
  buildReceiptMessage,
} from '@/lib/whatsapp'
import { SendQuoteDialog } from '@/components/Quotes/SendQuoteDialog'
import { SendPaymentLinkDialog } from '@/components/Quotes/SendPaymentLinkDialog'
import { downloadQuotePdf, downloadQuotePdfAsync } from '@/services/quotePdfService'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()

  const [quote, setQuote] = useState<Quote | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [linkedPurchases, setLinkedPurchases] = useState<PurchaseRequest[]>([])
  const [existingOrder, setExistingOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Estados da conversão em pedido (Slice 1A - PCP)
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  const [convertingOrder, setConvertingOrder] = useState(false)
  const [promisedDeliveryDate, setPromisedDeliveryDate] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState('')
  const [systemUsers, setSystemUsers] = useState<User[]>([])

  // Send Quote Dialog
  const [sendQuoteModal, setSendQuoteModal] = useState(false)
  const [sendPaymentLinkModal, setSendPaymentLinkModal] = useState(false)

  // Purchase creation state
  const [creatingPurchaseFor, setCreatingPurchaseFor] = useState<string | null>(null)

  // Receipt Modal State
  const [receiptModal, setReceiptModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'pix' | 'cartao' | 'boleto' | 'dinheiro' | 'outros'>('pix')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const loadData = async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const [q, qItems, pList, purchases, ord, uList] = await Promise.all([
        getQuote(id),
        getQuoteItems(id),
        getPaymentsForQuote(id),
        getPurchaseRequestsForQuote(id),
        getActiveOrderByQuoteId(id),
        getUsers().catch(() => []),
      ])
      setQuote(q)
      setItems(qItems)
      setPayments(pList)
      setAmount(q.total.toString())
      setLinkedPurchases(purchases)
      setExistingOrder(ord)
      setSystemUsers(uList || [])
      if (currentUser && !responsibleUserId) {
        setResponsibleUserId(currentUser.id)
      }
    } catch (e: any) {
      console.error(e)
      setLoadError(e?.message || 'Falha ao carregar orçamento.')
      toast({ title: 'Erro ao carregar orçamento', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando detalhes...</div>

  if (loadError) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3 bg-white border border-red-200 rounded-xl">
        <p className="text-sm text-slate-700 font-medium">Erro ao carregar orçamento.</p>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Button onClick={loadData} variant="outline" size="sm">
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!quote) return <div className="p-8 text-center text-slate-500">Orçamento não encontrado.</div>

  const paymentLink = `${window.location.origin}/pagamento/${quote.id}?token=${quote.payment_token}`

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink)
    setCopied(true)
    toast({ title: 'Link copiado!' })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleStatusChange = async (newStatus: Quote['status']) => {
    try {
      await updateQuoteStatus(quote.id, newStatus)
      setQuote((prev) => (prev ? { ...prev, status: newStatus, expand: prev.expand } : null))
      toast({ title: `Status alterado para ${newStatus.toUpperCase()}` })
    } catch (_) {
      toast({ title: 'Erro ao atualizar status', variant: 'destructive' })
    }
  }

  // Verifica se um item específico já possui compra vinculada
  const isItemInLinkedPurchase = (item: QuoteItem) => {
    if (linkedPurchases.length === 0) return false
    const prodName = (item.expand?.product?.name || item.product || '').toLowerCase().trim()
    return linkedPurchases.some((p) => {
      if ((p.part_name || '').toLowerCase().trim() === prodName) return true
      if (Array.isArray(p.items)) {
        return p.items.some((pi) => (pi.part_name || '').toLowerCase().trim() === prodName)
      }
      return false
    })
  }

  // Itens sem estoque disponível
  const outOfStockItems = items.filter((it) => {
    const stock = it.expand?.product?.stock_quantity
    return stock === undefined || stock <= 0 || stock < it.quantity
  })

  // Criar compra para um item específico
  const handleCreatePurchaseForItem = async (item: QuoteItem) => {
    if (!quote) return
    const prodName = item.expand?.product?.name || item.product || 'Peça'
    const desc = item.expand?.product?.description || ''
    // Tenta extrair veículo se houver na descrição "Peça avulsa para ..."
    let vehicle = ''
    if (desc.toLowerCase().includes('para ')) {
      vehicle = desc.split(/para /i)[1]?.trim() || ''
    }

    setCreatingPurchaseFor(item.id)
    try {
      const res = await createPurchaseFromQuoteItems({
        quoteId: quote.id,
        customerId: quote.customer,
        items: [
          {
            part_name: prodName,
            vehicle: vehicle,
            quantity: item.quantity,
            unit_price: item.unit_price,
            cost_price: item.expand?.product?.cost,
          },
        ],
        notes: `Solicitação gerada a partir do orçamento ${quote.number}`,
      })

      if (res.isExisting) {
        toast({
          title: 'Compra já existente',
          description: `Este orçamento já possui a solicitação vinculada "${res.purchase.part_name}".`,
        })
      } else {
        toast({
          title: 'Card de compra criado!',
          description: `Card para "${prodName}" adicionado ao Pipeline de Compras.`,
        })
      }
      const updatedPurchases = await getPurchaseRequestsForQuote(quote.id)
      setLinkedPurchases(updatedPurchases)
    } catch (err: any) {
      console.error('Erro ao criar card de compra para item:', err)
      toast({
        title: 'Erro ao criar compra',
        description: err.message || 'Falha ao adicionar ao Pipeline de Compras.',
        variant: 'destructive',
      })
    } finally {
      setCreatingPurchaseFor(null)
    }
  }

  // Criar compra para TODOS os itens sem estoque
  const handleCreatePurchaseForAllMissing = async () => {
    if (!quote || outOfStockItems.length === 0) return
    setCreatingPurchaseFor('all')
    try {
      const itemsToCreate = outOfStockItems.map((it) => {
        const prodName = it.expand?.product?.name || it.product || 'Peça'
        const desc = it.expand?.product?.description || ''
        let vehicle = ''
        if (desc.toLowerCase().includes('para ')) {
          vehicle = desc.split(/para /i)[1]?.trim() || ''
        }
        return {
          part_name: prodName,
          vehicle,
          quantity: it.quantity,
          unit_price: it.unit_price,
          cost_price: it.expand?.product?.cost,
        }
      })

      const res = await createPurchaseFromQuoteItems({
        quoteId: quote.id,
        customerId: quote.customer,
        items: itemsToCreate,
        notes: `Solicitação gerada para os itens sem estoque do orçamento ${quote.number}`,
      })

      if (res.isExisting) {
        toast({
          title: 'Compra já vinculada',
          description: `Este orçamento já possui uma compra vinculada no pipeline.`,
        })
      } else {
        toast({
          title: 'Compra criada no Pipeline!',
          description: `${itemsToCreate.length} item(ns) sem estoque adicionados ao Pipeline de Compras.`,
        })
      }
      const updatedPurchases = await getPurchaseRequestsForQuote(quote.id)
      setLinkedPurchases(updatedPurchases)
    } catch (err: any) {
      console.error('Erro ao criar compras:', err)
      toast({
        title: 'Erro ao criar compra',
        description: err.message || 'Falha ao processar Pipeline de Compras.',
        variant: 'destructive',
      })
    } finally {
      setCreatingPurchaseFor(null)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Deseja realmente excluir este orçamento?')) return
    try {
      await deleteQuote(quote.id)
      toast({ title: 'Orçamento excluído' })
      navigate('/orcamentos')
    } catch (_) {
      toast({ title: 'Erro ao excluir orçamento', variant: 'destructive' })
    }
  }

  // Ação de conversão em pedido (Slice 1A)
  const handleOpenConvertModal = () => {
    if (existingOrder) {
      navigate('/pedidos')
      return
    }
    if (currentUser && !responsibleUserId) {
      setResponsibleUserId(currentUser.id)
    }
    setConvertModalOpen(true)
  }

  const handleConfirmConvertToOrder = async () => {
    if (!quote) return
    setConvertingOrder(true)
    try {
      const res = await convertQuoteToOrder({
        quoteId: quote.id,
        promisedDeliveryDate: promisedDeliveryDate || undefined,
        responsibleUserId: responsibleUserId || (currentUser ? currentUser.id : undefined),
      })

      if (res.success && res.order) {
        toast({
          title: res.idempotent ? 'Pedido já existente' : 'Pedido gerado com sucesso!',
          description: `Código do pedido: ${res.order.code}`,
        })
        setConvertModalOpen(false)
        await loadData()
        navigate('/pedidos')
      } else {
        toast({
          title: 'Erro ao converter orçamento',
          description: res.error || 'Falha na operação.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro inesperado',
        description: err.message || 'Falha ao converter orçamento.',
        variant: 'destructive',
      })
    } finally {
      setConvertingOrder(false)
    }
  }

  const handleSendWhatsAppPaymentLink = () => {
    const phone = quote.expand?.customer?.phone || ''
    const msg = buildPaymentLinkMessage(quote.number, quote.total, paymentLink)
    openWhatsApp(phone, msg)
  }

  const handleSendWhatsAppReceipt = () => {
    const phone = quote.expand?.customer?.phone || ''
    const msg = buildReceiptMessage(quote.number, quote.total)
    openWhatsApp(phone, msg)
  }

  const handleUploadReceipt = async () => {
    if (!id) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('quote', id)
      formData.append('amount', amount || quote.total.toString())
      formData.append('method', method)
      formData.append('status', 'aprovado')
      formData.append('paid_at', new Date().toISOString())
      if (file) formData.append('receipt', file)

      await createPayment(formData)
      await updateQuoteStatus(id, 'pago')

      toast({ title: 'Comprovante vinculado com sucesso!' })
      setReceiptModal(false)
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao vincular comprovante', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const getStatusBadge = (status: Quote['status']) => {
    const map = {
      rascunho: 'bg-slate-100 text-slate-700',
      enviado: 'bg-blue-100 text-blue-700',
      aprovado: 'bg-green-100 text-green-700',
      rejeitado: 'bg-red-100 text-red-700',
      pago: 'bg-emerald-100 text-emerald-800 font-bold',
    }
    return <Badge className={map[status] || map.rascunho}>{status.toUpperCase()}</Badge>
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/orcamentos')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{quote.number}</h1>
              {getStatusBadge(quote.status)}

              {/* Seletor Manual de Status */}
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-xs text-slate-500 font-medium">Alterar status:</span>
                <Select
                  value={quote.status}
                  onValueChange={(val: Quote['status']) => handleStatusChange(val)}
                >
                  <SelectTrigger className="h-7 text-xs font-semibold bg-white border-slate-300 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rascunho">Rascunho</SelectItem>
                    <SelectItem value="enviado">Enviado</SelectItem>
                    <SelectItem value="aprovado">Aprovado</SelectItem>
                    <SelectItem value="rejeitado">Rejeitado</SelectItem>
                    <SelectItem value="pago">Pago</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Criado em {new Date(quote.created).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Botão Principal de Envio com Modal Completo (Texto + PDF) */}
          <Button
            onClick={() => setSendQuoteModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs"
          >
            <Send className="h-4 w-4 mr-1.5" /> ENVIAR ORÇAMENTO AO CLIENTE
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                await downloadQuotePdfAsync({
                  quote,
                  items,
                  customer: quote.expand?.customer,
                })
              } catch (_) {
                downloadQuotePdf({
                  quote,
                  items,
                  customer: quote.expand?.customer,
                })
              }
            }}
            className="text-xs text-slate-700 border-slate-300 hover:bg-slate-50"
            title="Baixar orçamento em PDF"
          >
            <Download className="h-4 w-4 mr-1 text-emerald-600" /> Baixar PDF
          </Button>

          <Button
            variant="outline"
            onClick={() => navigate(`/orcamentos/${quote.id}/editar`)}
            className="text-xs text-slate-700"
          >
            <Edit className="h-4 w-4 mr-1" /> Editar
          </Button>

          {Boolean(quote.payment_token) && (
            <Button
              variant="outline"
              onClick={() => setSendPaymentLinkModal(true)}
              className="text-xs border-emerald-400 text-emerald-800 bg-emerald-50/50 hover:bg-emerald-100/70 font-semibold shadow-2xs"
              title="Enviar link de pagamento seguro separadamente via WhatsApp"
            >
              <Share2 className="h-4 w-4 mr-1 text-emerald-600" /> Enviar link de pagamento
            </Button>
          )}

          {quote.status !== 'pago' && (
            <Button
              variant="outline"
              onClick={() => setReceiptModal(true)}
              className="text-xs text-slate-700"
            >
              <Upload className="h-4 w-4 mr-1" /> Registrar Pagamento
            </Button>
          )}

          {quote.status === 'pago' && (
            <Button
              onClick={handleSendWhatsAppReceipt}
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs"
            >
              <FileCheck className="h-4 w-4 mr-1" /> Enviar Comprovante
            </Button>
          )}

          {/* Botão "Converter em pedido" (visível apenas para status aprovado ou pago) - Slice 1A */}
          {(quote.status === 'aprovado' || quote.status === 'pago') && (
            <Button
              onClick={handleOpenConvertModal}
              className={`text-xs font-bold text-white shadow-xs ${
                existingOrder
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <ShoppingBag className="h-4 w-4 mr-1.5" />
              {existingOrder ? `Ver Pedido (${existingOrder.code})` : 'Converter em Pedido'}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="text-red-500 hover:text-red-700 ml-auto"
            title="Excluir orçamento"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Banner se houver Compras Vinculadas no Pipeline de Compras */}
      {linkedPurchases.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-amber-700" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-950">
                Card no Pipeline de Compras Vinculado
              </span>
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                {linkedPurchases.length} card(s)
              </Badge>
            </div>
            <p className="text-xs text-amber-900">
              Itens deste orçamento foram enviados para cotação no Pipeline de Compras.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {linkedPurchases.map((lp) => (
              <Link
                key={lp.id}
                to={`/pipeline-compras`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/50 shadow-2xs transition-colors"
              >
                <span>Ver Compra: {lp.part_name || 'Solicitação'}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-amber-700" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Banner de Itens Sem Estoque com Ação de Compra Geral */}
      {outOfStockItems.length > 0 && (
        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-rose-900 font-bold text-xs uppercase tracking-wide">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              <span>Itens Sem Estoque Disponível ({outOfStockItems.length})</span>
            </div>
            <p className="text-xs text-slate-600">
              Existem itens neste orçamento com estoque zerado ou insuficiente. Você pode criar um
              card de compra no Pipeline de Compras para cotar com fornecedores.
            </p>
          </div>

          <Button
            type="button"
            onClick={handleCreatePurchaseForAllMissing}
            disabled={creatingPurchaseFor === 'all'}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 shadow-xs"
          >
            <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
            {creatingPurchaseFor === 'all'
              ? 'Criando compra...'
              : 'Criar compras para itens sem estoque'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Itens do Orçamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const prodStock = item.expand?.product?.stock_quantity
                const isOutOfStock = prodStock === undefined || prodStock <= 0
                const isInsufficient = !isOutOfStock && (prodStock || 0) < item.quantity
                const hasLinkedPurchase = isItemInLinkedPurchase(item)

                return (
                  <div
                    key={item.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-800 text-sm">
                          {item.expand?.product?.name || item.product || 'Produto'}
                        </p>
                        {item.expand?.product?.sku && (
                          <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.2 rounded text-slate-600">
                            {item.expand.product.sku}
                          </span>
                        )}
                        {/* Indicadores de estoque */}
                        {isOutOfStock ? (
                          <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px]">
                            Sem estoque (0 un.)
                          </Badge>
                        ) : isInsufficient ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                            Estoque insuficiente ({prodStock} un.)
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                            Em estoque ({prodStock} un.)
                          </Badge>
                        )}

                        {/* Badge se já tem compra criada */}
                        {hasLinkedPurchase && (
                          <Link
                            to="/pipeline-compras"
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                          >
                            <ShoppingBag className="h-3 w-3 text-amber-700" />
                            Compra criada
                          </Link>
                        )}
                      </div>

                      <p className="text-xs text-slate-500">
                        Qtd: <strong>{item.quantity}</strong> × {formatCurrency(item.unit_price)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 justify-between sm:justify-end">
                      <span className="font-bold text-slate-900 text-sm">
                        {formatCurrency(item.total)}
                      </span>

                      {/* Ação do Fluxo Inverso: Criar card de compra para este item se não estiver em estoque e ainda não tiver compra */}
                      {(isOutOfStock || isInsufficient) && !hasLinkedPurchase && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={creatingPurchaseFor === item.id}
                          onClick={() => handleCreatePurchaseForItem(item)}
                          className="h-7 text-xs border-amber-300 text-amber-900 hover:bg-amber-50"
                          title="Criar card no Pipeline de Compras para este item"
                        >
                          <ShoppingBag className="h-3 w-3 mr-1 text-amber-700" />
                          {creatingPurchaseFor === item.id ? 'Criando...' : 'Comprar item'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="border-t pt-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span>{formatCurrency(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Desconto:</span>
                <span>- {formatCurrency(quote.discount)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-900 border-t pt-2">
                <span>Total:</span>
                <span className="text-emerald-600">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base font-bold">Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-bold text-slate-900">{quote.expand?.customer?.name}</p>
              <p className="text-slate-600">{quote.expand?.customer?.phone}</p>
              {quote.expand?.customer?.email && (
                <p className="text-slate-500 text-xs">{quote.expand?.customer?.email}</p>
              )}
              {quote.expand?.customer?.company && (
                <p className="text-xs font-semibold text-slate-700 bg-slate-100 p-1.5 rounded mt-2">
                  {quote.expand?.customer?.company}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base font-bold">Link de Pagamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={paymentLink} readOnly className="text-xs bg-slate-50" />
              <Button variant="outline" size="sm" onClick={handleCopyLink} className="w-full">
                {copied ? (
                  <Check className="h-4 w-4 mr-1 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {copied ? 'Copiado!' : 'Copiar Link'}
              </Button>
              <Button
                size="sm"
                onClick={() => setSendPaymentLinkModal(true)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
              >
                <Share2 className="h-3.5 w-3.5 mr-1.5" /> Enviar link de pagamento
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {payments.length > 0 && (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">
              Comprovantes & Pagamentos Registrados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {payments.map((p) => (
                <div key={p.id} className="py-3 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-semibold text-slate-800">Método: {p.method.toUpperCase()}</p>
                    <p className="text-xs text-slate-500">
                      Data: {p.paid_at ? new Date(p.paid_at).toLocaleString('pt-BR') : 'Sem data'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-emerald-600">{formatCurrency(p.amount)}</span>
                    <Badge
                      variant="outline"
                      className="ml-2 bg-emerald-50 text-emerald-700 border-emerald-200"
                    >
                      {p.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de Enviar Orçamento ao Cliente (Texto Formatado + PDF) */}
      {quote && (
        <SendQuoteDialog
          isOpen={sendQuoteModal}
          onClose={() => setSendQuoteModal(false)}
          quote={quote}
          items={items}
          customer={quote.expand?.customer}
          onSuccess={() => {
            setQuote((prev) => (prev ? { ...prev, status: 'enviado' } : null))
            loadData()
          }}
        />
      )}

      {/* Modal de Enviar Link de Pagamento Separado ao Cliente */}
      {quote && (
        <SendPaymentLinkDialog
          isOpen={sendPaymentLinkModal}
          onClose={() => setSendPaymentLinkModal(false)}
          quote={quote}
          customer={quote.expand?.customer}
        />
      )}

      <Dialog open={receiptModal} onOpenChange={setReceiptModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar / Vincular Pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Forma de Pagamento</Label>
              <Select value={method} onValueChange={(val: any) => setMethod(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao">Cartão de Crédito/Débito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Anexar Comprovante (Imagem / PDF)</Label>
              <Input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptModal(false)}>
              Cancelar
            </Button>
            <Button
              disabled={uploading}
              onClick={handleUploadReceipt}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {uploading ? 'Salvando...' : 'Confirmar e Aprovar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
