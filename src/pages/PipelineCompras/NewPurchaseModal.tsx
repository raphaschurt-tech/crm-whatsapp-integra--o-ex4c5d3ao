import React, { useState, useMemo } from 'react'
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
import {
  SupplierSearchCombobox,
  SupplierMultiSelectCombobox,
} from '@/components/Quotes/SupplierSearchCombobox'
import { generatePurchaseSupplierPdfBase64Async } from '@/services/purchaseSupplierPdfService'
import { sendWhatsAppMessage } from '@/services/quotes'
import { getCanonicalPhone } from '@/lib/whatsapp'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  MessageSquare,
  Send,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Sparkles as SparklesIcon,
  FileText,
} from 'lucide-react'
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
  supplier_ids?: string[]
  product_id?: string
  reduced_code?: string
  cost_price?: string
  margin_percent?: string
  sell_price?: string
}

const emptyItem: FormItemState = {
  part_name: '',
  vehicle: '',
  quantity: 1,
  supplier_id: '',
  supplier_ids: [],
  product_id: '',
  reduced_code: '',
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

  // Estado para envio de mensagens aos fornecedores
  const [supplierPdfToggles, setSupplierPdfToggles] = useState<Record<string, boolean>>({})
  const [supplierCheckboxes, setSupplierCheckboxes] = useState<Record<string, boolean>>({})
  const [supplierCustomText, setSupplierCustomText] = useState('')
  const [isSendingSupplierMessages, setIsSendingSupplierMessages] = useState(false)
  const [supplierSendResults, setSupplierSendResults] = useState<
    Record<string, { success: boolean; error?: string }>
  >({})
  const [showSupplierPreview, setShowSupplierPreview] = useState(false)
  const [isTextManuallyEdited, setIsTextManuallyEdited] = useState(false)

  // Consolidação de fornecedores por TELEFONE CANÔNICO (Dedupe por número)
  // Fornecedores com o mesmo telefone canônico (ex: Henrique Dpa e HENRIQUE DPA) viram UM grupo único
  // com nomes unificados e todos os itens agregados sem duplicidade de mensagem
  const uniqueSelectedSuppliers = useMemo(() => {
    interface SupplierGroupInternal {
      key: string
      primarySupplier: Customer
      allSuppliers: Customer[]
      items: FormItemState[]
    }

    const groupMap = new Map<string, SupplierGroupInternal>()

    items.forEach((item) => {
      const sIds =
        item.supplier_ids && item.supplier_ids.length > 0
          ? item.supplier_ids
          : item.supplier_id
            ? [item.supplier_id]
            : []

      sIds.forEach((supId) => {
        const found = suppliers.find((s) => s.id === supId)
        if (!found) return

        const canonicalPhone = getCanonicalPhone(found.phone)
        // Se tem telefone canônico válido, a chave é o telefone; caso contrário, usa o ID
        const groupKey = canonicalPhone ? `phone_${canonicalPhone}` : `id_${found.id}`

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            key: groupKey,
            primarySupplier: found,
            allSuppliers: [found],
            items: [],
          })
        } else {
          const group = groupMap.get(groupKey)!
          if (!group.allSuppliers.some((s) => s.id === found.id)) {
            group.allSuppliers.push(found)
            // Se o fornecedor atual tiver telefone e o primary não tiver, promove o que tem telefone
            if (!group.primarySupplier.phone?.trim() && found.phone?.trim()) {
              group.primarySupplier = found
            }
          }
        }

        const group = groupMap.get(groupKey)!
        // Adiciona o item se ainda não estiver presente nesta lista de itens do grupo
        if (!group.items.includes(item)) {
          group.items.push(item)
        }
      })
    })

    return Array.from(groupMap.values()).map((group) => {
      // Unifica nomes se houver 2+ cadastros no mesmo grupo
      const uniqueNames = Array.from(
        new Set(group.allSuppliers.map((s) => s.name?.trim()).filter(Boolean)),
      )
      const unifiedName =
        uniqueNames.length > 1 ? uniqueNames.join(' / ') : group.primarySupplier.name

      // Monta objeto consolidado do fornecedor preservando id do primary e telefone preenchido
      const consolidatedSupplier: Customer = {
        ...group.primarySupplier,
        name: unifiedName,
      }

      return {
        key: group.key,
        supplier: consolidatedSupplier,
        allSuppliers: group.allSuppliers,
        items: group.items,
      }
    })
  }, [items, suppliers])

  // Inicializa checkboxes (marcados por padrão) e PDFs (desligados por padrão) para fornecedores que entram
  React.useEffect(() => {
    setSupplierCheckboxes((prev) => {
      const next = { ...prev }
      uniqueSelectedSuppliers.forEach(({ supplier }) => {
        if (next[supplier.id] === undefined) {
          next[supplier.id] = true
        }
      })
      return next
    })

    setSupplierPdfToggles((prev) => {
      const next = { ...prev }
      uniqueSelectedSuppliers.forEach(({ supplier }) => {
        if (next[supplier.id] === undefined) {
          next[supplier.id] = false
        }
      })
      return next
    })
  }, [uniqueSelectedSuppliers])

  // Gera texto base padrão da solicitação
  const defaultSupplierMessageText = useMemo(() => {
    const validItems = items.filter((it) => it.part_name.trim().length > 0)
    let text = 'Olá! Segue nossa solicitação de cotação de peças:\n\n'
    if (osNumber.trim()) {
      text += `*OS:* ${osNumber.trim()}\n`
    }
    if (deliveryDays.trim()) {
      text += `*Prazo desejado:* ${deliveryDays.trim()} dia(s)\n`
    }
    text += '\n*Itens solicitados:*\n'
    if (validItems.length === 0) {
      text += '• (Nenhum item informado)\n'
    } else {
      validItems.forEach((it, idx) => {
        const veh = it.vehicle?.trim() ? ` (${it.vehicle.trim()})` : ''
        text += `• ${it.quantity}x ${it.part_name.trim()}${veh}\n`
      })
    }
    if (notes.trim()) {
      text += `\n*Observações:* ${notes.trim()}\n`
    }
    text += '\nPor favor, nos confirme preço e prazo de entrega. Obrigado!'
    return text
  }, [items, osNumber, deliveryDays, notes])

  // Atualiza o texto editável se o usuário ainda não tiver editado manualmente
  React.useEffect(() => {
    if (!isTextManuallyEdited) {
      setSupplierCustomText(defaultSupplierMessageText)
    }
  }, [defaultSupplierMessageText, isTextManuallyEdited])

  // Gera a mensagem específica de um fornecedor (contendo APENAS os itens em que ele foi selecionado)
  const buildMessageForSupplier = (supplierGroup: {
    supplier: Customer
    items: FormItemState[]
  }): string => {
    const supItems = supplierGroup.items.filter((it) => it.part_name.trim().length > 0)
    const baseText = supplierCustomText || defaultSupplierMessageText

    // Se o usuário customizou e não mexemos, substituímos a seção de itens do fornecedor ou montamos específico:
    // Monta texto específico com o cabeçalho, os itens exclusivos deste fornecedor e as observações
    let msg = `Olá, *${supplierGroup.supplier.name}*! Segue solicitação de cotação:\n\n`
    if (osNumber.trim()) {
      msg += `*OS:* ${osNumber.trim()}\n`
    }
    if (deliveryDays.trim()) {
      msg += `*Prazo desejado:* ${deliveryDays.trim()} dia(s)\n`
    }
    msg += '\n*Itens solicitados para sua cotação:*\n'
    supItems.forEach((it) => {
      const veh = it.vehicle?.trim() ? ` (${it.vehicle.trim()})` : ''
      const red = it.reduced_code?.trim() ? ` [cod. ${it.reduced_code.trim()}]` : ''
      msg += `• ${it.quantity}x ${it.part_name.trim()}${red}${veh}\n`
    })

    if (notes.trim()) {
      msg += `\n*Observações:* ${notes.trim()}\n`
    }
    msg += '\nPor favor, nos confirme disponibilidade, melhor preço e prazo de entrega. Obrigado!'
    return msg
  }

  // Contagem de fornecedores sem telefone e itens sem fornecedor
  const suppliersWithoutPhoneCount = useMemo(() => {
    return uniqueSelectedSuppliers.filter(({ supplier }) => !supplier.phone?.trim()).length
  }, [uniqueSelectedSuppliers])

  const itemsWithoutSupplierCount = useMemo(() => {
    return items.filter((it) => {
      const sIds =
        it.supplier_ids && it.supplier_ids.length > 0
          ? it.supplier_ids
          : it.supplier_id
            ? [it.supplier_id]
            : []
      return sIds.length === 0
    }).length
  }, [items])

  // Disparo das mensagens para fornecedores selecionados
  const handleSendMessagesToSuppliers = async () => {
    setIsSendingSupplierMessages(true)
    const results: Record<string, { success: boolean; error?: string }> = {}

    for (const group of uniqueSelectedSuppliers) {
      const { supplier } = group
      const isChecked = supplierCheckboxes[supplier.id] !== false
      if (!isChecked) continue

      const phone = supplier.phone?.trim()
      if (!phone) {
        results[supplier.id] = { success: false, error: 'Sem telefone cadastrado' }
        continue
      }

      const msgText = buildMessageForSupplier(group)
      const shouldSendPdf = Boolean(supplierPdfToggles[supplier.id])

      try {
        let pdfBase64: string | undefined = undefined
        if (shouldSendPdf) {
          const pdfItems = group.items.map((it) => ({
            part_name: it.part_name.trim(),
            vehicle: it.vehicle?.trim() || undefined,
            quantity: Math.max(1, Number(it.quantity) || 1),
            reduced_code: it.reduced_code?.trim() || undefined,
          }))
          pdfBase64 = await generatePurchaseSupplierPdfBase64Async({
            supplier,
            items: pdfItems,
            osNumber: osNumber.trim() || undefined,
            deliveryDays: deliveryDays.trim() || undefined,
            notes: notes.trim() || undefined,
          })
        }

        const res = await sendWhatsAppMessage(
          phone,
          msgText,
          pdfBase64
            ? { document: pdfBase64, fileName: `Cotacao_${supplier.name.replace(/\s+/g, '_')}.pdf` }
            : undefined,
        )
        if (res.ok || res.zapiSuccess) {
          results[supplier.id] = { success: true }
        } else {
          results[supplier.id] = {
            success: false,
            error: res.zapiError || res.docError || 'Erro ao enviar via Z-API',
          }
        }
      } catch (err: any) {
        results[supplier.id] = {
          success: false,
          error: err?.message || 'Erro inesperado no disparo',
        }
      }
    }

    setSupplierSendResults(results)
    setIsSendingSupplierMessages(false)
  }

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
      currentItem.product_id = product.id
      currentItem.reduced_code = product.reduced_code || ''

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
      let initialSupId = ''
      if (product.supplier) {
        const matchedSup = suppliers.find(
          (s) =>
            s.name.trim().toLowerCase() === product.supplier?.trim().toLowerCase() ||
            (s.company &&
              s.company.trim().toLowerCase() === product.supplier?.trim().toLowerCase()),
        )
        if (matchedSup) {
          initialSupId = matchedSup.id
        }
      }

      // Prioridade 2: se ainda não preencheu e houver fornecedores sugeridos pela família,
      // se houver o fornecedor SOU.IS entre eles ou exatamente um fornecedor da família, pré-preenche
      if (!initialSupId) {
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
            initialSupId = souisSup.id
          } else if (suggestedIds.length === 1) {
            initialSupId = suggestedIds[0]
          }
        }
      }

      if (initialSupId) {
        const currentList =
          currentItem.supplier_ids || (currentItem.supplier_id ? [currentItem.supplier_id] : [])
        if (!currentList.includes(initialSupId)) {
          const nextList = [...currentList, initialSupId].slice(0, 10)
          currentItem.supplier_ids = nextList
          currentItem.supplier_id = nextList[0]
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
    setItems((prev) => {
      const lastItem = prev[prev.length - 1]
      const inheritedSupplierIds =
        lastItem && lastItem.supplier_ids && lastItem.supplier_ids.length > 0
          ? [...lastItem.supplier_ids]
          : lastItem && lastItem.supplier_id
            ? [lastItem.supplier_id]
            : []

      return [
        ...prev,
        {
          ...emptyItem,
          supplier_ids: inheritedSupplierIds,
          supplier_id: inheritedSupplierIds[0] || '',
        },
      ]
    })
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
    setSupplierCheckboxes({})
    setSupplierPdfToggles({})
    setSupplierCustomText('')
    setIsTextManuallyEdited(false)
    setSupplierSendResults({})
    setShowSupplierPreview(false)
  }

  const hasInvalidItems = items.some((item) => !item.part_name.trim() || (item.quantity || 1) < 1)

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
    if (hasInvalidItems) return

    setIsSubmitting(true)
    try {
      const cleanedItems: PurchaseItem[] = items.map((it) => {
        const costNum = it.cost_price ? parseFloat(it.cost_price) : undefined
        const sellNum = it.sell_price ? parseFloat(it.sell_price) : undefined
        const sup = suppliers.find((s) => s.id === it.supplier_id)
        const supplierName = sup ? sup.name || sup.company || undefined : undefined

        const sIds =
          it.supplier_ids && it.supplier_ids.length > 0
            ? it.supplier_ids
            : it.supplier_id
              ? [it.supplier_id]
              : []
        const primarySup = sIds[0] || it.supplier_id
        const supObj = suppliers.find((s) => s.id === primarySup)
        const resolvedSupName = supObj ? supObj.name || supObj.company || undefined : supplierName

        return {
          part_name: it.part_name.trim(),
          vehicle: (it.vehicle || '').trim(),
          quantity: Math.max(1, Number(it.quantity) || 1),
          supplier_id: primarySup || undefined,
          supplier_name: resolvedSupName,
          supplier_ids: sIds,
          product_id: it.product_id || undefined,
          reduced_code: it.reduced_code || undefined,
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
        customer: customerId || undefined,
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
      <DialogContent className="w-[96vw] max-w-6xl max-h-[90vh] overflow-y-auto">
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

          {/* Cliente (Opcional - pode ser para Estoque) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 block">Cliente</label>
              <span className="text-[11px] text-slate-500 font-medium">
                Opcional (deixe vazio para compra de <strong>Estoque</strong>)
              </span>
            </div>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Sem cliente (Compra para Estoque)</option>
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
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[11px] font-semibold text-slate-600 block">
                          Peça (Catálogo) <span className="text-red-500">*</span>
                        </label>
                        {item.reduced_code && (
                          <span className="text-[11px] font-bold text-amber-800 bg-amber-100/90 border border-amber-300 px-2 py-0.5 rounded">
                            Cód. Reduzido Fornecedor: <strong>{item.reduced_code}</strong>
                          </span>
                        )}
                      </div>
                      <ProductSearchCombobox
                        products={catalogProducts}
                        value={item.part_name}
                        displayValue={item.part_name}
                        mode="compra"
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
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[11px] font-semibold text-slate-600 block">
                            Veículo
                          </label>
                          <span className="text-[10px] text-slate-400">Opcional</span>
                        </div>
                        <Input
                          value={item.vehicle}
                          onChange={(e) => handleItemChange(index, 'vehicle', e.target.value)}
                          placeholder="Ex: Kicks 2016... (opcional)"
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
                      {/* Fornecedor Próprio (Multi-seleção até 10) */}
                      <div className="sm:col-span-3">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5 flex items-center gap-1">
                          <Truck className="h-3 w-3 text-amber-600" /> Fornecedores do item
                        </label>
                        {(() => {
                          const matchedProduct = catalogProducts.find(
                            (p) =>
                              p.name.trim().toLowerCase() === item.part_name.trim().toLowerCase(),
                          )
                          const suggestedIds = getSuggestedSupplierIdsForProduct(matchedProduct)
                          const currentIds =
                            item.supplier_ids && item.supplier_ids.length > 0
                              ? item.supplier_ids
                              : item.supplier_id
                                ? [item.supplier_id]
                                : []

                          // IDs de outros fornecedores já selecionados nos outros itens da compra
                          const otherSelectedIds = items
                            .filter((_, i) => i !== index)
                            .flatMap((other) =>
                              other.supplier_ids && other.supplier_ids.length > 0
                                ? other.supplier_ids
                                : other.supplier_id
                                  ? [other.supplier_id]
                                  : [],
                            )

                          return (
                            <SupplierMultiSelectCombobox
                              suppliers={suppliers}
                              values={currentIds}
                              onChange={(newIds) => {
                                const sliced = newIds.slice(0, 10)
                                setItems((prev) => {
                                  const next = [...prev]
                                  next[index] = {
                                    ...next[index],
                                    supplier_ids: sliced,
                                    supplier_id: sliced[0] || '',
                                  }
                                  return next
                                })
                              }}
                              suggestedSupplierIds={suggestedIds}
                              alreadySelectedSupplierIds={otherSelectedIds}
                              maxSelections={10}
                              placeholder="Buscar fornecedores (até 10)..."
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

          {/* ④ Seção: Contatos dos fornecedores selecionados (Agrupada por Fornecedor + PDF opcional) */}
          <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-amber-200">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-600 text-white shadow-xs">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Contatos dos fornecedores selecionados
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Mensagem única consolidada por fornecedor com APENAS os itens em que ele foi
                    selecionado
                  </p>
                </div>
              </div>

              {uniqueSelectedSuppliers.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
                    {uniqueSelectedSuppliers.length}{' '}
                    {uniqueSelectedSuppliers.length === 1
                      ? 'fornecedor único'
                      : 'fornecedores únicos'}
                  </span>
                  {(() => {
                    const checkedCount = uniqueSelectedSuppliers.filter(
                      ({ supplier }) => supplierCheckboxes[supplier.id] !== false,
                    ).length
                    const pdfCount = uniqueSelectedSuppliers.filter(
                      ({ supplier }) =>
                        supplierCheckboxes[supplier.id] !== false &&
                        Boolean(supplierPdfToggles[supplier.id]),
                    ).length
                    return (
                      <span className="text-[11px] text-slate-600 font-medium">
                        ({checkedCount} marcados, {pdfCount} com PDF)
                      </span>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* Avisos de validação / relatório rápido */}
            {(suppliersWithoutPhoneCount > 0 || itemsWithoutSupplierCount > 0) && (
              <div className="space-y-1">
                {itemsWithoutSupplierCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-100/70 border border-amber-200 px-2.5 py-1.5 rounded-md">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <span>
                      <strong>Aviso:</strong> {itemsWithoutSupplierCount}{' '}
                      {itemsWithoutSupplierCount === 1
                        ? 'item está sem fornecedor selecionado'
                        : 'itens estão sem fornecedor selecionado'}{' '}
                      (não será enviado para ninguém).
                    </span>
                  </div>
                )}
                {suppliersWithoutPhoneCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-md">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                    <span>
                      {suppliersWithoutPhoneCount}{' '}
                      {suppliersWithoutPhoneCount === 1
                        ? 'fornecedor selecionado está sem telefone cadastrado'
                        : 'fornecedores selecionados estão sem telefone cadastrado'}{' '}
                      (envio não disponível para ele).
                    </span>
                  </div>
                )}
              </div>
            )}

            {uniqueSelectedSuppliers.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-500 bg-white rounded-lg border border-dashed border-amber-200">
                Nenhum fornecedor selecionado nos itens acima. Selecione fornecedores nos itens para
                habilitar o envio direto via WhatsApp.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Lista de Fornecedores Únicos */}
                <div className="divide-y divide-amber-200/80 bg-white rounded-lg border border-amber-200 overflow-hidden shadow-2xs">
                  {uniqueSelectedSuppliers.map(({ supplier, items: supItems }) => {
                    const isChecked = supplierCheckboxes[supplier.id] !== false
                    const isPdfActive = Boolean(supplierPdfToggles[supplier.id])
                    const hasPhone = Boolean(supplier.phone?.trim())
                    const sendStatus = supplierSendResults[supplier.id]

                    return (
                      <div
                        key={supplier.id}
                        className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-amber-50/30 transition-colors"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Checkbox
                            id={`sup-chk-${supplier.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) =>
                              setSupplierCheckboxes((prev) => ({
                                ...prev,
                                [supplier.id]: Boolean(checked),
                              }))
                            }
                            disabled={!hasPhone}
                            className="mt-1"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <label
                                htmlFor={`sup-chk-${supplier.id}`}
                                className="text-xs font-bold text-slate-900 cursor-pointer hover:underline"
                              >
                                {supplier.name}
                              </label>
                              {supplier.company && (
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {supplier.company}
                                </span>
                              )}
                              <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-full">
                                {supItems.length}{' '}
                                {supItems.length === 1
                                  ? 'item nesta cotação'
                                  : 'itens nesta cotação'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                              {hasPhone ? (
                                <span className="text-slate-600 font-mono flex items-center gap-1">
                                  📱 {supplier.phone}
                                </span>
                              ) : (
                                <span className="text-rose-600 font-semibold flex items-center gap-1 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                                  <AlertCircle className="h-3 w-3" /> sem telefone cadastrado
                                </span>
                              )}
                            </div>

                            {/* Resumo compacto dos itens deste fornecedor */}
                            <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                              Peças:{' '}
                              {supItems
                                .map((it) => `${it.quantity}x ${it.part_name || 'Sem nome'}`)
                                .join(', ')}
                            </div>
                          </div>
                        </div>

                        {/* Controles: Toggle PDF + Status do Envio */}
                        <div className="flex items-center gap-3 shrink-0 sm:self-center pl-7 sm:pl-0">
                          {/* Toggle PDF independente por fornecedor (desligado por padrão) */}
                          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                            <FileText
                              className={`h-3.5 w-3.5 ${isPdfActive ? 'text-amber-600' : 'text-slate-400'}`}
                            />
                            <label
                              htmlFor={`pdf-toggle-${supplier.id}`}
                              className="text-[11px] font-semibold text-slate-700 cursor-pointer select-none"
                            >
                              Enviar PDF
                            </label>
                            <Switch
                              id={`pdf-toggle-${supplier.id}`}
                              checked={isPdfActive}
                              disabled={!isChecked || !hasPhone}
                              onCheckedChange={(checked) =>
                                setSupplierPdfToggles((prev) => ({
                                  ...prev,
                                  [supplier.id]: Boolean(checked),
                                }))
                              }
                              className="scale-75 origin-right"
                            />
                          </div>

                          {/* Feedback de Envio individual */}
                          {sendStatus && (
                            <div className="text-[11px] font-semibold shrink-0">
                              {sendStatus.success ? (
                                <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Enviado
                                </span>
                              ) : (
                                <span
                                  className="text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded-md inline-flex items-center gap-1"
                                  title={sendStatus.error}
                                >
                                  <AlertCircle className="h-3.5 w-3.5" /> Falha: {sendStatus.error}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Texto editável único (pré-preenchido com resumo da solicitação) */}
                <div className="space-y-1 bg-white p-3 rounded-lg border border-amber-200">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      Texto da Mensagem (padrão para os selecionados)
                    </label>
                    <span className="text-[10px] text-slate-400">
                      * Cada fornecedor receberá APENAS os itens atribuídos a ele
                    </span>
                  </div>
                  <Textarea
                    value={supplierCustomText}
                    onChange={(e) => {
                      setSupplierCustomText(e.target.value)
                      setIsTextManuallyEdited(true)
                    }}
                    rows={4}
                    placeholder="Digite o modelo de mensagem..."
                    className="text-xs font-sans bg-slate-50/50"
                  />
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>
                      Dica: variáveis de itens e quantidades são inseridas de acordo com o
                      fornecedor.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSupplierCustomText(defaultSupplierMessageText)
                        setIsTextManuallyEdited(false)
                      }}
                      className="text-amber-700 hover:underline font-semibold"
                    >
                      Restaurar texto padrão
                    </button>
                  </div>
                </div>

                {/* Ações: Botão de Prévia e Botão de Disparo */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSupplierPreview((prev) => !prev)}
                    className="border-amber-300 text-amber-900 hover:bg-amber-100"
                  >
                    {showSupplierPreview ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5 mr-1.5" /> Ocultar Prévia das Mensagens
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> Ver Prévia antes de disparar
                      </>
                    )}
                  </Button>

                  {(() => {
                    const targetGroups = uniqueSelectedSuppliers.filter(
                      ({ supplier }) =>
                        supplierCheckboxes[supplier.id] !== false &&
                        Boolean(supplier.phone?.trim()),
                    )
                    const totalMsgCount = targetGroups.length
                    const pdfMsgCount = targetGroups.filter(({ supplier }) =>
                      Boolean(supplierPdfToggles[supplier.id]),
                    ).length

                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          {totalMsgCount} {totalMsgCount === 1 ? 'mensagem' : 'mensagens'} (
                          {pdfMsgCount} com PDF)
                        </span>
                        <Button
                          type="button"
                          onClick={handleSendMessagesToSuppliers}
                          disabled={isSendingSupplierMessages || totalMsgCount === 0}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs"
                        >
                          {isSendingSupplierMessages ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Enviando via
                              Z-API...
                            </>
                          ) : (
                            <>
                              <Send className="h-3.5 w-3.5 mr-1.5" /> Confirmar Envio (
                              {totalMsgCount})
                            </>
                          )}
                        </Button>
                      </div>
                    )
                  })()}
                </div>

                {/* Bloco de Prévia Expandida */}
                {showSupplierPreview && (
                  <div className="mt-3 p-3.5 bg-slate-900 text-slate-100 rounded-lg space-y-3 text-xs animate-in fade-in-50">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                      <span className="font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                        <Eye className="h-4 w-4" /> Prévia exata por destinatário
                      </span>
                      {(() => {
                        const targetGroups = uniqueSelectedSuppliers.filter(
                          ({ supplier }) =>
                            supplierCheckboxes[supplier.id] !== false &&
                            Boolean(supplier.phone?.trim()),
                        )
                        const pdfMsgCount = targetGroups.filter(({ supplier }) =>
                          Boolean(supplierPdfToggles[supplier.id]),
                        ).length
                        return (
                          <span className="text-[11px] text-slate-300">
                            {targetGroups.length} fornecedores, {targetGroups.length} mensagens,{' '}
                            {pdfMsgCount} com PDF
                          </span>
                        )
                      })()}
                    </div>

                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                      {uniqueSelectedSuppliers.map((group) => {
                        const { supplier } = group
                        const isChecked = supplierCheckboxes[supplier.id] !== false
                        const hasPhone = Boolean(supplier.phone?.trim())
                        const isPdf = Boolean(supplierPdfToggles[supplier.id])
                        const previewText = buildMessageForSupplier(group)

                        if (!isChecked) {
                          return (
                            <div
                              key={supplier.id}
                              className="p-2 rounded bg-slate-800/50 border border-slate-700 text-slate-400 italic"
                            >
                              {supplier.name}: envio desmarcado.
                            </div>
                          )
                        }

                        if (!hasPhone) {
                          return (
                            <div
                              key={supplier.id}
                              className="p-2 rounded bg-rose-950/40 border border-rose-800 text-rose-300"
                            >
                              <strong>{supplier.name}:</strong> sem telefone cadastrado — mensagem
                              NÃO será enviada.
                            </div>
                          )
                        }

                        return (
                          <div
                            key={supplier.id}
                            className="p-3 rounded-lg bg-slate-800 border border-slate-700 space-y-2"
                          >
                            <div className="flex items-center justify-between text-slate-300 text-[11px]">
                              <div>
                                <strong className="text-white text-xs">{supplier.name}</strong> (
                                {supplier.phone})
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isPdf
                                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                                    : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                {isPdf
                                  ? '📄 Mensagem de Texto + Anexo PDF'
                                  : '💬 Apenas Mensagem de Texto'}
                              </span>
                            </div>
                            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-slate-950/80 p-2.5 rounded border border-slate-800 text-emerald-300">
                              {previewText}
                            </pre>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
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
              disabled={isSubmitting || hasInvalidItems}
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
