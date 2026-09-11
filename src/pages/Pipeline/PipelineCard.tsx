import React, { useState } from 'react'
import {
  Phone,
  Clock,
  DollarSign,
  GripVertical,
  FileText,
  Building2,
  User,
  Trash2,
} from 'lucide-react'
import { PipelineCardData } from '@/services/pipelineService'
import { formatCurrency } from '@/lib/whatsapp'
import { formatPhoneDisplay } from '@/services/whatsappChat'
import { LeadSourceBadge } from '@/components/LeadSourceBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface PipelineCardProps {
  card: PipelineCardData
  onClick: () => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>, customerId: string) => void
  isAdmin?: boolean
  onDelete?: (customerId: string, customerName: string) => void
}

export const PipelineCard: React.FC<PipelineCardProps> = ({
  card,
  onClick,
  onDragStart,
  isAdmin = false,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const {
    customer,
    columnId,
    isManualOverride,
    activeQuote,
    totalQuoteAmount,
    lastInteractionText,
  } = card
  const resolvedType = customer.type || (customer.cnpj ? 'PJ' : 'PF')
  const isSupplier = customer.customer_type === 'fornecedor'

  // Nome da pessoa de contato: só exibe se preenchido e não for apenas o número de telefone
  const rawContactName = customer.contact_name?.trim() || ''
  const cleanPhone = (customer.phone || '').replace(/\D/g, '')
  const cleanContact = rawContactName.replace(/\D/g, '')
  const hasContactPerson =
    Boolean(rawContactName) &&
    rawContactName !== customer.phone &&
    cleanContact !== cleanPhone &&
    !/^[0-9+\s()-]+$/.test(rawContactName)

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
          {isSupplier && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 bg-amber-100 text-amber-800"
              title="Fornecedor"
            >
              Fornecedor
            </span>
          )}
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

          {isAdmin && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(true)
              }}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Excluir este lead"
              aria-label="Excluir este lead"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab" />
        </div>
      </div>

      {/* Telefone, Empresa e Pessoa de Contato */}
      <div className="space-y-1 text-xs text-slate-500">
        <div className="flex items-center gap-1.5 font-medium text-slate-700">
          <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{customer.phone}</span>
        </div>

        {/* Empresa */}
        {customer.company && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
            <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="truncate">{customer.company}</span>
          </div>
        )}

        {/* Pessoa de Contato */}
        {hasContactPerson && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
            <User className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="truncate font-medium">{rawContactName}</span>
          </div>
        )}

        {/* Motivo de perda resumido no card caso esteja em Perdido */}
        {columnId === 'perdido' && customer.lost_reason && (
          <div className="mt-1.5 bg-rose-50 border border-rose-100 rounded-md p-1.5 text-[11px] text-rose-800 leading-tight">
            <span className="font-semibold block text-[10px] text-rose-600 uppercase">
              Motivo da perda:
            </span>
            <span className="line-clamp-2">{customer.lost_reason}</span>
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

      {/* Confirmação de Exclusão de Lead (apenas admin) */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este lead?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(false)
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(false)
                if (onDelete) {
                  onDelete(customer.id, customer.name)
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
