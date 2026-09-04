import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  MessageCircle,
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
} from 'lucide-react'
import { getQuote, getQuoteItems, updateQuoteStatus, deleteQuote } from '@/services/quotes'
import { getPaymentsForQuote, createPayment } from '@/services/payments'
import { Quote, QuoteItem, Payment } from '@/types/crm'
import {
  formatCurrency,
  openWhatsApp,
  buildQuoteMessage,
  buildPaymentLinkMessage,
  buildReceiptMessage,
} from '@/lib/whatsapp'
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

  const [quote, setQuote] = useState<Quote | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
      const q = await getQuote(id)
      setQuote(q)
      const qItems = await getQuoteItems(id)
      setItems(qItems)
      const pList = await getPaymentsForQuote(id)
      setPayments(pList)
      setAmount(q.total.toString())
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
      setQuote((prev) => (prev ? { ...prev, status: newStatus } : null))
      toast({ title: `Status alterado para ${newStatus.toUpperCase()}` })
    } catch (_) {
      toast({ title: 'Erro ao atualizar status', variant: 'destructive' })
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

  const handleSendWhatsAppProposal = () => {
    const phone = quote.expand?.customer?.phone || ''
    const msg = buildQuoteMessage(
      quote.number,
      quote.expand?.customer?.name || 'Cliente',
      quote.total,
      paymentLink,
    )
    openWhatsApp(phone, msg)
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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{quote.number}</h1>
              {getStatusBadge(quote.status)}
            </div>
            <p className="text-sm text-slate-500">
              Criado em {new Date(quote.created).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {quote.status === 'rascunho' && (
            <>
              <Button variant="outline" onClick={() => navigate(`/orcamentos/${quote.id}/editar`)}>
                <Edit className="h-4 w-4 mr-1" /> Editar
              </Button>
              <Button
                onClick={handleSendWhatsAppProposal}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                <MessageCircle className="h-4 w-4 mr-1" /> Enviar
              </Button>
            </>
          )}

          {quote.status === 'enviado' && (
            <>
              <Button
                variant="outline"
                onClick={() => handleStatusChange('aprovado')}
                className="text-green-700 border-green-300"
              >
                <CheckCircle className="h-4 w-4 mr-1" /> Marcar Aprovado
              </Button>
              <Button
                variant="outline"
                onClick={() => handleStatusChange('rejeitado')}
                className="text-red-700 border-red-300"
              >
                <XCircle className="h-4 w-4 mr-1" /> Rejeitar
              </Button>
            </>
          )}

          {(quote.status === 'enviado' || quote.status === 'aprovado') && (
            <Button
              onClick={handleSendWhatsAppPaymentLink}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <Share2 className="h-4 w-4 mr-1" /> Enviar Link Pagamento
            </Button>
          )}

          {quote.status !== 'pago' && (
            <Button variant="outline" onClick={() => setReceiptModal(true)}>
              <Upload className="h-4 w-4 mr-1" /> Registrar Pagamento
            </Button>
          )}

          {quote.status === 'pago' && (
            <Button
              onClick={handleSendWhatsAppReceipt}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <FileCheck className="h-4 w-4 mr-1" /> Enviar Comprovante
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="text-red-500 hover:text-red-700"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Itens do Orçamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-slate-800">
                      {item.expand?.product?.name || 'Produto'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Qtd: {item.quantity} x {formatCurrency(item.unit_price)}
                    </p>
                  </div>
                  <span className="font-bold text-slate-900">{formatCurrency(item.total)}</span>
                </div>
              ))}
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
