import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Send, MessageCircle, Copy, Check, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'
import { Quote, Customer } from '@/types/crm'
import { formatCurrency, openWhatsApp, buildPaymentLinkMessage } from '@/lib/whatsapp'
import { sendWhatsAppMessage } from '@/services/quotes'
import { toast } from '@/hooks/use-toast'

interface SendPaymentLinkDialogProps {
  isOpen: boolean
  onClose: () => void
  quote: Quote
  customer?: Customer | null
  onSuccess?: () => void
}

export const SendPaymentLinkDialog: React.FC<SendPaymentLinkDialogProps> = ({
  isOpen,
  onClose,
  quote,
  customer,
  onSuccess,
}) => {
  const resolvedCustomer = customer || quote.expand?.customer
  const defaultPhone = resolvedCustomer?.phone || ''
  const [targetPhone, setTargetPhone] = useState(defaultPhone)

  const paymentLink = quote.payment_token
    ? `${window.location.origin}/pagamento/${quote.id}?token=${quote.payment_token}`
    : `${window.location.origin}/pagamento/${quote.id}`

  const defaultMessage = buildPaymentLinkMessage(quote.number, quote.total, paymentLink)

  const [messageText, setMessageText] = useState(defaultMessage)
  const [sending, setSending] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [sendResultInfo, setSendResultInfo] = useState<{
    success: boolean
    viaZapi: boolean
    fallbackWaMe?: boolean
  } | null>(null)

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink)
    setCopiedLink(true)
    toast({
      title: 'Link copiado!',
      description: 'O link de pagamento foi copiado para a área de transferência.',
    })
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const handleSendWhatsApp = async () => {
    if (!targetPhone.trim()) {
      toast({
        title: 'Telefone obrigatório',
        description: 'Informe o número de telefone com DDD do cliente.',
        variant: 'destructive',
      })
      return
    }

    setSending(true)
    setSendResultInfo(null)

    try {
      let viaZapi = false
      let fallbackWaMe = false

      try {
        const sendRes = await sendWhatsAppMessage(targetPhone, messageText)
        if (sendRes.ok && sendRes.zapiSuccess) {
          viaZapi = true
        } else {
          fallbackWaMe = true
          openWhatsApp(targetPhone, messageText)
        }
      } catch (err: any) {
        console.warn('Backend Z-API indisponível, abrindo wa.me fallback:', err)
        fallbackWaMe = true
        openWhatsApp(targetPhone, messageText)
      }

      setSendResultInfo({
        success: true,
        viaZapi,
        fallbackWaMe,
      })

      toast({
        title: 'Link de pagamento enviado!',
        description: viaZapi
          ? 'Mensagem com link de pagamento enviada via WhatsApp conectado.'
          : 'Link de pagamento preparado no WhatsApp Web.',
      })

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      console.error('Erro ao enviar link de pagamento:', err)
      toast({
        title: 'Falha no envio',
        description: err.message || 'Não foi possível despachar o link de pagamento.',
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl flex flex-col p-0 overflow-hidden bg-white">
        <DialogHeader className="p-5 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-emerald-600" />
                Enviar Link de Pagamento
              </DialogTitle>
              <p className="text-xs text-slate-500">
                Orçamento <strong>{quote.number}</strong> • Total a pagar:{' '}
                <strong className="text-emerald-700">{formatCurrency(quote.total)}</strong>
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 text-xs">
          {/* Destinatário */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Cliente</Label>
              <Input
                value={resolvedCustomer?.name || 'Cliente'}
                readOnly
                className="bg-slate-50 text-xs font-medium"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">WhatsApp / Telefone *</Label>
              <Input
                value={targetPhone}
                onChange={(e) => setTargetPhone(e.target.value)}
                placeholder="Ex: 5511999999999 ou (11) 98765-4321"
                className="text-xs font-medium"
              />
            </div>
          </div>

          {/* Link direto */}
          <div className="space-y-1.5 p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl">
            <Label className="text-xs font-semibold text-emerald-950 flex items-center justify-between">
              <span>Link de Pagamento Online</span>
              <a
                href={paymentLink}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:underline flex items-center gap-0.5 text-[11px] font-medium"
              >
                Abrir link <ExternalLink className="h-3 w-3" />
              </a>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={paymentLink}
                readOnly
                className="text-xs bg-white border-emerald-200 font-mono text-slate-700"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="shrink-0 text-xs border-emerald-300 hover:bg-emerald-100/50"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copiar Link
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Mensagem em Texto Editável */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Mensagem do WhatsApp (Editável)</Label>
              <button
                type="button"
                onClick={() => setMessageText(defaultMessage)}
                className="text-[11px] text-emerald-700 hover:underline font-medium"
              >
                Restaurar texto padrão
              </button>
            </div>
            <Textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="font-mono text-xs leading-relaxed bg-slate-50/60 resize-y"
              placeholder="Digite a mensagem para o cliente..."
            />
            <p className="text-[11px] text-slate-500">
              Esta mensagem envia SOMENTE o link de pagamento com o texto acima, sem o PDF e sem a
              listagem de itens.
            </p>
          </div>

          {/* Feedback pós-envio se houver */}
          {sendResultInfo && (
            <div
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                sendResultInfo.viaZapi
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>
                  {sendResultInfo.viaZapi
                    ? 'Link de pagamento enviado com sucesso via WhatsApp conectado'
                    : 'Mensagem preparada via WhatsApp Web (fallback wa.me)'}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>
            Fechar
          </Button>

          <Button
            type="button"
            onClick={handleSendWhatsApp}
            disabled={sending || !targetPhone.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs"
          >
            {sending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Enviando link...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Enviar Link via WhatsApp
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
