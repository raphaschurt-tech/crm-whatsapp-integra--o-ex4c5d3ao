import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export const LOST_REASON_OPTIONS = [
  'Preço — cliente achou caro / encontrou mais barato em outro lugar',
  'Comprou com concorrente — cliente comprou com outra empresa e não falou o motivo',
  'Não respondemos a tempo — demoramos muito para responder o cliente',
  'Cliente desistiu — cliente mudou de ideia ou não precisa mais',
  'Não tínhamos a peça — não trabalhamos com a peça solicitada',
  'Cliente sumiu — parou de responder e não voltou mais',
  'Sem estoque — trabalhamos com a peça mas não tínhamos em estoque',
] as const

export type LostReasonOption = (typeof LOST_REASON_OPTIONS)[number]

interface LostReasonModalProps {
  isOpen: boolean
  customerName: string
  onClose: () => void
  onConfirm: (data: { reason: string; detail?: string }) => void
  isSubmitting?: boolean
}

export const LostReasonModal: React.FC<LostReasonModalProps> = ({
  isOpen,
  customerName,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>('')
  const [detail, setDetail] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Reset do estado ao abrir o modal
  useEffect(() => {
    if (isOpen) {
      setSelectedReason('')
      setDetail('')
      setErrorMessage(null)
    }
  }, [isOpen])

  const handleConfirm = () => {
    if (!selectedReason) {
      setErrorMessage('Por favor, selecione um dos motivos de perda para continuar.')
      return
    }
    setErrorMessage(null)
    onConfirm({
      reason: selectedReason,
      detail: detail.trim() ? detail.trim() : undefined,
    })
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 border-b border-slate-100 bg-rose-50/50">
          <div className="flex items-center gap-2 text-rose-700 mb-1">
            <AlertCircle className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-wider">
              Mover lead para Perdido
            </span>
          </div>
          <DialogTitle className="text-lg font-bold text-slate-950">
            Qual o motivo da perda do lead?
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600 mt-1">
            Lead: <strong className="text-slate-800">{customerName}</strong>. A seleção do motivo é
            obrigatória para alimentar os relatórios de perda de vendas.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Selecione o motivo da perda: <span className="text-rose-500">*</span>
            </label>

            <div className="space-y-2">
              {LOST_REASON_OPTIONS.map((option, idx) => {
                const isSelected = selectedReason === option
                return (
                  <div
                    key={option}
                    onClick={() => {
                      setSelectedReason(option)
                      setErrorMessage(null)
                    }}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      isSelected
                        ? 'border-rose-500 bg-rose-50/60 text-rose-950 shadow-xs ring-1 ring-rose-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 text-slate-700'
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-all ${
                        isSelected
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 leading-snug">
                      <span className="font-semibold block text-slate-900 mb-0.5">
                        {idx + 1}. {option.split(' — ')[0]}
                      </span>
                      <span className="text-slate-600 text-[11px] block">
                        {option.split(' — ')[1] || option}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="lost-reason-detail"
              className="text-xs font-semibold text-slate-700 block"
            >
              Observação / Detalhe complementar{' '}
              <span className="text-slate-400 font-normal">(opcional)</span>:
            </label>
            <Textarea
              id="lost-reason-detail"
              placeholder="Ex: Peça solicitada: Bomba de alta pressão Amarok 2.0; concorrente ofertou R$ 450, etc."
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              className="text-xs resize-none min-h-[70px] bg-slate-50 border-slate-200 focus:bg-white"
            />
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={!selectedReason || isSubmitting}
            className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-medium"
          >
            {isSubmitting ? 'Salvando...' : 'Confirmar Motivo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
