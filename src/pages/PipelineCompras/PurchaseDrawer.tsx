import React, { useState, useEffect } from 'react'
import {
  X,
  Car,
  User,
  Truck,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  Save,
  Trash2,
  ExternalLink,
  Plus,
  Hash,
  Layers,
} from 'lucide-react'
import { Customer, PurchaseItem, PurchaseRequest, PurchaseRequestStatus } from '@/types/crm'
import {
  PURCHASE_COLUMNS,
  normalizePurchaseItems,
  formatPurchaseItemsSummary,
} from '@/services/purchaseRequestsService'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Link } from 'react-router-dom'

interface PurchaseDrawerProps {
  card: PurchaseRequest | null
  customers: Customer[]
  suppliers: Customer[]
  onClose: () => void
  onUpdate: (id: string, data: Partial<PurchaseRequest>) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onMoveStatus: (id: string, targetStatus: PurchaseRequestStatus) => Promise<void>
}

const MAX_ITEMS = 10

export const PurchaseDrawer: React.FC<PurchaseDrawerProps> = ({
  card,
  customers,
  suppliers,
  onClose,
  onUpdate,
  onDelete,
  onMoveStatus,
}) => {
  const [items, setItems] = useState<PurchaseItem[]>([{ part_name: '', vehicle: '', quantity: 1 }])
  const [osNumber, setOsNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [status, setStatus] = useState<PurchaseRequestStatus>('solicitada')
  const [costPrice, setCostPrice] = useState<string>('')
  const [sellPrice, setSellPrice] = useState<string>('')
  const [deliveryDays, setDeliveryDays] = useState<string>('')
  const [receivedAt, setReceivedAt] = useState<string>('')
  const [isCompleted, setIsCompleted] = useState<boolean>(false)
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Re-sync on card prop change
  useEffect(() => {
    if (!card) return
    const normalized = normalizePurchaseItems(card)
    setItems(
      normalized.length > 0
        ? normalized
        : [{ part_name: card.part_name || '', vehicle: card.vehicle || '', quantity: 1 }],
    )
    setOsNumber(card.os_number || '')
    setCustomerId(card.customer || '')
    setSupplierId(card.supplier || '')
    setStatus(card.status)
    setCostPrice(
      card.cost_price !== undefined && card.cost_price !== null ? String(card.cost_price) : '',
    )
    setSellPrice(
      card.sell_price !== undefined && card.sell_price !== null ? String(card.sell_price) : '',
    )
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

  const hasInvalidItems = items.some(
    (item) => !item.part_name.trim() || !item.vehicle.trim() || (item.quantity || 1) < 1,
  )

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasInvalidItems || !customerId) return

    setIsSaving(true)
    try {
      const cleanedItems: PurchaseItem[] = items.map((it) => ({
        part_name: it.part_name.trim(),
        vehicle: it.vehicle.trim(),
        quantity: Math.max(1, Number(it.quantity) || 1),
      }))

      const payload: Partial<PurchaseRequest> = {
        part_name: cleanedItems[0]?.part_name || '',
        vehicle: cleanedItems[0]?.vehicle || '',
        items: cleanedItems,
        os_number: osNumber.trim() || '',
        customer: customerId,
        supplier: supplierId || undefined,
        cost_price: costPrice ? parseFloat(costPrice) : undefined,
        sell_price: sellPrice ? parseFloat(sellPrice) : undefined,
        delivery_days: deliveryDays ? parseInt(deliveryDays, 10) : undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        is_completed: isCompleted,
        notes: notes.trim(),
      }

      // Se mudou de status via select, aciona movimentação
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
  const headerTitle = formatPurchaseItemsSummary(card)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-xl bg-white h-full shadow-2xl flex flex-col z-10 border-l border-slate-200 animate-in slide-in-from-right duration-200">
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

          {/* Lista de Itens (Até 10 itens, todos editáveis incluindo quantidade) */}
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
                        className="h-8 text-xs bg-white"
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
                        className="h-8 text-xs bg-white"
                      />
                    </div>

                    {/* Quantidade (Obrigatório, min 1) */}
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
          <div className="space-y-3 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Fornecedor (Opcional — Etapa Cotação)
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">Nenhum fornecedor vinculado</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.company ? `(${s.company})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
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
          </div>

          {/* Valores Financeiros e Margem */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-emerald-600" /> Precificação e Margem (Total)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            {/* Margem Calculada Automaticamente */}
            <div
              className={`p-3 rounded-lg border flex items-center justify-between text-xs font-medium ${
                margin !== null
                  ? margin >= 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" />
                <span>Margem de Lucro (Venda − Custo):</span>
              </div>
              <strong className="text-sm">
                {margin !== null ? formatCurrency(margin) : 'Aguardando valores'}
              </strong>
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
    </div>
  )
}
