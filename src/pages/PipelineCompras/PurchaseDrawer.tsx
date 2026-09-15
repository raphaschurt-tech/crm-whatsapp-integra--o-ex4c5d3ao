import React, { useState, useEffect } from 'react'
import {
  X,
  TrendingUp,
  Save,
  Trash2,
  ExternalLink,
  Plus,
  Hash,
  Layers,
  DollarSign,
  Truck,
  Clock,
} from 'lucide-react'
import { Customer, PurchaseItem, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'
import {
  PURCHASE_COLUMNS,
  normalizePurchaseItems,
  formatPurchaseItemsSummary,
  getItemMargin,
  calculateMarginPercent,
  calculateSellPriceFromMargin,
  checkPurchaseQuoteEligibility,
  generateOrUpdateQuoteFromPurchase,
} from '@/services/purchaseRequestsService'
import { formatCurrency } from '@/lib/whatsapp'
import { getQuote, getQuoteItems } from '@/services/quotes'
import { SendQuoteDialog } from '@/components/Quotes/SendQuoteDialog'
import { SendPaymentLinkDialog } from '@/components/Quotes/SendPaymentLinkDialog'
import { Quote, QuoteItem } from '@/types/crm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Link } from 'react-router-dom'
import { toast } from '@/hooks/use-toast'
import { FileText, RefreshCw, CheckCircle2, AlertCircle, Send, Share2 } from 'lucide-react'

interface PurchaseDrawerProps {
  card: PurchaseRequest | null
  customers: Customer[]
  suppliers: Customer[]
  onClose: () => void
  onUpdate: (id: string, data: Partial<PurchaseRequest>) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onMoveStatus: (id: string, targetStatus: PurchaseRequestStatus) => Promise<void>
  onGenerateQuote?: (id: string) => Promise<void>
}

const MAX_ITEMS = 20

interface FormItemState {
  part_name: string
  vehicle: string
  quantity: number
  supplier_id?: string
  cost_price?: string
  margin_percent?: string
  sell_price?: string
}

export const PurchaseDrawer: React.FC<PurchaseDrawerProps> = ({
  card,
  customers,
  suppliers,
  onClose,
  onUpdate,
  onDelete,
  onMoveStatus,
  onGenerateQuote,
}) => {
  const [items, setItems] = useState<FormItemState[]>([
    { part_name: '', vehicle: '', quantity: 1, supplier_id: '', cost_price: '', sell_price: '' },
  ])
  const [osNumber, setOsNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [status, setStatus] = useState<PurchaseRequestStatus>('solicitada')
  const [deliveryDays, setDeliveryDays] = useState<string>('')
  const [receivedAt, setReceivedAt] = useState<string>('')
  const [isCompleted, setIsCompleted] = useState<boolean>(false)
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false)

  // Enviar orçamento ao cliente a partir do drawer da compra
  const [isSendQuoteOpen, setIsSendQuoteOpen] = useState(false)
  const [isSendPaymentLinkOpen, setIsSendPaymentLinkOpen] = useState(false)
  const [loadedQuote, setLoadedQuote] = useState<Quote | null>(null)
  const [loadedQuoteItems, setLoadedQuoteItems] = useState<QuoteItem[]>([])
  const [isLoadingQuoteData, setIsLoadingQuoteData] = useState(false)
  const [isLoadingPaymentLinkQuote, setIsLoadingPaymentLinkQuote] = useState(false)

  const formatPercentDisplay = (val: number): string => {
    const rounded = Math.round(val * 100) / 100
    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2).replace(/\.?0+$/, '')
  }

  // Sincronizar ao abrir/mudar card
  useEffect(() => {
    if (!card) return
    const normalized = normalizePurchaseItems(card)
    if (normalized.length > 0) {
      setItems(
        normalized.map((it) => {
          const costVal =
            it.cost_price !== undefined && it.cost_price !== null ? it.cost_price : undefined
          const sellVal =
            it.sell_price !== undefined && it.sell_price !== null ? it.sell_price : undefined
          let initialMarginPct = ''
          if (typeof costVal === 'number' && costVal > 0 && typeof sellVal === 'number') {
            const calculated = calculateMarginPercent(costVal, sellVal)
            if (calculated !== null) {
              initialMarginPct = formatPercentDisplay(calculated)
            }
          }
          return {
            part_name: it.part_name || '',
            vehicle: it.vehicle || '',
            quantity: it.quantity || 1,
            supplier_id: it.supplier_id || '',
            cost_price: costVal !== undefined ? String(costVal) : '',
            margin_percent: initialMarginPct,
            sell_price: sellVal !== undefined ? String(sellVal) : '',
          }
        }),
      )
    } else {
      const legacyCost =
        card.cost_price !== undefined && card.cost_price !== null ? card.cost_price : undefined
      const legacySell =
        card.sell_price !== undefined && card.sell_price !== null ? card.sell_price : undefined
      let initialMarginPct = ''
      if (typeof legacyCost === 'number' && legacyCost > 0 && typeof legacySell === 'number') {
        const calculated = calculateMarginPercent(legacyCost, legacySell)
        if (calculated !== null) {
          initialMarginPct = formatPercentDisplay(calculated)
        }
      }
      setItems([
        {
          part_name: card.part_name || '',
          vehicle: card.vehicle || '',
          quantity: 1,
          supplier_id: card.supplier || '',
          cost_price: legacyCost !== undefined ? String(legacyCost) : '',
          margin_percent: initialMarginPct,
          sell_price: legacySell !== undefined ? String(legacySell) : '',
        },
      ])
    }

    setOsNumber(card.os_number || '')
    setCustomerId(card.customer || '')
    setStatus(card.status)
    setDeliveryDays(
      card.delivery_days !== undefined && card.delivery_days !== null
        ? String(card.delivery_days)
        : '',
    )
    setReceivedAt(card.received_at ? card.received_at.split('T')[0] : '')
    setIsCompleted(card.is_completed || false)
    setNotes(card.notes || '')
  }, [card])

  if (!card) return null

  const handleItemChange = (index: number, field: keyof FormItemState, value: any) => {
    setItems((prev) => {
      const next = [...prev]
      const currentItem = { ...next[index] }

      if (field === 'quantity') {
        const val = parseInt(value, 10)
        currentItem.quantity = isNaN(val) || val < 1 ? 1 : val
        next[index] = currentItem
        return next
      }

      if (field === 'cost_price') {
        currentItem.cost_price = value
        const costNum = parseFloat(value)

        // Se custo for vazio ou zero/negativo: margem % vazia, venda não calcula automaticamente
        if (isNaN(costNum) || costNum <= 0) {
          currentItem.margin_percent = ''
        } else {
          // Se tiver margem % digitada, calcula/preenche automaticamente a venda: venda = custo * (1 + margem%/100)
          const marginNum = parseFloat(currentItem.margin_percent || '')
          if (!isNaN(marginNum)) {
            const calculatedSell = calculateSellPriceFromMargin(costNum, marginNum)
            if (calculatedSell !== null) {
              currentItem.sell_price = calculatedSell.toFixed(2)
            }
          } else {
            // Se já tiver preço de venda preenchido manualmente, recalcula a margem % a partir dele
            const sellNum = parseFloat(currentItem.sell_price || '')
            if (!isNaN(sellNum)) {
              const recalculatedMargin = calculateMarginPercent(costNum, sellNum)
              currentItem.margin_percent =
                recalculatedMargin !== null ? formatPercentDisplay(recalculatedMargin) : ''
            }
          }
        }

        next[index] = currentItem
        return next
      }

      if (field === 'margin_percent') {
        currentItem.margin_percent = value
        const costNum = parseFloat(currentItem.cost_price || '')
        const marginNum = parseFloat(value)

        if (isNaN(costNum) || costNum <= 0 || isNaN(marginNum)) {
          if (!value.trim()) {
            currentItem.margin_percent = ''
          }
        } else {
          // Calcular e preencher AUTOMATICAMENTE o PREÇO DE VENDA do item: venda = custo × (1 + margem%/100)
          const calculatedSell = calculateSellPriceFromMargin(costNum, marginNum)
          if (calculatedSell !== null) {
            currentItem.sell_price = calculatedSell.toFixed(2)
          }
        }

        next[index] = currentItem
        return next
      }

      if (field === 'sell_price') {
        currentItem.sell_price = value
        const costNum = parseFloat(currentItem.cost_price || '')
        const sellNum = parseFloat(value)

        // Se o usuário digitar o PREÇO DE VENDA manualmente, recalcular a margem % a partir dele:
        // margem% = (venda - custo) / custo * 100
        if (isNaN(costNum) || costNum <= 0 || isNaN(sellNum)) {
          currentItem.margin_percent = ''
        } else {
          const recalculatedMargin = calculateMarginPercent(costNum, sellNum)
          currentItem.margin_percent =
            recalculatedMargin !== null ? formatPercentDisplay(recalculatedMargin) : ''
        }

        next[index] = currentItem
        return next
      }

      next[index] = { ...currentItem, [field]: value }
      return next
    })
  }

  const handleAddItem = () => {
    if (items.length >= MAX_ITEMS) return
    setItems((prev) => [
      ...prev,
      {
        part_name: '',
        vehicle: '',
        quantity: 1,
        supplier_id: '',
        cost_price: '',
        margin_percent: '',
        sell_price: '',
      },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const hasInvalidItems = items.some(
    (item) => !item.part_name.trim() || !item.vehicle.trim() || (item.quantity || 1) < 1,
  )

  // Avaliação de elegibilidade para GERAR ORÇAMENTO em tempo real
  const currentFormPurchase: Partial<PurchaseRequest> = {
    customer: customerId,
    items: items.map((it) => {
      const sellNum = parseFloat(it.sell_price || '')
      const costNum = parseFloat(it.cost_price || '')
      return {
        part_name: it.part_name,
        vehicle: it.vehicle,
        quantity: Math.max(1, Number(it.quantity) || 1),
        supplier_id: it.supplier_id || undefined,
        cost_price: !isNaN(costNum) ? costNum : undefined,
        sell_price: !isNaN(sellNum) ? sellNum : undefined,
      }
    }),
  }
  const quoteEligibility = checkPurchaseQuoteEligibility(currentFormPurchase)

  // Orçamento vinculado
  const linkedQuoteId = card.quote || (card.expand?.quote?.id as string | undefined)
  const linkedQuoteNumber = card.expand?.quote?.number
  const hasLinkedQuote = Boolean(linkedQuoteId)

  const handleOpenSendQuote = async () => {
    if (!linkedQuoteId) return
    setIsLoadingQuoteData(true)
    try {
      const q = await getQuote(linkedQuoteId)
      const qItems = await getQuoteItems(linkedQuoteId)
      setLoadedQuote(q)
      setLoadedQuoteItems(qItems)
      setIsSendQuoteOpen(true)
    } catch (err: any) {
      console.error('Erro ao carregar orçamento vinculado para envio:', err)
      toast({
        title: 'Erro ao abrir envio',
        description: err.message || 'Não foi possível carregar os dados do orçamento.',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingQuoteData(false)
    }
  }

  const handleOpenSendPaymentLink = async () => {
    if (!linkedQuoteId) return
    setIsLoadingPaymentLinkQuote(true)
    try {
      const q = await getQuote(linkedQuoteId)
      setLoadedQuote(q)
      setIsSendPaymentLinkOpen(true)
    } catch (err: any) {
      console.error('Erro ao carregar orçamento para enviar link de pagamento:', err)
      toast({
        title: 'Erro ao carregar orçamento',
        description: err.message || 'Não foi possível carregar o orçamento vinculado.',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingPaymentLinkQuote(false)
    }
  }

  const handleGenerateQuoteClick = async () => {
    if (!card) return
    if (!quoteEligibility.canGenerate) {
      toast({
        title: 'Não é possível gerar orçamento',
        description: quoteEligibility.reasons.join(', '),
        variant: 'destructive',
      })
      return
    }

    setIsGeneratingQuote(true)
    try {
      // 1. Salva primeiro as alterações atuais do formulário
      const cleanedItems: PurchaseItem[] = items.map((it) => {
        const costNum = it.cost_price ? parseFloat(it.cost_price) : undefined
        const sellNum = it.sell_price ? parseFloat(it.sell_price) : undefined
        const sup = suppliers.find((s) => s.id === it.supplier_id)
        const supplierName = sup ? sup.name || sup.company || undefined : undefined

        return {
          part_name: it.part_name.trim(),
          vehicle: it.vehicle.trim(),
          quantity: Math.max(1, Number(it.quantity) || 1),
          supplier_id: it.supplier_id || undefined,
          supplier_name: supplierName,
          cost_price: costNum !== undefined && !isNaN(costNum) ? costNum : undefined,
          sell_price: sellNum !== undefined && !isNaN(sellNum) ? sellNum : undefined,
        }
      })

      const firstSupplier = cleanedItems.find((it) => it.supplier_id)?.supplier_id

      const payload: Partial<PurchaseRequest> = {
        part_name: cleanedItems[0]?.part_name || '',
        vehicle: cleanedItems[0]?.vehicle || '',
        items: cleanedItems,
        os_number: osNumber.trim() || '',
        customer: customerId,
        supplier: firstSupplier || undefined,
        delivery_days: deliveryDays ? parseInt(deliveryDays, 10) : undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        is_completed: isCompleted,
        notes: notes.trim(),
      }

      await onUpdate(card.id, payload)

      // 2. Chama a geração/atualização do orçamento
      if (onGenerateQuote) {
        await onGenerateQuote(card.id)
      } else {
        const result = await generateOrUpdateQuoteFromPurchase(card.id)
        toast({
          title: result.isUpdate ? 'Orçamento atualizado!' : 'Orçamento gerado!',
          description: `Orçamento ${result.quote.number} vinculado com sucesso à compra.`,
        })
        await onUpdate(card.id, { quote: result.quote.id })
      }
    } catch (err: any) {
      console.error('Erro ao gerar orçamento:', err)
      toast({
        title: 'Erro ao gerar orçamento',
        description: err.message || 'Falha ao processar orçamento.',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingQuote(false)
    }
  }

  // Totais gerais calculados somando todos os itens
  const summaryTotals = items.reduce(
    (acc, it) => {
      const qty = Math.max(1, Number(it.quantity) || 1)
      const cost = parseFloat(it.cost_price || '')
      const sell = parseFloat(it.sell_price || '')
      if (!isNaN(cost)) {
        acc.totalCost += cost * qty
        acc.hasAnyCost = true
      }
      if (!isNaN(sell)) {
        acc.totalSell += sell * qty
        acc.hasAnySell = true
      }
      return acc
    },
    { totalCost: 0, totalSell: 0, hasAnyCost: false, hasAnySell: false },
  )

  const totalMargin = summaryTotals.totalSell - summaryTotals.totalCost
  const hasPricingSummary = summaryTotals.hasAnyCost || summaryTotals.hasAnySell

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasInvalidItems || !customerId) return

    setIsSaving(true)
    try {
      const cleanedItems: PurchaseItem[] = items.map((it) => {
        const costNum = it.cost_price ? parseFloat(it.cost_price) : undefined
        const sellNum = it.sell_price ? parseFloat(it.sell_price) : undefined
        const sup = suppliers.find((s) => s.id === it.supplier_id)
        const supplierName = sup ? sup.name || sup.company || undefined : undefined

        return {
          part_name: it.part_name.trim(),
          vehicle: it.vehicle.trim(),
          quantity: Math.max(1, Number(it.quantity) || 1),
          supplier_id: it.supplier_id || undefined,
          supplier_name: supplierName,
          cost_price: costNum !== undefined && !isNaN(costNum) ? costNum : undefined,
          sell_price: sellNum !== undefined && !isNaN(sellNum) ? sellNum : undefined,
        }
      })

      const firstSupplier = cleanedItems.find((it) => it.supplier_id)?.supplier_id

      const payload: Partial<PurchaseRequest> = {
        part_name: cleanedItems[0]?.part_name || '',
        vehicle: cleanedItems[0]?.vehicle || '',
        items: cleanedItems,
        os_number: osNumber.trim() || '',
        customer: customerId,
        supplier: firstSupplier || undefined,
        delivery_days: deliveryDays ? parseInt(deliveryDays, 10) : undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        is_completed: isCompleted,
        notes: notes.trim(),
      }

      // Se mudou de status via quick buttons, aciona movimentação
      if (status !== card.status) {
        await onMoveStatus(card.id, status)
      }

      await onUpdate(card.id, payload)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const handleQuickMove = async (targetStatus: PurchaseRequestStatus) => {
    setStatus(targetStatus)
    await onMoveStatus(card.id, targetStatus)
  }

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const supplierMap = suppliers.reduce(
    (acc, s) => {
      acc[s.id] = s.name || s.company || ''
      return acc
    },
    {} as Record<string, string>,
  )
  const headerTitle = formatPurchaseItemsSummary(card, supplierMap)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="min-w-0 flex-1 mr-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                Pipeline de Compras
              </span>
              {card.os_number && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold bg-amber-500 text-white shadow-2xs">
                  <Hash className="h-3 w-3" /> OS {card.os_number}
                </span>
              )}
              {hasLinkedQuote && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Orçamento gerado
                </span>
              )}
            </div>
            <h2
              className="text-base sm:text-lg font-bold text-slate-900 mt-1 truncate"
              title={headerTitle}
            >
              {headerTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Banner de Orçamento Vinculado ou Ação Gerar Orçamento */}
          <div className="p-4 rounded-xl border bg-gradient-to-r from-emerald-50/80 to-teal-50/50 border-emerald-200 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-700" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                    {hasLinkedQuote ? 'Orçamento Vinculado' : 'Gerar Orçamento ao Cliente'}
                  </span>
                  {hasLinkedQuote && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white">
                      <CheckCircle2 className="h-3 w-3" /> Gerado
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  {hasLinkedQuote
                    ? `Esta compra já possui orçamento (${linkedQuoteNumber || 'abrir'}). Atualize se os itens ou preços mudarem.`
                    : 'Gera um orçamento oficial com todos os itens e preços de venda para o cliente.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {hasLinkedQuote && linkedQuoteId && (
                  <>
                    <Button
                      type="button"
                      onClick={handleOpenSendQuote}
                      disabled={isLoadingQuoteData || isLoadingPaymentLinkQuote}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs"
                      title="Enviar orçamento formatado e PDF para o cliente via WhatsApp"
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {isLoadingQuoteData ? 'Carregando...' : 'ENVIAR ORÇAMENTO'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenSendPaymentLink}
                      disabled={isLoadingQuoteData || isLoadingPaymentLinkQuote}
                      className="bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-bold text-xs shadow-2xs"
                      title="Enviar link de pagamento seguro separadamente para o cliente"
                    >
                      <Share2 className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                      {isLoadingPaymentLinkQuote ? 'Carregando...' : 'ENVIAR LINK DE PAGAMENTO'}
                    </Button>

                    <Link
                      to={`/orcamentos/${linkedQuoteId}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900 shadow-2xs transition-colors"
                    >
                      <span>Abrir</span>
                      <ExternalLink className="h-3 w-3 ml-0.5" />
                    </Link>
                  </>
                )}

                <Button
                  type="button"
                  disabled={!quoteEligibility.canGenerate || isGeneratingQuote}
                  onClick={handleGenerateQuoteClick}
                  className={`font-bold text-xs shadow-xs transition-all ${
                    quoteEligibility.canGenerate
                      ? hasLinkedQuote
                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/50'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed hover:bg-slate-200'
                  }`}
                  title={
                    !quoteEligibility.canGenerate
                      ? `Não é possível gerar orçamento: ${quoteEligibility.reasons.join(', ')}`
                      : hasLinkedQuote
                        ? 'Atualizar orçamento vinculado com os itens atuais'
                        : 'Gerar novo orçamento para este cliente'
                  }
                >
                  {isGeneratingQuote ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Processando...
                    </>
                  ) : hasLinkedQuote ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      GERAR NOVAMENTE (ATUALIZAR)
                    </>
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      GERAR ORÇAMENTO
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Dica explicativa quando o botão estiver desabilitado */}
            {!quoteEligibility.canGenerate && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 bg-amber-50/90 border border-amber-200 p-2 rounded-lg">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>
                  <strong>Atenção para gerar orçamento:</strong>{' '}
                  {quoteEligibility.reasons.join(' e ')}.
                </span>
              </div>
            )}
          </div>

          {/* Status Tracker / Quick Switcher */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide block mb-2">
              Etapa Atual
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {PURCHASE_COLUMNS.map((col) => {
                const isActive = status === col.id
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => handleQuickMove(col.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold text-center border transition-all ${
                      isActive
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {col.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Campo OS (Manual) */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-amber-600" />
                Número da OS (Ordem de Serviço)
              </label>
              <span className="text-[11px] text-amber-700 font-medium">Opcional (Manual)</span>
            </div>
            <Input
              value={osNumber}
              onChange={(e) => setOsNumber(e.target.value)}
              placeholder="Ex: OS-1042, 1042..."
              className="mt-1.5 h-9 bg-white border-amber-200 text-xs font-semibold focus-visible:ring-amber-500"
            />
          </div>

          {/* Cliente Vinculado */}
          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 block">
                Cliente Vinculado <span className="text-red-500">*</span>
              </label>
              {selectedCustomer && (
                <Link
                  to={`/clientes/${selectedCustomer.id}`}
                  target="_blank"
                  className="text-[11px] text-emerald-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Ver cliente <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Selecione um cliente...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Lista de Itens (Até 20 itens, todos editáveis incluindo quantidade, fornecedor, custo e venda) */}
          <div className="space-y-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-amber-600" />
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-800">
                  Itens da Compra ({items.length} de {MAX_ITEMS})
                </h3>
              </div>
              <span className="text-[11px] text-slate-500">Mínimo 1, Máximo {MAX_ITEMS}</span>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => {
                const qtyNum = Math.max(1, Number(item.quantity) || 1)
                const costVal = parseFloat(item.cost_price || '')
                const sellVal = parseFloat(item.sell_price || '')
                const itemPurchaseObj: PurchaseItem = {
                  part_name: item.part_name,
                  vehicle: item.vehicle,
                  quantity: qtyNum,
                  cost_price: !isNaN(costVal) ? costVal : undefined,
                  sell_price: !isNaN(sellVal) ? sellVal : undefined,
                }
                const itemMargin = getItemMargin(itemPurchaseObj)

                return (
                  <div
                    key={index}
                    className="p-3 bg-white rounded-lg border border-slate-200/90 shadow-2xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <span className="h-5 w-5 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-[11px]">
                          {index + 1}
                        </span>
                        Item {index + 1}
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          className="text-slate-400 hover:text-red-600 transition-colors p-1"
                          title="Remover este item"
                          aria-label="Remover item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Linha 1: Peça, Veículo e Quantidade */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-5">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Peça <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={item.part_name}
                          onChange={(e) => handleItemChange(index, 'part_name', e.target.value)}
                          placeholder="Ex: Bucha da bandeja..."
                          required
                          className="h-8 text-xs bg-white"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Veículo <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={item.vehicle}
                          onChange={(e) => handleItemChange(index, 'vehicle', e.target.value)}
                          placeholder="Ex: Kicks 2016..."
                          required
                          className="h-8 text-xs bg-white"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Qtd <span className="text-red-500">*</span>
                        </label>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          required
                          className="h-8 text-xs font-bold text-center bg-white"
                        />
                      </div>
                    </div>

                    {/* Linha 2: Fornecedor Próprio, Custo unitário, Margem %, Venda unitária e Margem do Item */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-slate-100">
                      {/* Fornecedor Próprio */}
                      <div className="sm:col-span-3">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5 flex items-center gap-1">
                          <Truck className="h-3 w-3 text-amber-600" /> Fornecedor do item
                        </label>
                        <select
                          value={item.supplier_id || ''}
                          onChange={(e) => handleItemChange(index, 'supplier_id', e.target.value)}
                          className="w-full h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Nenhum fornecedor</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} {s.company ? `(${s.company})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Custo unitário */}
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Custo un. (R$)
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.cost_price || ''}
                          onChange={(e) => handleItemChange(index, 'cost_price', e.target.value)}
                          placeholder="0,00"
                          className="h-8 text-xs bg-white"
                        />
                      </div>

                      {/* Margem em % (ao lado do custo) */}
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Margem (%)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={item.margin_percent || ''}
                          onChange={(e) =>
                            handleItemChange(index, 'margin_percent', e.target.value)
                          }
                          placeholder="Ex: 30"
                          className="h-8 text-xs bg-white text-center font-medium"
                        />
                      </div>

                      {/* Venda unitária */}
                      <div className="sm:col-span-3">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Venda un. (R$)
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.sell_price || ''}
                          onChange={(e) => handleItemChange(index, 'sell_price', e.target.value)}
                          placeholder="0,00"
                          className="h-8 text-xs bg-white"
                        />
                      </div>

                      {/* Margem do Item em R$ (exibida em verde/vermelho) */}
                      <div className="sm:col-span-2 flex flex-col justify-end">
                        <span className="text-[10px] font-semibold text-slate-500 block mb-1">
                          Margem (R$)
                        </span>
                        <div
                          className={`h-8 px-2 rounded-md flex items-center justify-center text-xs font-bold border ${
                            itemMargin !== null
                              ? itemMargin >= 0
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-slate-50 text-slate-400 border-slate-200'
                          }`}
                          title={
                            itemMargin !== null
                              ? `Margem do item: (${qtyNum}× venda) − (${qtyNum}× custo)`
                              : 'Preencha custo e/ou venda para calcular a margem'
                          }
                        >
                          {itemMargin !== null ? formatCurrency(itemMargin) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Botão Adicionar Item (Até 20 itens) */}
            {items.length < MAX_ITEMS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
                className="w-full border-dashed border-slate-300 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar item ({items.length}/{MAX_ITEMS})
              </Button>
            )}

            {/* Rodapé da seção de itens: Total geral de todos os itens */}
            <div className="mt-3 p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-800">
                <span className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-600" /> Totais Gerais da Compra
                </span>
                <span className="text-[11px] font-normal text-slate-500 lowercase">
                  (soma de todos os itens)
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block">Total Custo:</span>
                  <strong className="text-slate-800 font-bold text-sm">
                    {formatCurrency(summaryTotals.totalCost)}
                  </strong>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block">Total Venda:</span>
                  <strong className="text-slate-900 font-bold text-sm">
                    {formatCurrency(summaryTotals.totalSell)}
                  </strong>
                </div>
                <div
                  className={`p-2.5 rounded-lg border ${
                    totalMargin >= 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  <span className="text-[11px] block flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Margem Total:
                  </span>
                  <strong className="font-bold text-sm">{formatCurrency(totalMargin)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Prazos e Datas */}
          <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-purple-600" /> Logística e Prazos
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Prazo de entrega (em dias)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={deliveryDays}
                  onChange={(e) => setDeliveryDays(e.target.value)}
                  placeholder="Ex: 3"
                  className="bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Data do recebimento
                </label>
                <Input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isCompletedCheck"
                checked={isCompleted}
                onChange={(e) => setIsCompleted(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label
                htmlFor="isCompletedCheck"
                className="text-xs font-medium text-slate-700 cursor-pointer select-none"
              >
                Marcar como concluído (peça entregue ao cliente ou em estoque)
              </label>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Observações</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anotações internas, contato do fornecedor, número do rastreio, condições de pagamento..."
              rows={3}
            />
          </div>

          {/* Metadata */}
          <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-3 space-y-1">
            <p>
              <strong>Data da solicitação:</strong> {new Date(card.created).toLocaleString('pt-BR')}
            </p>
            {card.expand?.created_by && (
              <p>
                <strong>Criado por:</strong>{' '}
                {card.expand.created_by.name || card.expand.created_by.email}
              </p>
            )}
            <p>
              <strong>Última atualização:</strong> {new Date(card.updated).toLocaleString('pt-BR')}
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-200">
            {onDelete ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm(`Tem certeza que deseja excluir a solicitação "${headerTitle}"?`)) {
                    onDelete(card.id)
                  }
                }}
                className="text-red-600 hover:bg-red-50 hover:border-red-200"
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || hasInvalidItems || !customerId}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Save className="h-4 w-4 mr-1.5" /> {isSaving ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Modal de Envio do Orçamento Vinculado ao Cliente */}
      {isSendQuoteOpen && loadedQuote && (
        <SendQuoteDialog
          isOpen={isSendQuoteOpen}
          onClose={() => setIsSendQuoteOpen(false)}
          quote={loadedQuote}
          items={loadedQuoteItems}
          customer={selectedCustomer || loadedQuote.expand?.customer}
          onSuccess={() => {
            toast({
              title: 'Orçamento enviado',
              description: 'Status atualizado para enviado.',
            })
          }}
        />
      )}

      {/* Modal de Envio de Link de Pagamento Separado */}
      {isSendPaymentLinkOpen && loadedQuote && (
        <SendPaymentLinkDialog
          isOpen={isSendPaymentLinkOpen}
          onClose={() => setIsSendPaymentLinkOpen(false)}
          quote={loadedQuote}
          customer={selectedCustomer || loadedQuote.expand?.customer}
        />
      )}
    </div>
  )
}
