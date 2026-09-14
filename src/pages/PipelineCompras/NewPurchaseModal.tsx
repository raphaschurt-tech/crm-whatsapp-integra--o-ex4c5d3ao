import React, { useState } from 'react'
import {
  Plus,
  Trash2,
  Car,
  User,
  Truck,
  DollarSign,
  Clock,
  TrendingUp,
  Hash,
  Layers,
} from 'lucide-react'
import { Customer, PurchaseItem, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'
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

interface NewPurchaseModalProps {
  isOpen: boolean
  onClose: () => void
  customers: Customer[]
  suppliers: Customer[]
  onSubmit: (data: Partial<PurchaseRequest>) => Promise<void>
}

const MAX_ITEMS = 10

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  isOpen,
  onClose,
  customers,
  suppliers,
  onSubmit,
}) => {
  const [items, setItems] = useState<PurchaseItem[]>([{ part_name: '', vehicle: '', quantity: 1 }])
  const [osNumber, setOsNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [status, setStatus] = useState<PurchaseRequestStatus>('solicitada')
  const [costPrice, setCostPrice] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [deliveryDays, setDeliveryDays] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const numCost = parseFloat(costPrice) || 0
  const numSell = parseFloat(sellPrice) || 0
  const hasBoth = Boolean(costPrice && sellPrice && !isNaN(numCost) && !isNaN(numSell))
  const margin = hasBoth ? numSell - numCost : null

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    setItems((prev) => {
      const next = [...prev]
      if (field === 'quantity') {
        const val = parseInt(value, 10)
        next[index] = { ...next[index], quantity: isNaN(val) || val < 1 ? 1 : val }
      } else {
        next[index] = { ...next[index], [field]: value }
      }
      return next
    })
  }

  const handleAddItem = () => {
    if (items.length >= MAX_ITEMS) return
    setItems((prev) => [...prev, { part_name: '', vehicle: '', quantity: 1 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const resetForm = () => {
    setItems([{ part_name: '', vehicle: '', quantity: 1 }])
    setOsNumber('')
    setCustomerId('')
    setSupplierId('')
    setStatus('solicitada')
    setCostPrice('')
    setSellPrice('')
    setDeliveryDays('')
    setNotes('')
  }

  const hasInvalidItems = items.some(
    (item) => !item.part_name.trim() || !item.vehicle.trim() || (item.quantity || 1) < 1,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasInvalidItems || !customerId) return

    setIsSubmitting(true)
    try {
      const cleanedItems: PurchaseItem[] = items.map((it) => ({
        part_name: it.part_name.trim(),
        vehicle: it.vehicle.trim(),
        quantity: Math.max(1, Number(it.quantity) || 1),
      }))

      await onSubmit({
        part_name: cleanedItems[0]?.part_name || '',
        vehicle: cleanedItems[0]?.vehicle || '',
        items: cleanedItems,
        os_number: osNumber.trim() || undefined,
        customer: customerId,
        supplier: supplierId || undefined,
        status,
        cost_price: costPrice ? parseFloat(costPrice) : undefined,
        sell_price: sellPrice ? parseFloat(sellPrice) : undefined,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
              <Plus className="h-4 w-4" />
            </span>
            Nova Solicitação de Compra
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Campo OS (Opcional, digitado manualmente por hora) */}
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
              Digitada manualmente por enquanto. Aparecerá em destaque no card kanban.
            </p>
          </div>

          {/* Seção de Itens (Até 10 itens com Peça, Veículo e Quantidade) */}
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

            <div className="space-y-2.5">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="p-3 bg-white rounded-lg border border-slate-200/90 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Item {index + 1}</span>
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

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    {/* Peça (Obrigatório) */}
                    <div className="sm:col-span-5">
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        Peça <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={item.part_name}
                        onChange={(e) => handleItemChange(index, 'part_name', e.target.value)}
                        placeholder="Ex: Bucha da bandeja..."
                        required
                        className="h-8 text-xs"
                        autoFocus={index === 0}
                      />
                    </div>

                    {/* Veículo (Obrigatório) */}
                    <div className="sm:col-span-5">
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        Veículo <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={item.vehicle}
                        onChange={(e) => handleItemChange(index, 'vehicle', e.target.value)}
                        placeholder="Ex: Kicks 2016..."
                        required
                        className="h-8 text-xs"
                      />
                    </div>

                    {/* Quantidade (Obrigatório, min 1, default 1) */}
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
                        className="h-8 text-xs font-bold text-center"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Botão Adicionar Item */}
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
          </div>

          {/* Logo abaixo dos itens: Fornecedor e Cliente */}
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Fornecedor (Opcional)
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">Nenhum fornecedor selecionado</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.company ? `(${s.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

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
          </div>

          {/* Valores Financeiros */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Preço de Custo Total (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Preço de Venda Total (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          {/* Margem calculada */}
          {margin !== null && (
            <div
              className={`p-2.5 rounded-lg border flex items-center justify-between text-xs font-semibold ${
                margin >= 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Margem prevista:
              </span>
              <span>{formatCurrency(margin)}</span>
            </div>
          )}

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
              placeholder="Informações adicionais da peça, código original, etc."
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
