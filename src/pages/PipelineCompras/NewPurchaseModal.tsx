import React, { useState } from 'react'
import { Plus, X, Car, User, Truck, DollarSign, Clock, TrendingUp } from 'lucide-react'
import { Customer, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'
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

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  isOpen,
  onClose,
  customers,
  suppliers,
  onSubmit,
}) => {
  const [partName, setPartName] = useState('')
  const [vehicle, setVehicle] = useState('')
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

  const resetForm = () => {
    setPartName('')
    setVehicle('')
    setCustomerId('')
    setSupplierId('')
    setStatus('solicitada')
    setCostPrice('')
    setSellPrice('')
    setDeliveryDays('')
    setNotes('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partName.trim() || !vehicle.trim() || !customerId) return

    setIsSubmitting(true)
    try {
      await onSubmit({
        part_name: partName.trim(),
        vehicle: vehicle.trim(),
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
              <Plus className="h-4 w-4" />
            </span>
            Nova Solicitação de Compra
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Peça e Veículo */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Peça <span className="text-red-500">*</span>
              </label>
              <Input
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="Ex: Bucha da bandeja, Rolamento traseiro..."
                required
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Veículo <span className="text-red-500">*</span>
              </label>
              <Input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                placeholder="Ex: Kicks 2016, Hilux 2020 2.8..."
                required
              />
            </div>
          </div>

          {/* Cliente e Fornecedor */}
          <div className="space-y-3">
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
          </div>

          {/* Valores Financeiros */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Preço de Custo (R$)
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
                Preço de Venda (R$)
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
              disabled={isSubmitting || !partName.trim() || !vehicle.trim() || !customerId}
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
