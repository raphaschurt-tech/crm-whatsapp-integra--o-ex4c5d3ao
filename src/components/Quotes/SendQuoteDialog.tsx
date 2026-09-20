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
import {
  Send,
  Download,
  FileText,
  MessageCircle,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { Quote, QuoteItem, Customer } from '@/types/crm'
import {
  formatCurrency,
  openWhatsApp,
  cleanPhoneNumber,
  buildDetailedQuoteMessage,
} from '@/lib/whatsapp'
import {
  generateQuotePdfBase64,
  generateQuotePdfBase64Async,
  downloadQuotePdf,
  downloadQuotePdfAsync,
} from '@/services/quotePdfService'
import { sendWhatsAppMessage, updateQuoteStatus } from '@/services/quotes'
import { updateCustomer } from '@/services/customers'
import { toast } from '@/hooks/use-toast'

interface SendQuoteDialogProps {
  isOpen: boolean
  onClose: () => void
  quote: Quote
  items: QuoteItem[]
  customer?: Customer | null
  onSuccess?: () => void
}

export const SendQuoteDialog: React.FC<SendQuoteDialogProps> = ({
  isOpen,
  onClose,
  quote,
  items,
  customer,
  onSuccess,
}) => {
  const resolvedCustomer = customer || quote.expand?.customer
  const defaultPhone = resolvedCustomer?.phone || ''
  const [targetPhone, setTargetPhone] = useState(defaultPhone)

  // Montar mensagem prévia (sem link de pagamento, conforme solicitação do cliente)
  const itemsListForMsg = items.map((it) => ({
    name: it.expand?.product?.name || it.product || 'Item',
    quantity: it.quantity,
    unitPrice: it.unit_price,
    total: it.total,
  }))

  const defaultMessage = buildDetailedQuoteMessage(
    quote.number,
    resolvedCustomer?.name || 'Cliente',
    itemsListForMsg,
    quote.subtotal || quote.total,
    quote.discount || 0,
    quote.total,
  )

  const [messageText, setMessageText] = useState(defaultMessage)
  const [includePdf, setIncludePdf] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendResultInfo, setSendResultInfo] = useState<{
    success: boolean
    viaZapi: boolean
    docSent: boolean
    docError?: string | null
    fallbackWaMe?: boolean
  } | null>(null)

  const handleDownloadPdf = async () => {
    try {
      await downloadQuotePdfAsync({
        quote,
        items,
        customer: resolvedCustomer,
      })
      toast({
        title: 'Download iniciado',
        description: `PDF do orçamento ${quote.number} baixado com sucesso!`,
      })
    } catch (err: any) {
      console.error('Erro ao gerar PDF para download:', err)
      // Fallback síncrono
      try {
        downloadQuotePdf({
          quote,
          items,
          customer: resolvedCustomer,
        })
      } catch (syncErr: any) {
        toast({
          title: 'Erro ao gerar PDF',
          description: syncErr.message || 'Falha ao processar arquivo.',
          variant: 'destructive',
        })
      }
    }
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
      let docBase64: string | undefined
      if (includePdf) {
        try {
          docBase64 = await generateQuotePdfBase64Async({
            quote,
            items,
            customer: resolvedCustomer,
          })
        } catch (pdfErr) {
          console.warn('Erro ao gerar PDF assíncrono com logo, tentando síncrono:', pdfErr)
          try {
            docBase64 = generateQuotePdfBase64({
              quote,
              items,
              customer: resolvedCustomer,
            })
          } catch (syncErr) {
            console.warn('Erro ao gerar PDF em base64:', syncErr)
          }
        }
      }

      const safeFileName = `${(quote.number || 'orcamento').replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`

      let viaZapi = false
      let docSent = false
      let docError: string | null = null
      let fallbackWaMe = false

      try {
        const sendRes = await sendWhatsAppMessage(
          targetPhone,
          messageText,
          docBase64
            ? {
                document: docBase64,
                fileName: safeFileName,
              }
            : undefined,
        )

        if (sendRes.ok && sendRes.zapiSuccess) {
          viaZapi = true
          docSent = Boolean(sendRes.docSent)
          docError = sendRes.docError || null
        } else {
          // Z-API não configurada ou erro: abre fallback wa.me
          fallbackWaMe = true
          openWhatsApp(targetPhone, messageText)
        }
      } catch (err: any) {
        console.warn('Backend Z-API indisponível, abrindo wa.me fallback:', err)
        fallbackWaMe = true
        openWhatsApp(targetPhone, messageText)
      }

      // Ao enviar, atualizar status do orçamento para "enviado" se for diferente
      if (quote.status !== 'enviado' && quote.status !== 'aprovado' && quote.status !== 'pago') {
        try {
          await updateQuoteStatus(quote.id, 'enviado')
        } catch (statusErr) {
          console.warn('Erro ao atualizar status do orçamento:', statusErr)
        }
      }

      // Atualizar pipeline_status do cliente para "orcamento_enviado"
      const targetCustId = resolvedCustomer?.id || quote.customer
      if (targetCustId) {
        try {
          await updateCustomer(targetCustId, {
            pipeline_status: 'orcamento_enviado',
          })
        } catch (pipeErr) {
          console.warn('Erro ao atualizar pipeline_status do cliente no SendQuoteDialog:', pipeErr)
        }
      }

      setSendResultInfo({
        success: true,
        viaZapi,
        docSent,
        docError,
        fallbackWaMe,
      })

      toast({
        title: 'Orçamento Enviado!',
        description: viaZapi
          ? docSent
            ? `Enviado com sucesso via WhatsApp conectado (texto + PDF anexo).`
            : `Texto enviado com sucesso pelo WhatsApp conectado. O PDF pode ser baixado se desejar.`
          : `Orçamento salvo como 'Enviado' e preparado no WhatsApp Web.`,
      })

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      console.error('Erro ao despachar orçamento:', err)
      toast({
        title: 'Falha no envio',
        description: err.message || 'Não foi possível despachar o orçamento.',
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0 overflow-hidden bg-white">
        <DialogHeader className="p-5 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-emerald-600" />
                Enviar Orçamento ao Cliente
              </DialogTitle>
              <p className="text-xs text-slate-500">
                Orçamento <strong>{quote.number}</strong> • Valor Total:{' '}
                <strong className="text-emerald-700">{formatCurrency(quote.total)}</strong>
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              className="text-xs text-slate-700 border-slate-300 hover:bg-slate-100"
            >
              <Download className="h-3.5 w-3.5 mr-1 text-emerald-600" />
              Baixar PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
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

          {/* Opção PDF */}
          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-700" />
                <span className="font-bold text-emerald-950 text-xs">
                  PDF Oficial do Orçamento (RPA Auto Parts)
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDownloadPdf}
                className="h-6 text-[11px] text-emerald-800 hover:bg-emerald-100/60 font-semibold"
              >
                <Download className="h-3 w-3 mr-1" /> Prévia / Download
              </Button>
            </div>
            <p className="text-[11px] text-slate-600">
              O layout limpo inclui cabeçalho oficial, número do orçamento, cliente, itens
              detalhados com quantidade, preço unitário, total e validade.
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                id="includePdfCheck"
                checked={includePdf}
                onChange={(e) => setIncludePdf(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label
                htmlFor="includePdfCheck"
                className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
              >
                Anexar documento PDF no envio pelo WhatsApp (quando suportado pela API)
              </label>
            </div>
          </div>

          {/* Mensagem em Texto Formatado */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Mensagem em Texto Formatado</Label>
              <button
                type="button"
                onClick={() => setMessageText(defaultMessage)}
                className="text-[11px] text-emerald-700 hover:underline font-medium"
              >
                Restaurar texto padrão
              </button>
            </div>
            <Textarea
              rows={8}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="font-mono text-xs leading-relaxed bg-slate-50/60 resize-y"
            />
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
                    ? 'Mensagem despachada com sucesso pela conexão WhatsApp RPA'
                    : 'Mensagem preparada via WhatsApp Web (fallback wa.me)'}
                </span>
              </div>
              {sendResultInfo.viaZapi && sendResultInfo.docSent && (
                <p className="text-[11px] text-emerald-700">
                  ✓ O arquivo PDF do orçamento foi anexado e entregue como documento.
                </p>
              )}
              {sendResultInfo.viaZapi && !sendResultInfo.docSent && includePdf && (
                <p className="text-[11px] text-amber-700">
                  ℹ O texto foi enviado. Para o arquivo, use o botão "Baixar PDF" para enviar o
                  documento manualmente se necessário.
                </p>
              )}
              <p className="text-[11px] text-slate-600">
                O status do orçamento foi atualizado para <strong>"ENVIADO"</strong>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>
            Fechar
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              className="text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Baixar PDF
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
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Enviar WhatsApp
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
