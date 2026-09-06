import React from 'react'
import { Phone, Clock, DollarSign, GripVertical, FileText, Building2 } from 'lucide-react'
import { PipelineCardData } from '@/services/pipelineService'
import { formatCurrency } from '@/lib/whatsapp'
import { formatPhoneDisplay } from '@/services/whatsappChat'
import { LeadSourceBadge } from '@/components/LeadSourceBadge'

interface PipelineCardProps {
  card: PipelineCardData
  onClick: () => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>, customerId: string) => void
}

export const PipelineCard: React.FC<PipelineCardProps> = ({ card, onClick, onDragStart }) => {
  const { customer, isManualOverride, activeQuote, totalQuoteAmount, lastInteractionText } = card
  const resolvedType = customer.type || (customer.cnpj ? 'PJ' : 'PF')

  const handleCardDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', customer.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(e, customer.id)
  }

  return (
    <div
      draggable
      onDragStart={handleCardDragStart}
      onClick={onClick}
      className="group relative bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer select-none space-y-2.5 active:scale-[0.99] active:shadow-xs"
    >
      {/* Top Header: Tipo + Origem + Nome + Grip */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
              resolvedType === 'PJ'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {resolvedType}
          </span>
          <LeadSourceBadge source={customer.lead_source} />
          <h4 className="font-bold text-slate-900 text-xs sm:text-sm truncate group-hover:text-emerald-700 transition-colors">
            {customer.name}
          </h4>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isManualOverride && (
            <span
              className="text-[9px] bg-slate-100 text-slate-600 px-1 py-0.5 rounded border border-slate-200 font-medium"
              title="Status fixado manualmente"
            >
              Manual
            </span>
          )}
          <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab" />
        </div>
      </div>

      {/* Telefone e Empresa */}
      <div className="space-y-1 text-xs text-slate-500">
        <div className="flex items-center gap-1.5 font-medium text-slate-700">
          <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{customer.phone}</span>
        </div>

        {customer.company && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
            <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="truncate">{customer.company}</span>
          </div>
        )}
      </div>

      {/* Rodapé do Card: Valor do Orçamento + Última interação */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
        {totalQuoteAmount > 0 || activeQuote ? (
          <div className="flex items-center gap-1 font-bold text-slate-900">
            <DollarSign className="h-3 w-3 text-emerald-600 shrink-0" />
            <span>{formatCurrency(totalQuoteAmount || activeQuote?.total || 0)}</span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400 italic flex items-center gap-1">
            <FileText className="h-3 w-3 text-slate-300" /> Sem orç.
          </span>
        )}

        <div
          className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0"
          title="Última interação registrada"
        >
          <Clock className="h-3 w-3 text-slate-300" />
          <span>{lastInteractionText || 'Recente'}</span>
        </div>
      </div>
    </div>
  )
}
