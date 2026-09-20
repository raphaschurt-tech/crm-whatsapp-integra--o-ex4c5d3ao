import React, { useState } from 'react'
import { Plus, Trash2, TrendingUp, Hash, Layers, DollarSign, Truck } from 'lucide-react'
import {
  Customer,
  Product,
  PurchaseItem,
  PurchaseRequest,
  PurchaseRequestStatus,
  ItemFamily,
} from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  getItemMargin,
  calculateMarginPercent,
  calculateSellPriceFromMargin,
} from '@/services/purchaseRequestsService'
import { ProductSearchCombobox } from '@/components/Quotes/ProductSearchCombobox'
import { SupplierSearchCombobox } from '@/components/Quotes/SupplierSearchCombobox'
import { getProducts } from '@/services/products'
import { getFamilies } from '@/services/families'

interface NewPurchaseModalProps {
  isOpen: boolean
  onClose: () => void
  customers: Customer[]
  suppliers: Customer[]
  products?: Product[]
  families?: ItemFamily[]
  onSubmit: (data: Partial<PurchaseRequest>) => Promise<void>
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

const emptyItem: FormItemState = {
  part_name: '',
  vehicle: '',
  quantity: 1,
  supplier_id: '',
  cost_price: '',
  margin_percent: '',
  sell_price: '',
}

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  isOpen,
  onClose,
  customers,
  suppliers,
  products: initialProducts,
  families: initialFamilies,
  onSubmit,
}) => {
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(initialProducts || [])
  const [itemFamilies, setItemFamilies] = useState<ItemFamily[]>(initialFamilies || [])
  const [items, setItems] = useState<FormItemState[]>([{ ...emptyItem }])
  const [osNumber, setOsNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [status, setStatus] = useState<PurchaseRequestStatus>('solicitada')
  const [deliveryDays, setDeliveryDays] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  React.useEffect(() => {
    if (initialProducts && initialProducts.length > 0) {
      setCatalogProducts(initialProducts)
      return
    }
    let isMounted = true
    getProducts()
      .then((prods) => {
        if (isMounted) setCatalogProducts(prods)
      })
      .catch((err) => {
        console.warn('Erro ao carregar catálogo no NewPurchaseModal:', err)
      })
    return () => {
      isMounted = false
    }
  }, [initialProducts])

  React.useEffect(() => {
    if (initialFamilies && initialFamilies.length > 0) {
      setItemFamilies(initialFamilies)
      return
    }
    let isMounted = true
    getFamilies()
      .then((fams) => {
        if (isMounted) setItemFamilies(fams)
      })
      .catch((err) => {
        console.warn('Erro ao carregar famílias no NewPurchaseModal:', err)
      })
    return () => {
      isMounted = false
    }
  }, [initialFamilies])

  const formatPercentDisplay = (val: number): string => {
    const rounded = Math.round(val * 100) / 100
    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2).replace(/\.?0+$/, '')
  }

  // Retorna os IDs dos fornecedores que fornecem as famílias deste produto
  const getSuggestedSupplierIdsForProduct = (product: Product | null | undefined): string[] => {
    if (!product) return []
    // 1. Encontra quais famílias contêm este produto
    const productFamilyIds = new Set<string>()
    for (const fam of itemFamilies) {
      const pList = fam.products || []
      if (pList.includes(product.id)) {
        productFamilyIds.add(fam.id)
      }
    }

    if (productFamilyIds.size === 0) return []

    // 2. Encontra fornecedores cadastrados que têm alguma dessas famílias em item_families
    const matchedSuppliers: Customer[] = []
    for (const sup of suppliers) {
      const supFams = sup.item_families || []
      const hasMatch = supFams.some((fId) => productFamilyIds.has(fId))
      if (hasMatch) {
        matchedSuppliers.push(sup)
      }
    }

    return matchedSuppliers.map((s) => s.id)
  }

  const handleSelectProductForItem = (index: number, product: Product | null) => {
    setItems((prev) => {
      const next = [...prev]
      const currentItem = { ...next[index] }

      if (!product) {
        currentItem.part_name = ''
        next[index] = currentItem
        return next
      }

      currentItem.part_name = product.name

      // Se o item ainda não tem custo unitário e o produto tem custo ou preço, sugere o custo
      if (!currentItem.cost_price) {
        const prodCost =
          typeof product.cost === 'number' && product.cost > 0
            ? product.cost
            : typeof product.price === 'number' && product.price > 0
              ? product.price
              : undefined

        if (prodCost !== undefined) {
          currentItem.cost_price = String(prodCost)

          // Se já tem margem % definida, recalcula venda
          const marginNum = parseFloat(currentItem.margin_percent || '')
          if (!isNaN(marginNum)) {
            const calculatedSell = calculateSellPriceFromMargin(prodCost, marginNum)
            if (calculatedSell !== null) {
              currentItem.sell_price = calculatedSell.toFixed(2)
            }
          } else if (currentItem.sell_price) {
            // Se já tem preço de venda, calcula margem
            const sellNum = parseFloat(currentItem.sell_price)
            if (!isNaN(sellNum)) {
              const recalculatedMargin = calculateMarginPercent(prodCost, sellNum)
              currentItem.margin_percent =
                recalculatedMargin !== null ? formatPercentDisplay(recalculatedMargin) : ''
            }
          }
        }
      }

      // Pré-preenchimento do fornecedor do item quando houver correspondência
      // Prioridade 1: fornecedor do campo product.supplier (ex.: "SOU.IS" ou outro)
      if (product.supplier) {
        const matchedSup = suppliers.find(
          (s) =>
            s.name.trim().toLowerCase() === product.supplier?.trim().toLowerCase() ||
            (s.company &&
              s.company.trim().toLowerCase() === product.supplier?.trim().toLowerCase()),
        )
        if (matchedSup) {
          currentItem.supplier_id = matchedSup.id
        }
      }

      // Prioridade 2: se ainda não preencheu e houver fornecedores sugeridos pela família,
      // se houver o fornecedor SOU.IS entre eles ou exatamente um fornecedor da família, pré-preenche
      if (!currentItem.supplier_id) {
        const suggestedIds = getSuggestedSupplierIdsForProduct(product)
        if (suggestedIds.length > 0) {
          const souisSup = suppliers.find(
            (s) =>
              suggestedIds.includes(s.id) &&
              (s.name.trim().toUpperCase() === 'SOU.IS' ||
                s.company?.trim().toUpperCase() === 'SOU.IS' ||
                s.source === 'erp'),
          )
          if (souisSup) {
            currentItem.supplier_id = souisSup.id
          } else if (suggestedIds.length === 1) {
            currentItem.supplier_id = suggestedIds[0]
          }
        }
      }

      next[index] = currentItem
      return next
    })
  }

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
          // Quando custo for vazio ou zero, ou margem vazia/inválida, não altera a venda compulsoriamente se margem vazia
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
    setItems((prev) => [...prev, { ...emptyItem }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const resetForm = () => {
    setItems([{ ...emptyItem }])
    setOsNumber('')
    setCustomerId('')
    setStatus('solicitada')
    setDeliveryDays('')
    setNotes('')
  }

  const hasInvalidItems = items.some(
    (item) => !item.part_name.trim() || !item.vehicle.trim() || (item.quantity || 1) < 1,
  )

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasInvalidItems || !customerId) return

    setIsSubmitting(true)
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

      // O fornecedor global pode ser o do 1º item se houver, ou undefined
      const firstSupplier = cleanedItems.find((it) => it.supplier_id)?.supplier_id

      await onSubmit({
        part_name: cleanedItems[0]?.part_name || '',
        vehicle: cleanedItems[0]?.vehicle || '',
        items: cleanedItems,
        os_number: osNumber.trim() || undefined,
        customer: customerId,
        supplier: firstSupplier || undefined,
        status,
        delivery_days: deliveryDays ? parseInt(deliveryDays, 10) : undefined,
        notes: notes.trim(),
      })
      resetForm()
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
              <Plus className="h-4 w-4" />
            </span>
            Nova Solicitação de Compra
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Campo OS (Opcional, digitado manualmente) */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-amber-600" />
                Número da OS (Ordem de Serviço)
              </label>
              <span className="text-[11px] text-amber-700 font-medium">Opcional</span>
            </div>
            <Input
              value={osNumber}
              onChange={(e) => setOsNumber(e.target.value)}
              placeholder="Ex: OS-1042, 1042..."
              className="mt-1.5 h-9 bg-white border-amber-200 text-xs font-semibold focus-visible:ring-amber-500"
            />
            <p className="text-[11px] text-amber-700/80 mt-1">
              Digitada manualmente. Aparecerá em destaque com badge no card kanban.
            </p>
          </div>

          {/* Cliente (Obrigatório) */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Cliente <span className="text-red-500">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Selecione o cliente que pediu a peça...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Seção de Itens (Até 20 itens com Peça, Veículo, Qtd, Fornecedor, Custo, Venda e Margem do Item) */}
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

                    {/* Linha 1: Peça (Catálogo SOU.Is / Base) - LARGURA TOTAL do card do item */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        Peça (Catálogo) <span className="text-red-500">*</span>
                      </label>
                      <ProductSearchCombobox
                        products={catalogProducts}
                        value={item.part_name}
                        displayValue={item.part_name}
                        onChange={(prodId) => {
                          const found = catalogProducts.find((p) => p.id === prodId)
                          handleSelectProductForItem(index, found || null)
                        }}
                        onSelectProduct={(p) => handleSelectProductForItem(index, p)}
                        placeholder="Buscar peça no catálogo..."
                        inputClassName="h-9 text-xs bg-white"
                      />
                    </div>

                    {/* Linha 2: Veículo e Quantidade (lado a lado) */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                      <div className="sm:col-span-9">
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

                      <div className="sm:col-span-3">
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

                    {/* Linha 3: Fornecedor do Item, Preço de Custo, Margem %, Preço de Venda e Margem do Item */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-slate-100">
                      {/* Fornecedor Próprio */}
                      <div className="sm:col-span-3">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5 flex items-center gap-1">
                          <Truck className="h-3 w-3 text-amber-600" /> Fornecedor do item
                        </label>
                        {(() => {
                          const matchedProduct = catalogProducts.find(
                            (p) =>
                              p.name.trim().toLowerCase() === item.part_name.trim().toLowerCase(),
                          )
                          const suggestedIds = getSuggestedSupplierIdsForProduct(matchedProduct)
                          return (
                            <SupplierSearchCombobox
                              suppliers={suppliers}
                              value={item.supplier_id || ''}
                              onChange={(supId) => handleItemChange(index, 'supplier_id', supId)}
                              suggestedSupplierIds={suggestedIds}
                              placeholder="Buscar fornecedor..."
                            />
                          )
                        })()}
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
                          className="h-8 text-xs"
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
                          className="h-8 text-xs text-center font-medium"
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
                          className="h-8 text-xs"
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

            {/* Rodapé da seção de itens: Totais gerais somados de todos os itens */}
            {hasPricingSummary && (
              <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200/80 shadow-2xs space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-600" /> Totais de todos os itens
                  da compra
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[11px] text-slate-500 block">Total Custo:</span>
                    <strong className="text-slate-800 font-bold">
                      {formatCurrency(summaryTotals.totalCost)}
                    </strong>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-[11px] text-slate-500 block">Total Venda:</span>
                    <strong className="text-slate-900 font-bold">
                      {formatCurrency(summaryTotals.totalSell)}
                    </strong>
                  </div>
                  <div
                    className={`p-2 rounded border ${
                      totalMargin >= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    <span className="text-[11px] block flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Margem Total:
                    </span>
                    <strong className="font-bold">{formatCurrency(totalMargin)}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Prazo de entrega */}
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              Prazo de entrega (dias)
            </label>
            <Input
              type="number"
              min="0"
              value={deliveryDays}
              onChange={(e) => setDeliveryDays(e.target.value)}
              placeholder="Ex: 2 dias"
            />
          </div>

          {/* Observações */}
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Observações</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações adicionais das peças, códigos originais, etc."
              rows={2}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || hasInvalidItems || !customerId}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isSubmitting ? 'Criando...' : 'Criar Solicitação'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
