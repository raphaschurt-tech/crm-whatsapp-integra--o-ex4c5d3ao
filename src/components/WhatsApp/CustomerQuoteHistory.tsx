import { useEffect, useState } from 'react'
import {
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  Send,
  Eye,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { Quote } from '@/types/crm'
import pb from '@/lib/pocketbase/client'
import { formatCurrency, openWhatsApp, buildPaymentLinkMessage } from '@/lib/whatsapp'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useNavigate } from 'react-router-dom'

interface CustomerQuoteHistoryProps {
  customerId?: string
  customerPhone?: string
  customerName?: string
  onOpenCreateQuote?: () => void
  refreshTrigger?: number
}

export type DisplayQuoteStatus =
  | 'enviado'
  | 'aprovado'
  | 'pago'
  | 'vencido'
  | 'rascunho'
  | 'rejeitado'

export function CustomerQuoteHistory({
  customerId,
  customerPhone,
  customerName,
  onOpenCreateQuote,
  refreshTrigger,
}: CustomerQuoteHistoryProps) {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadCustomerQuotes = async () => {
    if (!customerId && !customerPhone) {
      setQuotes([])
      return
    }

    setLoading(true)
    try {
      let resolvedCustomerId = customerId

      // Se não temos customerId direto, tentar localizar o cliente pelo telefone antes de buscar quotes
      if (!resolvedCustomerId && customerPhone) {
        const digits = customerPhone.replace(/\D/g, '')
        if (digits.length >= 8) {
          const variants = new Set<string>()
          variants.add(digits)
          if (digits.startsWith('55') && digits.length >= 12) {
            variants.add(digits.slice(2))
          } else if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
            variants.add(`55${digits}`)
          }

          const filterPhoneParts = Array.from(variants)
            .map((v) => `phone ~ "${v}"`)
            .join(' || ')

          try {
            const matchedCustomers = await pb.collection('customers').getList(1, 5, {
              filter: filterPhoneParts,
            })
            // Encontrar cliente cujo número limpo case exatamente com uma das variantes
            const matched = matchedCustomers.items.find((c: any) => {
              const cDigits = (c.phone || '').replace(/\D/g, '')
              return variants.has(cDigits)
            })
            if (matched) {
              resolvedCustomerId = matched.id
            }
          } catch (cErr) {
            console.warn('Erro ao buscar cliente por telefone no CustomerQuoteHistory:', cErr)
          }
        }
      }

      // Se mesmo após a tentativa de resolução não encontramos o customerId, NUNCA buscar quotes sem filtro
      if (!resolvedCustomerId) {
        setQuotes([])
        return
      }

      const list = await pb.collection<Quote>('quotes').getFullList({
        filter: `customer = "${resolvedCustomerId}"`,
        sort: '-created',
        expand: 'customer',
      })

      setQuotes(list)
    } catch (err) {
      console.warn('Erro ao carregar histórico de orçamentos do cliente:', err)
      setQuotes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCustomerQuotes()
  }, [customerId, customerPhone, refreshTrigger])

  /**
   * Deriva o status exibido com suporte a "vencido"
   * Um orçamento com status "enviado" ou "rascunho" com mais de 7 dias é considerado vencido
   */
  const computeDisplayStatus = (quote: Quote): DisplayQuoteStatus => {
    if (quote.status === 'pago') return 'pago'
    if (quote.status === 'aprovado') return 'aprovado'
    if (quote.status === 'rejeitado') return 'rejeitado'

    // Checagem de validade (7 dias corridos a partir da criação)
    const createdDate = new Date(quote.created)
    const now = new Date()
    const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24)

    if (diffDays > 7 && (quote.status === 'enviado' || quote.status === 'rascunho')) {
      return 'vencido'
    }

    if (quote.status === 'enviado') return 'enviado'
    return 'rascunho'
  }

  const renderStatusBadge = (status: DisplayQuoteStatus) => {
    switch (status) {
      case 'pago':
        return (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
            <CheckCircle className="w-3 h-3 mr-1 inline" /> Pago
          </Badge>
        )
      case 'aprovado':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] font-bold">
            <CheckCircle className="w-3 h-3 mr-1 inline" /> Aprovado
          </Badge>
        )
      case 'enviado':
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] font-bold">
            <Clock className="w-3 h-3 mr-1 inline" /> Enviado
          </Badge>
        )
      case 'vencido':
        return (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-bold">
            <AlertCircle className="w-3 h-3 mr-1 inline" /> Vencido
          </Badge>
        )
      case 'rejeitado':
        return (
          <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-bold">
            <XCircle className="w-3 h-3 mr-1 inline" /> Rejeitado
          </Badge>
        )
      case 'rascunho':
      default:
        return (
          <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[10px] font-bold">
            Rascunho
          </Badge>
        )
    }
  }

  const handleCopyPaymentLink = (quote: Quote) => {
    const link = `${window.location.origin}/pagamento/${quote.id}?token=${quote.payment_token}`
    navigator.clipboard.writeText(link)
    setCopiedId(quote.id)
    toast({ title: 'Link de pagamento copiado!' })
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSendPaymentLinkWhatsApp = (quote: Quote) => {
    if (!customerPhone) return
    const link = `${window.location.origin}/pagamento/${quote.id}?token=${quote.payment_token}`
    const msg = buildPaymentLinkMessage(quote.number, quote.total, link)
    openWhatsApp(customerPhone, msg)
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 w-full sm:w-80 md:w-96 shrink-0 relative z-20">
      {/* Header do Painel */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-600" />
          <h3 className="font-bold text-slate-900 text-sm">Histórico de Orçamentos</h3>
          <span className="text-[11px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full">
            {quotes.length}
          </span>
        </div>

        <button
          type="button"
          onClick={loadCustomerQuotes}
          disabled={loading}
          className="text-slate-400 hover:text-slate-600 p-1"
          title="Atualizar histórico"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
        </button>
      </div>

      {/* Lista de Orçamentos com Scroll */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
            <span>Buscando orçamentos...</span>
          </div>
        ) : quotes.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 space-y-3">
            <FileText className="w-8 h-8 mx-auto text-slate-300" />
            <p className="font-semibold text-slate-600">Nenhum orçamento emitido</p>
            <p className="text-[11px] text-slate-400">
              Clique em <strong>"Buscar Produtos"</strong> para montar o primeiro orçamento deste
              cliente.
            </p>
            {onOpenCreateQuote && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenCreateQuote}
                className="text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              >
                + Criar Orçamento
              </Button>
            )}
          </div>
        ) : (
          quotes.map((q) => {
            const displayStatus = computeDisplayStatus(q)
            const createdDate = new Date(q.created).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })

            return (
              <div
                key={q.id}
                className="p-3 rounded-lg border border-slate-200 bg-white hover:border-emerald-300 shadow-2xs transition-colors space-y-2"
              >
                {/* Linha 1: Número e Status */}
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-900 text-xs font-mono">{q.number}</span>
                  {renderStatusBadge(displayStatus)}
                </div>

                {/* Linha 2: Valor e Data */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 text-[11px]">Criado em {createdDate}</span>
                  <span className="font-extrabold text-emerald-700 text-sm">
                    {formatCurrency(q.total)}
                  </span>
                </div>

                {q.notes && (
                  <p className="text-[11px] text-slate-500 bg-slate-50 p-1.5 rounded border border-slate-100 italic truncate">
                    "{q.notes}"
                  </p>
                )}

                {/* Ações rápidas */}
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100 text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/orcamentos/${q.id}`)}
                    className="h-6 text-[11px] px-1.5 text-slate-600 hover:text-emerald-700"
                    title="Ver detalhes do orçamento"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    Ver Detalhes
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyPaymentLink(q)}
                      className="h-6 text-[11px] px-1.5 text-slate-600 hover:text-slate-900"
                      title="Copiar link de pagamento"
                    >
                      {copiedId === q.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>

                    {customerPhone && displayStatus !== 'pago' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSendPaymentLinkWhatsApp(q)}
                        className="h-6 text-[11px] px-1.5 text-emerald-700 hover:bg-emerald-50"
                        title="Reenviar link de pagamento via WhatsApp"
                      >
                        <Send className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
