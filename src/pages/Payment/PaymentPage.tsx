import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  CheckCircle,
  Clock,
  QrCode,
  CreditCard,
  AlertCircle,
  Building2,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react'
import logoImg from '@/assets/logo-rpa-auto-parts-01-definitivo-correto-1d75c.png'
import pb from '@/lib/pocketbase/client'
import { Quote, QuoteItem } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [quote, setQuote] = useState<Quote | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [paidSuccess, setPaidSuccess] = useState(false)
  const [copiedPix, setCopiedPix] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState<'pix' | 'cartao'>('pix')

  const loadData = async () => {
    if (!id) return
    try {
      const q = await pb.collection<Quote>('quotes').getOne(id, {
        expand: 'customer',
      })

      // If quote has a token, verify
      if (q.payment_token && token && q.payment_token !== token) {
        setError('Link de pagamento inválido ou expirado.')
        setLoading(false)
        return
      }

      setQuote(q)
      if (q.status === 'pago') {
        setPaidSuccess(true)
      }

      const qItems = await pb.collection<QuoteItem>('quote_items').getFullList({
        filter: `quote = "${id}"`,
        expand: 'product',
      })
      setItems(qItems)
    } catch (e: any) {
      console.error(e)
      setError('Não foi possível localizar este orçamento. Verifique o link.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id, token])

  const handleSimulatePayment = async () => {
    if (!id) return
    setPaying(true)
    try {
      const effectiveToken = token || quote?.payment_token || 'tok_direct'
      const res = await pb.send('/backend/v1/payments/confirm', {
        method: 'POST',
        body: {
          quote_id: id,
          token: effectiveToken,
          method: selectedMethod,
        },
      })

      if (res && (res.success || res.status === 'pago')) {
        setPaidSuccess(true)
        if (quote) {
          setQuote({ ...quote, status: 'pago' })
        }
        toast({
          title: 'Pagamento Concluído!',
          description: 'Seu pagamento foi confirmado com sucesso.',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao processar pagamento',
        description: err.message || 'Tente novamente em instantes.',
        variant: 'destructive',
      })
    } finally {
      setPaying(false)
    }
  }

  const fakePixCode = `00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540${quote ? quote.total.toFixed(2) : '0.00'}5802BR5913CRM_INTRAGAN6009SAO_PAULO62070503***6304ABCD`

  const handleCopyPix = () => {
    navigator.clipboard.writeText(fakePixCode)
    setCopiedPix(true)
    toast({ title: 'Código PIX Copiado!' })
    setTimeout(() => setCopiedPix(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">
            Carregando detalhes do pagamento...
          </p>
        </div>
      </div>
    )
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-red-200">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-slate-900">Atenção</h2>
            <p className="text-sm text-slate-600">{error || 'Orçamento não encontrado.'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 py-8 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl space-y-6">
        {/* Brand header */}
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <img
            src={logoImg}
            alt="RPA Auto Parts"
            className="h-16 w-auto max-w-[220px] object-contain"
          />
          <p className="text-xs text-slate-500 font-medium">Checkout Seguro de Propostas & Peças</p>
        </div>

        {paidSuccess ? (
          <Card className="border-emerald-200 bg-white shadow-lg overflow-hidden">
            <div className="bg-emerald-500 py-6 text-center text-white space-y-2">
              <CheckCircle className="h-16 w-16 mx-auto" />
              <h2 className="text-2xl font-bold">Pagamento Confirmado!</h2>
              <p className="text-sm text-emerald-100">
                Obrigado! O orçamento <strong>{quote.number}</strong> foi quitado.
              </p>
            </div>
            <CardContent className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm border">
                <div className="flex justify-between">
                  <span className="text-slate-500">Valor Pago:</span>
                  <span className="font-bold text-slate-900">{formatCurrency(quote.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cliente:</span>
                  <span className="font-medium text-slate-900">{quote.expand?.customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <Badge className="bg-emerald-500 text-white">APROVADO / PAGO</Badge>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Transação registrada com segurança no sistema</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {/* Left summary */}
            <Card className="md:col-span-3 border-slate-200 shadow-md">
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold text-slate-800">
                    Resumo do Pedido
                  </CardTitle>
                  <Badge variant="outline" className="text-xs font-mono">
                    {quote.number}
                  </Badge>
                </div>
                {quote.expand?.customer && (
                  <p className="text-xs text-slate-500 mt-1">
                    Para: <strong>{quote.expand.customer.name}</strong>
                    {quote.expand.customer.company ? ` (${quote.expand.customer.company})` : ''}
                  </p>
                )}
              </CardHeader>

              <CardContent className="p-4 space-y-4">
                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {items.map((it) => (
                    <div key={it.id} className="py-2.5 flex justify-between items-center text-sm">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {it.expand?.product?.name || 'Item do Pedido'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {it.quantity} un. x {formatCurrency(it.unit_price)}
                        </p>
                      </div>
                      <span className="font-bold text-slate-900">{formatCurrency(it.total)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-3 space-y-1.5 text-sm bg-slate-50/70 -mx-4 -mb-4 p-4 rounded-b-xl">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(quote.subtotal)}</span>
                  </div>
                  {quote.discount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Desconto Aplicado:</span>
                      <span>- {formatCurrency(quote.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-extrabold text-slate-900 border-t pt-2">
                    <span>Valor Total:</span>
                    <span className="text-emerald-600">{formatCurrency(quote.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Right payment options */}
            <Card className="md:col-span-2 border-slate-200 shadow-md flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base font-bold text-slate-800">
                    Forma de Pagamento
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedMethod('pix')}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-xs font-semibold transition-all ${
                        selectedMethod === 'pix'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <QrCode className="h-5 w-5" />
                      <span>PIX Instantâneo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedMethod('cartao')}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-xs font-semibold transition-all ${
                        selectedMethod === 'cartao'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <CreditCard className="h-5 w-5" />
                      <span>Cartão de Crédito</span>
                    </button>
                  </div>

                  {selectedMethod === 'pix' ? (
                    <div className="space-y-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center">
                      <div className="bg-white p-3 rounded-lg border inline-block shadow-sm">
                        <QrCode className="h-28 w-28 text-slate-900 mx-auto" />
                      </div>
                      <p className="text-xs text-slate-500">
                        Escaneie o QR Code ou use o Copia e Cola para pagar via seu aplicativo
                        bancário.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCopyPix}
                        className="w-full text-xs font-semibold"
                      >
                        {copiedPix ? (
                          <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 mr-1" />
                        )}
                        {copiedPix ? 'Código PIX Copiado!' : 'Copiar Chave PIX'}
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border text-center space-y-2">
                      <CreditCard className="h-8 w-8 text-slate-400 mx-auto" />
                      <p className="text-xs text-slate-600">
                        Ambiente seguro de checkout integrado. Clique no botão abaixo para concluir
                        a simulação.
                      </p>
                    </div>
                  )}
                </CardContent>
              </div>

              <div className="p-4 border-t space-y-2">
                <Button
                  type="button"
                  onClick={handleSimulatePayment}
                  disabled={paying}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 shadow"
                >
                  {paying ? 'Processando Pagamento...' : `Pagar ${formatCurrency(quote.total)}`}
                </Button>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Ambiente Criptografado & Seguro</span>
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="text-center text-xs text-slate-400 flex items-center justify-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          <span>RPA Auto Parts — Desde 1995</span>
        </div>
      </div>
    </div>
  )
}
