import { useState, useMemo, useEffect } from 'react'
import {
  Search,
  Plus,
  Trash2,
  Send,
  Mail,
  CreditCard,
  Copy,
  Check,
  Package,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  X,
  FileCheck2,
} from 'lucide-react'
import { Product, Customer } from '@/types/crm'
import { matchProductSearch } from '@/lib/fuzzySearch'
import { getProducts } from '@/services/products'
import { createQuoteWithItems, sendWhatsAppMessage, sendQuoteEmail } from '@/services/quotes'
import { createPurchaseFromQuoteItems } from '@/services/purchaseRequestsService'
import { ShoppingBag } from 'lucide-react'
import { lookupStock } from '@/services/stock'
import { formatCurrency, buildDetailedQuoteMessage, openWhatsApp } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export interface SelectedQuoteItem {
  product: Product
  quantity: number
  unitPrice: number
  total: number
}

interface ProductQuoteModalProps {
  isOpen: boolean
  onClose: () => void
  customer: {
    id?: string
    name: string
    phone: string
    email?: string
    company?: string
  }
  onQuoteSent?: (quoteNumber: string, quoteId: string) => void
}

export function ProductQuoteModal({
  isOpen,
  onClose,
  customer,
  onQuoteSent,
}: ProductQuoteModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('todas')
  const [selectedItems, setSelectedItems] = useState<SelectedQuoteItem[]>([])
  const [discount, setDiscount] = useState<number>(0)
  const [notes, setNotes] = useState<string>('')

  // Ações de envio
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailTo, setEmailTo] = useState(customer.email || '')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailFallbackWarning, setEmailFallbackWarning] = useState<string | null>(null)

  // Link de pagamento gerado
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [generatedQuoteNumber, setGeneratedQuoteNumber] = useState<string | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [creatingPurchase, setCreatingPurchase] = useState(false)

  // Carregar produtos quando o modal abre
  useEffect(() => {
    if (isOpen) {
      loadProductsList()
      setEmailTo(customer.email || '')
    }
  }, [isOpen, customer.email])

  const loadProductsList = async () => {
    setLoadingProducts(true)
    try {
      const data = await getProducts()
      setProducts(data)
    } catch (err) {
      console.error('Erro ao carregar produtos:', err)
      toast({
        title: 'Erro ao carregar estoque',
        description: 'Não foi possível buscar a lista de produtos.',
        variant: 'destructive',
      })
    } finally {
      setLoadingProducts(false)
    }
  }

  // Categorias únicas baseadas no SKU ou descrição
  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => {
      // Se tiver prefixo no SKU (ex: NOTE, MON, TEC, MOU, CAD, FREIO, MOTOR)
      const prefix = p.sku.split('-')[0]?.toUpperCase()
      if (prefix) set.add(prefix)
    })
    return Array.from(set)
  }, [products])

  // Filtragem rápida com busca tolerante
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim()
    return products.filter((p) => {
      if (categoryFilter !== 'todas') {
        const prefix = p.sku.split('-')[0]?.toUpperCase()
        if (prefix !== categoryFilter) return false
      }
      if (!q) return true
      return matchProductSearch(p, q)
    })
  }, [products, searchQuery, categoryFilter])

  // Adicionar produto ao orçamento
  const handleAddProduct = (prod: Product) => {
    const hasStock = Boolean(prod.stock_quantity && prod.stock_quantity > 0)
    const initialUnitPrice = hasStock ? prod.price : 0

    setSelectedItems((prev) => {
      const existing = prev.find((item) => item.product.id === prod.id)
      if (existing) {
        return prev.map((item) => {
          if (item.product.id === prod.id) {
            const nextQty = item.quantity + 1
            return {
              ...item,
              quantity: nextQty,
              total: nextQty * item.unitPrice,
            }
          }
          return item
        })
      }
      return [
        ...prev,
        {
          product: prod,
          quantity: 1,
          unitPrice: initialUnitPrice,
          total: initialUnitPrice,
        },
      ]
    })
  }

  // Atualizar quantidade
  const handleUpdateQuantity = (productId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(productId)
      return
    }
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          return {
            ...item,
            quantity: newQty,
            total: newQty * item.unitPrice,
          }
        }
        return item
      }),
    )
  }

  // Atualizar preço unitário
  const handleUpdatePrice = (productId: string, newPrice: number) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          const p = Math.max(0, newPrice)
          return {
            ...item,
            unitPrice: p,
            total: item.quantity * p,
          }
        }
        return item
      }),
    )
  }

  // Remover item
  const handleRemoveItem = (productId: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.product.id !== productId))
  }

  // Limpar itens
  const handleClearItems = () => {
    setSelectedItems([])
    setDiscount(0)
    setNotes('')
  }

  // Cálculos de totais
  const subtotal = useMemo(() => {
    return selectedItems.reduce((acc, item) => acc + item.total, 0)
  }, [selectedItems])

  const total = useMemo(() => {
    return Math.max(0, subtotal - (discount || 0))
  }, [subtotal, discount])

  // Checagem em tempo real de estoque na API externa
  const handleCheckStock = async (prod: Product) => {
    try {
      const res = await lookupStock(prod.sku)
      setProducts((prev) =>
        prev.map((p) => (p.id === prod.id ? { ...p, stock_quantity: res.quantity } : p)),
      )
      toast({
        title: 'Estoque atualizado',
        description: `${prod.name}: ${res.quantity} unidades disponíveis.`,
      })
    } catch (_) {
      toast({
        title: 'Falha na consulta',
        description: 'Não foi possível obter dados ao vivo da API.',
        variant: 'destructive',
      })
    }
  }

  // Criar card de compra no Pipeline de Compras para itens sem estoque selecionados
  const handleCreatePurchaseForOutOfStock = async () => {
    const missing = selectedItems.filter(
      (it) => it.product.stock_quantity <= 0 || it.product.stock_quantity < it.quantity,
    )
    if (missing.length === 0) {
      toast({
        title: 'Estoque disponível',
        description: 'Todos os itens selecionados possuem estoque suficiente.',
      })
      return
    }

    if (!customer.id) {
      toast({
        title: 'Cliente necessário',
        description: 'Vincule o cliente antes de criar compra.',
        variant: 'destructive',
      })
      return
    }

    setCreatingPurchase(true)
    try {
      // 1. Salva o orçamento primeiro para vincular
      const savedQuote = await persistQuoteRecord('rascunho')

      // 2. Cria a solicitação no Pipeline de Compras vinculando quote e customer
      const itemsPayload = missing.map((it) => ({
        part_name: it.product.name,
        vehicle: '',
        quantity: it.quantity,
        unit_price: it.unitPrice,
        cost_price: it.product.cost,
      }))

      const res = await createPurchaseFromQuoteItems({
        quoteId: savedQuote.id,
        customerId: customer.id,
        items: itemsPayload,
        notes: `Itens sem estoque cotados para ${customer.name}`,
      })

      if (res.isExisting) {
        toast({
          title: 'Compra já existente',
          description: `Já existe um card de compra vinculado a este orçamento.`,
        })
      } else {
        toast({
          title: 'Card no Pipeline de Compras criado!',
          description: `${itemsPayload.length} item(ns) sem estoque enviados para cotação no Pipeline de Compras.`,
        })
      }
    } catch (err: any) {
      console.error('Erro ao gerar compra para itens sem estoque:', err)
      toast({
        title: 'Erro ao gerar compra',
        description: err.message || 'Falha ao processar solicitação de compras.',
        variant: 'destructive',
      })
    } finally {
      setCreatingPurchase(false)
    }
  }

  // 1. Salvar ou Criar Orçamento no PocketBase
  const persistQuoteRecord = async (status: 'enviado' | 'rascunho') => {
    if (!customer.id) {
      throw new Error('Cliente não identificado no banco de dados. Cadastre o cliente primeiro.')
    }
    if (selectedItems.length === 0) {
      throw new Error('Selecione pelo menos um produto do estoque.')
    }

    const itemsPayload = selectedItems.map((it) => ({
      product: it.product.id,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      total: it.total,
    }))

    const quoteRec = await createQuoteWithItems(
      {
        customer: customer.id,
        subtotal,
        discount: discount || 0,
        total,
        notes,
        status,
      },
      itemsPayload,
    )

    return quoteRec
  }

  // Ação: Enviar pelo WhatsApp
  const handleSendViaWhatsApp = async () => {
    if (selectedItems.length === 0) {
      toast({
        title: 'Adicione itens',
        description: 'Selecione pelo menos um item para montar o orçamento.',
        variant: 'destructive',
      })
      return
    }

    setSendingWhatsApp(true)
    try {
      // 1. Salva o orçamento no banco com status 'enviado'
      const savedQuote = await persistQuoteRecord('enviado')

      // 2. Monta o link de pagamento do projeto
      const paymentLink = `${window.location.origin}/pagamento/${savedQuote.id}?token=${savedQuote.payment_token}`

      // 3. Monta o texto detalhado formatado para o WhatsApp
      const itemsListForMsg = selectedItems.map((it) => ({
        name: it.product.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
      }))

      const messageText = buildDetailedQuoteMessage(
        savedQuote.number,
        customer.name,
        itemsListForMsg,
        subtotal,
        discount || 0,
        total,
        paymentLink,
      )

      // 4. Envia via Z-API usando o hook de backend
      let sentSuccess = false
      try {
        const sendRes = await sendWhatsAppMessage(customer.phone, messageText)
        if (sendRes.ok && sendRes.zapiSuccess) {
          sentSuccess = true
          toast({
            title: 'Orçamento enviado!',
            description: `Enviado com sucesso pelo WhatsApp da RPA Auto Parts (${savedQuote.number}).`,
          })
        } else {
          // Z-API falhou ou não conectada, fallback com aviso
          const errMsg = sendRes.zapiError || 'Instância Z-API desconectada'
          console.warn('Z-API send error:', errMsg)
          openWhatsApp(customer.phone, messageText)
          toast({
            title: 'Orçamento gerado e salvo',
            description: `Orçamento ${savedQuote.number} salvo. Aberto no WhatsApp Web (${errMsg}).`,
          })
        }
      } catch (err: any) {
        console.warn('Erro ao chamar backend de envio:', err)
        openWhatsApp(customer.phone, messageText)
        toast({
          title: 'Orçamento salvo',
          description: `Orçamento ${savedQuote.number} salvo com sucesso e aberto no WhatsApp.`,
        })
      }

      onQuoteSent?.(savedQuote.number, savedQuote.id)
      handleClearItems()
      onClose()
    } catch (err: any) {
      toast({
        title: 'Erro ao enviar orçamento',
        description: err.message || 'Falha ao processar orçamento.',
        variant: 'destructive',
      })
    } finally {
      setSendingWhatsApp(false)
    }
  }

  // Ação: Abrir modal de Enviar por E-mail
  const handleOpenEmailDialog = () => {
    if (selectedItems.length === 0) {
      toast({
        title: 'Adicione itens',
        description: 'Selecione produtos para montar o orçamento.',
        variant: 'destructive',
      })
      return
    }
    setEmailFallbackWarning(null)
    setEmailTo(customer.email || '')
    setEmailModalOpen(true)
  }

  // Confirmar Envio por E-mail
  const handleConfirmSendEmail = async () => {
    if (!emailTo || !emailTo.includes('@')) {
      toast({
        title: 'E-mail inválido',
        description: 'Informe um endereço de e-mail válido.',
        variant: 'destructive',
      })
      return
    }

    setSendingEmail(true)
    setEmailFallbackWarning(null)
    try {
      // 1. Salva o orçamento com status 'enviado'
      const savedQuote = await persistQuoteRecord('enviado')
      const paymentLink = `${window.location.origin}/pagamento/${savedQuote.id}?token=${savedQuote.payment_token}`

      // 2. Monta o corpo do texto
      const itemsListForMsg = selectedItems.map((it) => ({
        name: it.product.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
      }))

      const messageText = buildDetailedQuoteMessage(
        savedQuote.number,
        customer.name,
        itemsListForMsg,
        subtotal,
        discount || 0,
        total,
        paymentLink,
      )

      const subject = `Orçamento ${savedQuote.number} - RPA Auto Parts`

      // 3. Tenta enviar via servidor PocketBase
      const emailRes = await sendQuoteEmail(savedQuote.id, emailTo, subject, messageText)

      if (emailRes.ok && emailRes.sent) {
        toast({
          title: 'E-mail enviado com sucesso!',
          description: `Orçamento ${savedQuote.number} enviado para ${emailTo}.`,
        })
        setEmailModalOpen(false)
        onQuoteSent?.(savedQuote.number, savedQuote.id)
        handleClearItems()
        onClose()
      } else {
        // Fallback honesto: SMTP não configurado
        setEmailFallbackWarning(
          'O servidor de e-mail (SMTP) do sistema não está configurado. Preparamos o e-mail no seu cliente padrão.',
        )
        const mailtoUrl = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
          subject,
        )}&body=${encodeURIComponent(messageText)}`
        window.open(mailtoUrl, '_blank')
        toast({
          title: 'Orçamento gravado no sistema',
          description: `Orçamento ${savedQuote.number} registrado com status 'Enviado'.`,
        })
        onQuoteSent?.(savedQuote.number, savedQuote.id)
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao gerar orçamento',
        description: err.message || 'Falha ao salvar dados.',
        variant: 'destructive',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  // Ação: Gerar Link de Pagamento com valor total
  const handleGeneratePaymentLink = async () => {
    if (selectedItems.length === 0) {
      toast({
        title: 'Adicione itens',
        description: 'Selecione produtos para gerar o link.',
        variant: 'destructive',
      })
      return
    }

    setGeneratingLink(true)
    try {
      // 1. Salva orçamento no banco com status 'enviado' (ou aprovado dependendo do fluxo)
      const savedQuote = await persistQuoteRecord('enviado')
      const paymentLink = `${window.location.origin}/pagamento/${savedQuote.id}?token=${savedQuote.payment_token}`

      setGeneratedLink(paymentLink)
      setGeneratedQuoteNumber(savedQuote.number)
      setLinkModalOpen(true)
      onQuoteSent?.(savedQuote.number, savedQuote.id)
    } catch (err: any) {
      toast({
        title: 'Erro ao gerar link',
        description: err.message || 'Falha ao registrar orçamento.',
        variant: 'destructive',
      })
    } finally {
      setGeneratingLink(false)
    }
  }

  const handleCopyLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink)
      setCopiedLink(true)
      toast({ title: 'Link de pagamento copiado!' })
      setTimeout(() => setCopiedLink(false), 2000)
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-5xl w-[96vw] max-h-[92vh] flex flex-col p-0 overflow-hidden bg-slate-50/50">
          {/* Topo do Modal */}
          <div className="p-4 sm:p-5 bg-white border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div className="truncate">
                <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span>Buscar Produtos & Montar Orçamento</span>
                </DialogTitle>
                <p className="text-xs text-slate-500 truncate">
                  Cliente vinculado: <strong className="text-slate-800">{customer.name}</strong> •{' '}
                  <span>{customer.phone}</span>
                  {customer.company && <span> ({customer.company})</span>}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Conteúdo em 2 colunas: Esquerda = Catálogo Estoque | Direita = Orçamento Montado */}
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* COLUNA ESQUERDA: Busca de Produtos no Estoque (7 cols) */}
            <div className="lg:col-span-7 flex flex-col min-h-0 bg-white">
              {/* Barra de Filtros e Busca */}
              <div className="p-3.5 border-b border-slate-200 space-y-2.5 bg-slate-50/40">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar produto por nome, código SKU ou especificação..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-xs bg-white border-slate-200 focus:ring-emerald-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {/* Filtros de Categoria */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <span className="text-slate-400 text-[11px] font-medium mr-1 shrink-0">
                    Categoria:
                  </span>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('todas')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                      categoryFilter === 'todas'
                        ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Todas ({products.length})
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                        categoryFilter === cat
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista de Produtos do Estoque */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-slate-100">
                {loadingProducts ? (
                  <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin text-emerald-600" />
                    <span>Carregando produtos do estoque...</span>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Nenhum produto encontrado no estoque com esse critério.
                  </div>
                ) : (
                  filteredProducts.map((prod) => {
                    const isOutOfStock = prod.stock_quantity <= 0
                    const isLowStock = !isOutOfStock && prod.stock_quantity <= (prod.min_stock || 2)
                    const isAlreadySelected = selectedItems.some((i) => i.product.id === prod.id)

                    return (
                      <div
                        key={prod.id}
                        className="pt-2 pb-2 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-lg transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm truncate">
                              {prod.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] px-1.5 py-0 bg-slate-100 text-slate-700 border-slate-200"
                            >
                              SKU: {prod.sku}
                            </Badge>
                          </div>

                          {prod.description && (
                            <p className="text-xs text-slate-500 truncate mt-0.5">
                              {prod.description}
                            </p>
                          )}

                          <div className="flex items-center gap-3 mt-1 text-xs">
                            {isOutOfStock ? (
                              <span className="font-bold text-amber-700 text-xs bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Sob consulta
                              </span>
                            ) : (
                              <span className="font-extrabold text-emerald-700 text-sm">
                                {formatCurrency(prod.price)}
                              </span>
                            )}

                            <span
                              className={`text-[11px] font-medium px-1.5 py-0.2 rounded ${
                                isOutOfStock
                                  ? 'bg-rose-100 text-rose-700'
                                  : isLowStock
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              Estoque: {prod.stock_quantity} un.
                            </span>

                            <button
                              type="button"
                              onClick={() => handleCheckStock(prod)}
                              className="text-[11px] text-slate-400 hover:text-emerald-700 flex items-center gap-0.5 transition-colors"
                              title="Consultar estoque atualizado"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Atualizar
                            </button>
                          </div>
                        </div>

                        {/* Botão de Adicionar */}
                        <div className="shrink-0 flex items-center gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleAddProduct(prod)}
                            className={`h-8 px-3 text-xs font-semibold ${
                              isAlreadySelected
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-slate-900 hover:bg-slate-800 text-white'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            {isAlreadySelected ? 'Adicionar +' : 'Selecionar'}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* COLUNA DIREITA: Orçamento em Montagem (5 cols) */}
            <div className="lg:col-span-5 flex flex-col min-h-0 bg-slate-50/70">
              {/* Header do Orçamento */}
              <div className="p-3.5 bg-white border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-emerald-600" />
                    Itens do Orçamento
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'itens'}{' '}
                    selecionado(s)
                  </p>
                </div>
                {selectedItems.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {selectedItems.some(
                      (it) =>
                        it.product.stock_quantity <= 0 || it.product.stock_quantity < it.quantity,
                    ) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={creatingPurchase}
                        onClick={handleCreatePurchaseForOutOfStock}
                        className="h-7 text-[11px] border-amber-300 text-amber-900 hover:bg-amber-50 px-2"
                        title="Criar card no Pipeline de Compras para itens sem estoque"
                      >
                        <ShoppingBag className="w-3 h-3 mr-1 text-amber-700" />
                        {creatingPurchase ? 'Criando...' : 'Comprar itens sem estoque'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearItems}
                      className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2"
                    >
                      Limpar tudo
                    </Button>
                  </div>
                )}
              </div>

              {/* Lista de Itens Selecionados com Quantidade e Subtotal */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {selectedItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-2">
                    <Package className="w-10 h-10 stroke-[1.5] text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">
                      Nenhum produto selecionado
                    </p>
                    <p className="text-[11px] text-slate-400 max-w-xs">
                      Clique em <strong>"Selecionar"</strong> na lista de produtos ao lado para
                      montar a proposta do cliente.
                    </p>
                  </div>
                ) : (
                  selectedItems.map((item) => (
                    <div
                      key={item.product.id}
                      className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-xs truncate">
                            {item.product.name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            SKU: {item.product.sku}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.product.id)}
                          className="text-slate-400 hover:text-rose-600 p-0.5"
                          title="Remover item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Controles de Quantidade, Preço Unitário e Subtotal */}
                      <div className="grid grid-cols-12 gap-2 items-center text-xs">
                        {/* Qtd */}
                        <div className="col-span-4">
                          <Label className="text-[10px] text-slate-500">Qtd.</Label>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateQuantity(item.product.id, item.quantity - 1)
                              }
                              className="w-6 h-7 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700 font-bold"
                            >
                              -
                            </button>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                handleUpdateQuantity(item.product.id, parseInt(e.target.value) || 1)
                              }
                              className="h-7 text-center text-xs px-1 font-semibold"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateQuantity(item.product.id, item.quantity + 1)
                              }
                              className="w-6 h-7 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700 font-bold"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Preço Unitário */}
                        <div className="col-span-4">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] text-slate-500">Unitário (R$)</Label>
                            {(!item.product.stock_quantity || item.product.stock_quantity <= 0) &&
                              item.unitPrice === 0 && (
                                <span className="text-[9px] text-amber-700 font-bold bg-amber-50 px-1 rounded">
                                  Sob consulta
                                </span>
                              )}
                          </div>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={
                              !item.product.stock_quantity || item.product.stock_quantity <= 0
                                ? 'Sob consulta'
                                : '0.00'
                            }
                            value={
                              item.unitPrice === 0 &&
                              (!item.product.stock_quantity || item.product.stock_quantity <= 0)
                                ? ''
                                : item.unitPrice
                            }
                            onChange={(e) =>
                              handleUpdatePrice(item.product.id, parseFloat(e.target.value) || 0)
                            }
                            className="h-7 text-xs px-2 text-right mt-0.5"
                          />
                        </div>

                        {/* Subtotal do Item */}
                        <div className="col-span-4 text-right">
                          <Label className="text-[10px] text-slate-500">Subtotal</Label>
                          <p className="font-extrabold text-slate-900 text-xs mt-1 truncate">
                            {formatCurrency(item.total)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Resumo Financeiro & Desconto */}
              <div className="p-3 bg-white border-t border-slate-200 space-y-2.5">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal dos Itens:</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Desconto Comercial:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs">- R$</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={discount || ''}
                        onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                        className="h-7 w-24 text-right text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-sm font-extrabold text-slate-900 border-t pt-2">
                    <span>Total Geral:</span>
                    <span className="text-base font-extrabold text-emerald-600">
                      {formatCurrency(total)}
                    </span>
                  </div>
                </div>

                {/* Observações opcionais */}
                <Textarea
                  placeholder="Observações (ex: garantia de 6 meses, entrega via motoboy...)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="text-xs bg-slate-50 resize-none"
                />

                {/* 3 Botões Principais de Ação Conforme Requisitos */}
                <div className="space-y-1.5 pt-1">
                  <Button
                    onClick={handleSendViaWhatsApp}
                    disabled={selectedItems.length === 0 || sendingWhatsApp}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 text-xs shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {sendingWhatsApp ? 'Enviando WhatsApp...' : 'Enviar pelo WhatsApp'}
                  </Button>

                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      variant="outline"
                      onClick={handleOpenEmailDialog}
                      disabled={selectedItems.length === 0 || sendingEmail}
                      className="text-xs text-slate-700 h-8"
                    >
                      <Mail className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                      Enviar por E-mail
                    </Button>

                    <Button
                      variant="outline"
                      onClick={handleGeneratePaymentLink}
                      disabled={selectedItems.length === 0 || generatingLink}
                      className="text-xs text-slate-700 h-8 border-emerald-200 hover:bg-emerald-50"
                    >
                      <CreditCard className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                      Link Pagamento
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL 1: Confirmar Envio por E-mail */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Mail className="w-5 h-5 text-emerald-600" />
              Confirmar Envio por E-mail
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <p className="text-xs text-slate-500">
              O orçamento no valor de <strong>{formatCurrency(total)}</strong> com{' '}
              <strong>{selectedItems.length} item(ns)</strong> será enviado para o endereço abaixo:
            </p>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">E-mail do Cliente *</Label>
              <Input
                type="email"
                placeholder="cliente@exemplo.com.br"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="text-sm"
              />
            </div>

            {emailFallbackWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{emailFallbackWarning}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmailModalOpen(false)}
              disabled={sendingEmail}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmSendEmail}
              disabled={sendingEmail || !emailTo}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {sendingEmail ? 'Enviando...' : 'Enviar Agora'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: Link de Pagamento Gerado com Sucesso */}
      <Dialog open={linkModalOpen} onOpenChange={setLinkModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <CreditCard className="w-5 h-5 text-emerald-600" />
              Link de Pagamento Gerado
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
              <p className="font-bold">
                Orçamento {generatedQuoteNumber} registrado com status 'Enviado'.
              </p>
              <p>
                O cliente pode efetuar o pagamento seguro via <strong>PIX</strong> ou{' '}
                <strong>Cartão de Crédito</strong> pelo link abaixo:
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Link de Checkout:</Label>
              <Input
                value={generatedLink || ''}
                readOnly
                className="text-xs font-mono bg-slate-50 select-all"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
              <span>Valor Total da Cobrança:</span>
              <strong className="text-emerald-700 text-sm">{formatCurrency(total)}</strong>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="w-full sm:w-auto text-xs"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5 mr-1" />
              )}
              {copiedLink ? 'Copiado!' : 'Copiar Link'}
            </Button>

            <Button
              size="sm"
              onClick={() => {
                if (generatedLink) {
                  openWhatsApp(
                    customer.phone,
                    `Olá! Segue o link de pagamento do orçamento *${generatedQuoteNumber}* no valor de *${formatCurrency(
                      total,
                    )}*:\n\n${generatedLink}`,
                  )
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              Enviar pelo WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
