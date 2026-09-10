import React from 'react'
import {
  X,
  Phone,
  Mail,
  Building2,
  FileText,
  User,
  MessageCircle,
  ExternalLink,
  Sparkles,
  CheckCheck,
  Calendar,
  DollarSign,
  ArrowRight,
  RotateCcw,
} from 'lucide-react'
import { PipelineCardData, PIPELINE_COLUMNS, PipelineColumnId } from '@/services/pipelineService'
import { formatCurrency, openWhatsApp } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import { LeadSourceBadge } from '@/components/LeadSourceBadge'

interface PipelineCustomerDrawerProps {
  card: PipelineCardData | null
  onClose: () => void
  onMoveColumn: (customerId: string, targetCol: PipelineColumnId) => void
  onResetAuto: (customerId: string) => void
}

export const PipelineCustomerDrawer: React.FC<PipelineCustomerDrawerProps> = ({
  card,
  onClose,
  onMoveColumn,
  onResetAuto,
}) => {
  const navigate = useNavigate()

  if (!card) return null

  const { customer, columnId, isManualOverride, allQuotes, whatsappConversation } = card
  const resolvedType = customer.type || (customer.cnpj ? 'PJ' : 'PF')
  const currentColumnDef = PIPELINE_COLUMNS.find((c) => c.id === columnId)

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                    resolvedType === 'PJ'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {resolvedType}
                </span>
                <LeadSourceBadge source={customer.lead_source} size="md" />
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    currentColumnDef?.badgeBg || 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {currentColumnDef?.label}
                </span>
                {isManualOverride && (
                  <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                    Manual
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-slate-900">{customer.name}</h2>
              <p className="text-xs text-slate-500">
                Cadastrado em {new Date(customer.created).toLocaleDateString('pt-BR')} • Última
                interação: {card.lastInteractionText}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 shrink-0"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Quick Actions Bar */}
          <div className="px-5 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2 overflow-x-auto text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Mover:</span>
              <select
                aria-label="Mover de coluna no pipeline"
                value={columnId}
                onChange={(e) => onMoveColumn(customer.id, e.target.value as PipelineColumnId)}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white font-medium text-slate-700"
              >
                {PIPELINE_COLUMNS.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {isManualOverride && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResetAuto(customer.id)}
                  className="h-7 text-xs text-slate-600"
                  title="Voltar ao cálculo automático pelo sistema"
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Auto
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => openWhatsApp(customer.phone, `Olá, ${customer.name}!`)}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/clientes/${customer.id}`)}
                className="h-7 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" /> Cadastro
              </Button>
            </div>
          </div>

          {/* Body Content with Tabs or Sections */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Seção 1: Dados Cadastrais */}
            <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Dados Cadastrais
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Telefone</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                    <Phone className="h-3.5 w-3.5 text-emerald-600" />
                    {customer.phone}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">E-mail</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5 truncate">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {customer.email || 'Não informado'}
                  </span>
                </div>

                {customer.cpf && (
                  <div>
                    <span className="text-slate-400 block font-medium">CPF</span>
                    <span className="font-mono font-semibold text-slate-800 mt-0.5 block">
                      {customer.cpf}
                    </span>
                  </div>
                )}

                {customer.cnpj && (
                  <div>
                    <span className="text-slate-400 block font-medium">CNPJ</span>
                    <span className="font-mono font-semibold text-slate-800 mt-0.5 block">
                      {customer.cnpj}
                    </span>
                  </div>
                )}

                {customer.company && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block font-medium">Empresa</span>
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                      <Building2 className="h-3.5 w-3.5 text-slate-500" />
                      {customer.company}
                    </span>
                  </div>
                )}

                {customer.contact_name && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block font-medium">Pessoa de Contato</span>
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                      <User className="h-3.5 w-3.5 text-emerald-600" />
                      {customer.contact_name}
                    </span>
                  </div>
                )}

                {customer.notes && (
                  <div className="col-span-2 bg-white p-2.5 rounded border border-slate-200 mt-1">
                    <span className="text-[11px] text-slate-400 font-medium block mb-1">
                      Observações:
                    </span>
                    <p className="text-slate-700 whitespace-pre-wrap">{customer.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Seção 2: Orçamentos do Cliente */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Orçamentos ({allQuotes.length})
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/orcamentos/novo?customerId=${customer.id}`)}
                  className="h-7 text-xs text-emerald-700 hover:text-emerald-800 font-semibold"
                >
                  + Novo Orçamento
                </Button>
              </div>

              {allQuotes.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 border-dashed rounded-lg p-4 text-center text-xs text-slate-500">
                  Nenhum orçamento cadastrado para este cliente.
                </div>
              ) : (
                <div className="space-y-2">
                  {allQuotes.map((quote) => (
                    <div
                      key={quote.id}
                      onClick={() => navigate(`/orcamentos/${quote.id}`)}
                      className="bg-white border border-slate-200 hover:border-emerald-300 rounded-lg p-3 transition-colors cursor-pointer group flex items-center justify-between shadow-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors text-sm">
                            {quote.number}
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold">
                            {quote.status}
                          </Badge>
                          {quote.payment_link && (
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.2 rounded font-medium">
                              Link Gerado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(quote.created).toLocaleDateString('pt-BR')}
                          {quote.notes && ` • ${quote.notes}`}
                        </p>
                      </div>

                      <div className="text-right flex items-center gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {formatCurrency(quote.total || 0)}
                          </p>
                          <span className="text-[10px] text-slate-400">Ver detalhes</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Seção 3: Histórico de Conversas do WhatsApp */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  Histórico WhatsApp (
                  {whatsappConversation ? whatsappConversation.messages.length : 0})
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate('/atendimento')}
                  className="h-7 text-xs text-slate-600 hover:text-slate-900"
                >
                  Ir para Atendimento
                </Button>
              </div>

              {!whatsappConversation || whatsappConversation.messages.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 border-dashed rounded-lg p-5 text-center text-xs text-slate-500 space-y-1">
                  <p>Nenhuma mensagem do WhatsApp sincronizada para este telefone.</p>
                  <p className="text-[11px] text-slate-400 font-mono">{customer.phone}</p>
                </div>
              ) : (
                <div className="bg-[#efeae2]/30 border border-slate-200 rounded-xl p-3 max-h-80 overflow-y-auto space-y-2.5">
                  {whatsappConversation.messages.map((msg) => {
                    const isClient = msg.sender === 'client'
                    const isAi = msg.sender === 'ai'

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-xs shadow-xs ${
                            isClient
                              ? 'bg-[#d9fdd3] text-slate-900 border border-[#c1e8ba] rounded-tr-xs'
                              : 'bg-white text-slate-900 border border-slate-200 rounded-tl-xs'
                          }`}
                        >
                          {!isClient && (
                            <div className="flex items-center gap-1 mb-1">
                              {isAi ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                                  <Sparkles className="w-2.5 h-2.5 text-emerald-600" /> Assistente
                                  IA
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-slate-600">
                                  Atendente RPA
                                </span>
                              )}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>

                          <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-slate-500">
                            <span>{msg.time}</span>
                            {isClient && <CheckCheck className="w-3 h-3 text-emerald-600 inline" />}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Valor Total em Orçamentos:{' '}
              <strong className="text-slate-900">{formatCurrency(card.totalQuoteAmount)}</strong>
            </span>
            <Button variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
