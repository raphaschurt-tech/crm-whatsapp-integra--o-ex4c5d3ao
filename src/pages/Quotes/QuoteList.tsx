import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Plus,
  Search,
  Eye,
  MessageCircle,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Trash2,
} from 'lucide-react'
import { getQuotes, deleteQuote } from '@/services/quotes'
import { getSettings } from '@/services/settings'
import { Quote } from '@/types/crm'
import { formatCurrency, openWhatsApp, buildQuoteMessage } from '@/lib/whatsapp'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

import { useTabs } from '@/contexts/TabsContext'

export default function QuoteList() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { activeTab, updateTabState, updateTabTitle } = useTabs()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [search, setSearch] = useState(
    () => (activeTab?.state?.search as string) || searchParams.get('search') || '',
  )
  const [statusFilter, setStatusFilter] = useState<string>(
    () => (activeTab?.state?.statusFilter as string) || 'todos',
  )
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { isAdmin } = useAuth()

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [data, settings] = await Promise.all([getQuotes(), getSettings()])
      setQuotes(data)
      if (settings?.whatsapp_number) setWhatsappNumber(settings.whatsapp_number)
    } catch (e: any) {
      console.error('Erro ao carregar orçamentos:', e)
      setLoadError(e?.message || 'Falha ao comunicar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Sincroniza estado da aba e título
  useEffect(() => {
    if (!activeTab || activeTab.routeKey !== '/orcamentos') return
    updateTabState(activeTab.id, {
      search,
      statusFilter,
    })

    const trimmed = search.trim()
    if (trimmed) {
      updateTabTitle(activeTab.id, `Orçamentos — ${trimmed}`)
    } else {
      updateTabTitle(activeTab.id, 'Orçamentos')
    }
  }, [search, statusFilter, activeTab?.id])

  useRealtime('quotes', () => {
    loadData()
  })

  const filteredQuotes = quotes.filter((q) => {
    const matchSearch =
      q.number.toLowerCase().includes(search.toLowerCase()) ||
      (q.expand?.customer?.name || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'todos' || q.status === statusFilter
    return matchSearch && matchStatus
  })

  const handleCopyLink = (quote: Quote) => {
    const origin = window.location.origin
    const link = `${origin}/pagamento/${quote.id}?token=${quote.payment_token}`
    navigator.clipboard.writeText(link)
    setCopiedId(quote.id)
    toast({
      title: 'Link Copiado!',
      description: 'Link de pagamento copiado para a área de transferência.',
    })
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSendWhatsApp = (quote: Quote) => {
    const phone = quote.expand?.customer?.phone || whatsappNumber
    const origin = window.location.origin
    const link = `${origin}/pagamento/${quote.id}?token=${quote.payment_token || ''}`
    const msg = buildQuoteMessage(
      quote.number || 'Orçamento',
      quote.expand?.customer?.name || 'Cliente',
      quote.total || 0,
      link,
    )
    openWhatsApp(phone, msg)
  }

  const handleConfirmDelete = async () => {
    if (!quoteToDelete) return
    setIsDeleting(true)
    try {
      await deleteQuote(quoteToDelete.id)
      setQuotes((prev) => prev.filter((q) => q.id !== quoteToDelete.id))
      toast({
        title: 'Orçamento excluído',
        description: `O orçamento ${quoteToDelete.number} foi excluído com sucesso.`,
      })
      setQuoteToDelete(null)
    } catch (err: any) {
      console.error('Erro ao excluir orçamento:', err)
      const errorMsg =
        err?.status === 403 || err?.data?.message?.includes('admin')
          ? 'Apenas administradores têm permissão para excluir orçamentos.'
          : 'Erro ao excluir orçamento. Tente novamente.'
      toast({
        title: 'Erro ao excluir',
        description: errorMsg,
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const getStatusBadge = (status?: Quote['status'] | null) => {
    const map: Record<string, { label: string; class: string }> = {
      rascunho: { label: 'Rascunho', class: 'bg-slate-100 text-slate-700 border-slate-200' },
      enviado: { label: 'Enviado', class: 'bg-blue-100 text-blue-700 border-blue-200' },
      aprovado: { label: 'Aprovado', class: 'bg-green-100 text-green-700 border-green-200' },
      rejeitado: { label: 'Rejeitado', class: 'bg-red-100 text-red-700 border-red-200' },
      pago: {
        label: 'Pago',
        class: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
      },
    }
    const item = (status && map[status]) || map.rascunho
    return (
      <Badge variant="outline" className={item.class}>
        {item.label}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orçamentos</h1>
          <p className="text-sm text-slate-500">Gerencie e envie orçamentos via WhatsApp</p>
        </div>
        <Button
          onClick={() => navigate('/orcamentos/novo')}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo Orçamento
        </Button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por número ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os Status</SelectItem>
              <SelectItem value="rascunho">Rascunho</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="rejeitado">Rejeitado</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
          <p>Carregando orçamentos...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white p-8 rounded-xl border border-red-200 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-700 font-medium">Não foi possível carregar os orçamentos.</p>
          <p className="text-xs text-slate-500">O servidor pode estar inicializando.</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filteredQuotes.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center space-y-3">
          <p className="text-slate-500">Nenhum orçamento encontrado.</p>
          <Button onClick={() => navigate('/orcamentos/novo')} variant="outline">
            Criar Primeiro Orçamento
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                  <th className="p-4">Número</th>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Data</th>
                  <th className="p-4">Total</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{quote.number}</td>
                    <td className="p-4 text-slate-800">
                      {quote.expand?.customer?.name || 'Cliente removido'}
                    </td>
                    <td className="p-4 text-slate-500">
                      {new Date(quote.created).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4 font-semibold text-slate-900">
                      {formatCurrency(quote.total || 0)}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {getStatusBadge(quote.status)}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setQuoteToDelete(quote)}
                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Excluir orçamento"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/orcamentos/${quote.id}`)}
                      >
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyLink(quote)}
                        title="Copiar link de pagamento"
                      >
                        {copiedId === quote.id ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4 text-slate-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSendWhatsApp(quote)}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white"
                        title="Enviar no WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-100">
            {filteredQuotes.map((quote) => (
              <div key={quote.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{quote.number}</span>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(quote.status)}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setQuoteToDelete(quote)}
                        className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Excluir orçamento"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {quote.expand?.customer?.name || 'Cliente'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(quote.created).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-base font-bold text-slate-900">
                    {formatCurrency(quote.total || 0)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/orcamentos/${quote.id}`)}
                    >
                      Ver
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSendWhatsApp(quote)}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmação de Exclusão de Orçamento (apenas admin) */}
      <Dialog
        open={!!quoteToDelete}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setQuoteToDelete(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Excluir orçamento?
            </DialogTitle>
            <DialogDescription className="pt-2 text-slate-600 text-sm leading-relaxed">
              Tem certeza que deseja excluir o orçamento{' '}
              <strong className="text-slate-900">{quoteToDelete?.number}</strong>
              {quoteToDelete?.expand?.customer?.name
                ? ` (${quoteToDelete.expand.customer.name})`
                : ''}
              ? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setQuoteToDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
