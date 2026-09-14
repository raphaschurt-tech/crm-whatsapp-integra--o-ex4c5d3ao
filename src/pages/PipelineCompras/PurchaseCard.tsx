import React from 'react'
import {
  GripVertical,
  User,
  Car,
  Truck,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  Trash2,
  Hash,
  Package,
} from 'lucide-react'
import { PurchaseRequest } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import {
  normalizePurchaseItems,
  formatPurchaseItemsSummary,
  getTotalItemQuantity,
} from '@/services/purchaseRequestsService'

interface PurchaseCardProps {
  card: PurchaseRequest
  onClick: () => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>, cardId: string) => void
  onDelete?: (cardId: string, partName: string) => void
}

export const PurchaseCard: React.FC<PurchaseCardProps> = ({
  card,
  onClick,
  onDragStart,
  onDelete,
}) => {
  const customerName = card.expand?.customer?.name || 'Cliente não identificado'
  const supplierName = card.expand?.supplier?.name || card.expand?.supplier?.company || ''
  const hasCost = typeof card.cost_price === 'number' && card.cost_price > 0
  const hasSell = typeof card.sell_price === 'number' && card.sell_price > 0
  const margin = hasCost && hasSell ? (card.sell_price || 0) - (card.cost_price || 0) : null

  const items = normalizePurchaseItems(card)
  const totalItemsCount = getTotalItemQuantity(card)
  const itemsSummary = formatPurchaseItemsSummary(card)

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(e, card.id)
  }

  const formatDate = (isoString?: string) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })
    } catch {
      return ''
    }
  }

  // Lista dos veículos distintos para exibição compacta
  const vehiclesList = Array.from(new Set(items.map((i) => i.vehicle).filter(Boolean))).join(', ')

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className={`group relative bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs hover:shadow-md hover:border-amber-300 transition-all cursor-pointer select-none space-y-2.5 active:scale-[0.99] active:shadow-xs ${
        card.status === 'entregue' ? 'bg-slate-50/70 border-emerald-200' : ''
      }`}
    >
      {/* Top Header: Badge Compra + Badge OS (se tiver) + Concluído + Grip */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 bg-amber-100 text-amber-800">
            Compra
          </span>

          {/* Badge de OS em destaque */}
          {card.os_number && (
            <span
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-bold shrink-0 bg-amber-500 text-white shadow-2xs"
              title={`Ordem de Serviço: ${card.os_number}`}
            >
              <Hash className="h-3 w-3" />
              OS {card.os_number}
            </span>
          )}

          {card.is_completed && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Concluído
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(card.id, itemsSummary)
              }}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Excluir solicitação de compra"
              aria-label="Excluir solicitação de compra"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab" />
        </div>
      </div>

      {/* Lista Resumida dos Itens com Quantidades */}
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <Package className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4
              className="font-bold text-slate-900 text-xs sm:text-sm leading-snug group-hover:text-amber-700 transition-colors line-clamp-2"
              title={itemsSummary}
            >
              {itemsSummary}
            </h4>
            {items.length > 1 && (
              <span className="text-[10px] font-semibold text-slate-400">
                {items.length} {items.length === 1 ? 'item' : 'itens'} ({totalItemsCount}{' '}
                {totalItemsCount === 1 ? 'unidade' : 'unidades'})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Veículo & Cliente */}
      <div className="space-y-1 text-xs text-slate-600 pt-1 border-t border-slate-100/80">
        {vehiclesList && (
          <div className="flex items-center gap-1.5 font-medium text-slate-800">
            <Car className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{vehiclesList}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <User className="h-3 w-3 text-slate-400 shrink-0" />
          <span className="truncate font-medium">{customerName}</span>
        </div>

        {supplierName && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
            <Truck className="h-3 w-3 text-amber-500 shrink-0" />
            <span className="truncate">Forn: {supplierName}</span>
          </div>
        )}

        {card.delivery_days ? (
          <div className="flex items-center gap-1 text-[11px] text-purple-700">
            <Clock className="h-3 w-3 text-purple-500 shrink-0" />
            <span>
              Prazo: {card.delivery_days} {card.delivery_days === 1 ? 'dia' : 'dias'}
            </span>
          </div>
        ) : null}

        {card.received_at && (
          <div className="flex items-center gap-1 text-[11px] text-teal-700 font-medium">
            <CheckCircle2 className="h-3 w-3 text-teal-600 shrink-0" />
            <span>Recebido em: {formatDate(card.received_at)}</span>
          </div>
        )}
      </div>

      {/* Valores: Custo, Venda e Margem */}
      <div className="pt-2 border-t border-slate-100 space-y-1 text-xs">
        <div className="flex items-center justify-between text-[11px]">
          {hasCost ? (
            <span className="text-slate-500">
              Custo:{' '}
              <strong className="text-slate-800">{formatCurrency(card.cost_price || 0)}</strong>
            </span>
          ) : (
            <span className="text-slate-400 italic">Sem custo</span>
          )}

          {hasSell ? (
            <span className="text-slate-500">
              Venda:{' '}
              <strong className="text-slate-900">{formatCurrency(card.sell_price || 0)}</strong>
            </span>
          ) : (
            <span className="text-slate-400 italic">Sem venda</span>
          )}
        </div>

        {margin !== null && (
          <div
            className={`flex items-center justify-between px-2 py-1 rounded text-[11px] font-semibold ${
              margin >= 0
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Margem:
            </span>
            <span>{formatCurrency(margin)}</span>
          </div>
        )}
      </div>

      {/* Rodapé: Data da solicitação */}
      <div className="pt-1.5 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3 text-slate-300" />
          Solicitado: {formatDate(card.created)}
        </span>
        {card.expand?.created_by?.name && (
          <span className="truncate max-w-[100px]">{card.expand.created_by.name}</span>
        )}
      </div>
    </div>
  )
}
