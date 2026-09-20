import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, AlertCircle, Save, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { getCustomers, createCustomer } from '@/services/customers'
import { getProducts } from '@/services/products'
import {
  getQuote,
  getQuoteItems,
  createQuoteWithItems,
  updateQuoteWithItems,
} from '@/services/quotes'
import { lookupStock } from '@/services/stock'
import { Customer, Product, Quote, QuoteItem } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { SendQuoteDialog } from '@/components/Quotes/SendQuoteDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CustomerSearchCombobox } from '@/components/Quotes/CustomerSearchCombobox'
import { ProductSearchCombobox } from '@/components/Quotes/ProductSearchCombobox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

interface ItemRow {
  id?: string
  product: string
  quantity: number
  unit_price: number
  total: number
}

export default function QuoteForm() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState(searchParams.get('customerId') || '')
  const [items, setItems] = useState<ItemRow[]>([])
  const [discount, setDiscount] = useState<number>(0)
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // New Customer Modal
  const [newCustomerModal, setNewCustomerModal] = useState(false)
  const [newCustName, setNewCustomerName] = useState('')
  const [newCustPhone, setNewCustomerPhone] = useState('')

  // Modal de envio pós-salvamento
  const [sendDialogQuote, setSendDialogQuote] = useState<{
    quote: Quote
    items: QuoteItem[]
  } | null>(null)

  const isEditing = Boolean(id)

  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [allCusts, pList] = await Promise.all([getCustomers(), getProducts()])
      // Regra item 8: seleção de cliente lista APENAS Cliente/Ambos — "Ambos" deve aparecer nos DOIS filtros (Compras e Orçamento)
      const cList = allCusts.filter((c) => {
        const t = (c.customer_type || '').toLowerCase()
        return t === 'cliente' || t === 'ambos' || !t
      })
      setCustomers(cList)
      setProducts(pList)

      if (id) {
        const q = await getQuote(id)
        setSelectedCustomer(q.customer)
        setDiscount(q.discount || 0)
        setNotes(q.notes || '')

        const qItems = await getQuoteItems(id)
        setItems(
          qItems.map((qi) => ({
            id: qi.id,
            product: qi.product,
            quantity: qi.quantity,
            unit_price: qi.unit_price,
            total: qi.total,
          })),
        )
      } else {
        setItems([{ product: '', quantity: 1, unit_price: 0, total: 0 }])
      }
    } catch (e: any) {
      console.error(e)
      setLoadError(e?.message || 'Falha ao carregar dados do formulário.')
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  const handleProductChange = (index: number, productId: string) => {
    const prod = products.find((p) => p.id === productId)
    // Se sem estoque (stock_quantity <= 0 ou nulo), não pré-preencher preço (fica 0 até colaborador digitar)
    const hasStock = Boolean(prod && prod.stock_quantity && prod.stock_quantity > 0)
    const price = hasStock && prod ? prod.price : 0
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        product: productId,
        unit_price: price,
        total: price * next[index].quantity,
      }
      return next
    })
  }

  const handleQuantityChange = (index: number, qty: number) => {
    const q = Math.max(1, qty)
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        quantity: q,
        total: next[index].unit_price * q,
      }
      return next
    })
  }

  const handlePriceChange = (index: number, price: number) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        unit_price: price,
        total: price * next[index].quantity,
      }
      return next
    })
  }

  const handleAddItem = () => {
    setItems((prev) => [...prev, { product: '', quantity: 1, unit_price: 0, total: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0)
  const total = Math.max(0, subtotal - discount)

  const handleQuickCreateCustomer = async () => {
    if (!newCustName || !newCustPhone) return
    try {
      const created = await createCustomer({ name: newCustName, phone: newCustPhone })
      setCustomers((prev) => [...prev, created])
      setSelectedCustomer(created.id)
      setNewCustomerModal(false)
      setNewCustomerName('')
      setNewCustomerPhone('')
      toast({ title: 'Cliente criado com sucesso!' })
    } catch (_) {
      toast({ title: 'Erro ao criar cliente', variant: 'destructive' })
    }
  }

  const handleCheckStockInline = async (productId: string) => {
    const prod = products.find((p) => p.id === productId)
    if (!prod) return
    try {
      const res = await lookupStock(prod.sku)
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, stock_quantity: res.quantity } : p)),
      )
      toast({
        title: 'Estoque atualizado',
        description: `${prod.name}: ${res.quantity} unidades disponíveis.`,
      })
    } catch (_) {
      toast({ title: 'Erro ao consultar estoque', variant: 'destructive' })
    }
  }

  const handleSave = async (andSendWhatsApp = false) => {
    if (!selectedCustomer) {
      toast({ title: 'Selecione um cliente', variant: 'destructive' })
      return
    }
    const validItems = items.filter((i) => i.product && i.quantity > 0)
    if (validItems.length === 0) {
      toast({ title: 'Adicione pelo menos um item válido', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      let savedQuote
      const statusToSet = andSendWhatsApp ? 'enviado' : isEditing ? undefined : 'rascunho'

      if (isEditing && id) {
        savedQuote = await updateQuoteWithItems(
          id,
          {
            customer: selectedCustomer,
            subtotal,
            discount,
            total,
            notes,
            ...(statusToSet ? { status: statusToSet } : {}),
          },
          validItems,
        )
      } else {
        savedQuote = await createQuoteWithItems(
          {
            customer: selectedCustomer,
            subtotal,
            discount,
            total,
            notes,
            status: statusToSet || 'rascunho',
          },
          validItems,
        )
      }

      toast({ title: 'Orçamento salvo com sucesso!' })

      if (andSendWhatsApp) {
        const cust = customers.find((c) => c.id === selectedCustomer)
        const simulatedItems: QuoteItem[] = validItems.map((it, idx) => {
          const prodObj = products.find((p) => p.id === it.product)
          return {
            id: `temp_${idx}`,
            collectionId: 'quote_items',
            collectionName: 'quote_items',
            quote: savedQuote.id,
            product: it.product,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total: it.total,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            expand: { product: prodObj },
          } as unknown as QuoteItem
        })

        setSendDialogQuote({
          quote: { ...savedQuote, expand: { customer: cust } },
          items: simulatedItems,
        })
        return
      }

      navigate(`/orcamentos/${savedQuote.id}`)
    } catch (e) {
      toast({ title: 'Erro ao salvar orçamento', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando formulário...</div>

  if (loadError) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3 bg-white border border-red-200 rounded-xl">
        <p className="text-sm text-slate-700 font-medium">Erro ao carregar dados.</p>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Button onClick={loadData} variant="outline" size="sm">
          Tentar novamente
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          {isEditing ? 'Editar Orçamento' : 'Novo Orçamento'}
        </h1>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Cancelar
        </Button>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="font-semibold">Cliente *</Label>
            <Button
              variant="link"
              size="sm"
              className="text-emerald-600 h-auto p-0 hover:text-emerald-700"
              onClick={() => setNewCustomerModal(true)}
            >
              + Novo cliente
            </Button>
          </div>
          <CustomerSearchCombobox
            customers={customers}
            value={selectedCustomer}
            onChange={setSelectedCustomer}
            placeholder="Buscar cliente por nome, telefone ou e-mail..."
          />
        </div>

        <div className="space-y-4 border-t pt-4">
          <Label className="font-semibold text-base">Itens do Orçamento</Label>
          <div className="space-y-3">
            {items.map((item, index) => {
              const selectedProd = products.find((p) => p.id === item.product)
              const lowStock =
                selectedProd && selectedProd.stock_quantity <= (selectedProd.min_stock || 0)

              return (
                <div key={index} className="p-4 border rounded-xl bg-slate-50/50 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-5 space-y-1">
                      <Label className="text-xs font-semibold">Produto</Label>
                      <ProductSearchCombobox
                        products={products}
                        value={item.product}
                        onChange={(val) => handleProductChange(index, val)}
                        placeholder="Buscar por nome, descrição ou código/SKU..."
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <Label className="text-xs">Qtd.</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                        className="bg-white"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Preço Unit. (R$)</Label>
                        {selectedProd &&
                          (!selectedProd.stock_quantity || selectedProd.stock_quantity <= 0) &&
                          item.unit_price === 0 && (
                            <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1 rounded">
                              Sob consulta
                            </span>
                          )}
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={
                          selectedProd &&
                          (!selectedProd.stock_quantity || selectedProd.stock_quantity <= 0)
                            ? 'Sob consulta'
                            : '0.00'
                        }
                        value={
                          item.unit_price === 0 &&
                          selectedProd &&
                          (!selectedProd.stock_quantity || selectedProd.stock_quantity <= 0)
                            ? ''
                            : item.unit_price
                        }
                        onChange={(e) => handlePriceChange(index, parseFloat(e.target.value) || 0)}
                        className="bg-white"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <Label className="text-xs">Total</Label>
                      <div className="h-10 px-3 flex items-center font-bold text-slate-900 bg-white border rounded-md">
                        {formatCurrency(item.total)}
                      </div>
                    </div>

                    <div className="md:col-span-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(index)}
                        disabled={items.length <= 1}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {selectedProd && (
                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1.5">
                        Estoque disponível:{' '}
                        <strong className="text-slate-800">
                          {selectedProd.stock_quantity} un.
                        </strong>
                        {selectedProd.stock_quantity <= 0 && (
                          <span className="text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" /> Sem estoque
                          </span>
                        )}
                        {selectedProd.stock_quantity > 0 &&
                          selectedProd.stock_quantity < item.quantity && (
                            <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <AlertCircle className="h-3.5 w-3.5" /> Insuficiente para pedido
                            </span>
                          )}
                        {lowStock && selectedProd.stock_quantity >= item.quantity && (
                          <span className="text-amber-600 font-semibold flex items-center gap-0.5">
                            <AlertCircle className="h-3.5 w-3.5" /> Estoque baixo
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {selectedProd.stock_quantity < item.quantity && (
                          <span className="text-[11px] text-amber-700 italic">
                            Card no Pipeline de Compras poderá ser gerado após salvar
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCheckStockInline(selectedProd.id)}
                          className="h-6 text-[11px] text-emerald-600 hover:bg-emerald-50 px-2"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" /> Consultar API
                        </Button>
                      </div>
                    </div>
                  )}{' '}
                </div>
              )
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleAddItem}
            className="w-full border-dashed"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar Outro Item
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t pt-4">
          <div className="space-y-2">
            <Label>Observações do Orçamento</Label>
            <Textarea
              placeholder="Condições de pagamento, prazos de entrega..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label className="text-sm text-slate-600">Desconto (R$):</Label>
              <Input
                type="number"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                className="w-32 bg-white text-right"
              />
            </div>

            <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-lg font-bold text-slate-900">
              <span>Total Final:</span>
              <span className="text-emerald-600">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-3 border-t pt-4">
          <Button variant="outline" disabled={saving} onClick={() => handleSave(false)}>
            <Save className="mr-1.5 h-4 w-4" /> Salvar Rascunho
          </Button>
          <Button
            disabled={saving}
            onClick={() => handleSave(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            <MessageCircle className="mr-1.5 h-4 w-4" /> Salvar e Enviar WhatsApp
          </Button>
        </div>
      </div>

      {/* Diálogo de Envio pós-salvamento */}
      {sendDialogQuote && (
        <SendQuoteDialog
          isOpen={Boolean(sendDialogQuote)}
          onClose={() => {
            const qId = sendDialogQuote.quote.id
            setSendDialogQuote(null)
            navigate(`/orcamentos/${qId}`)
          }}
          quote={sendDialogQuote.quote}
          items={sendDialogQuote.items}
          customer={customers.find((c) => c.id === selectedCustomer)}
          onSuccess={() => {
            const qId = sendDialogQuote.quote.id
            setSendDialogQuote(null)
            navigate(`/orcamentos/${qId}`)
          }}
        />
      )}

      <Dialog open={newCustomerModal} onOpenChange={setNewCustomerModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Cliente Rápido</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome Completo *</Label>
              <Input
                value={newCustName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder="Ex: João Souza"
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp / Telefone *</Label>
              <Input
                value={newCustPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                placeholder="(11) 98765-4321"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleQuickCreateCustomer}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Criar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
