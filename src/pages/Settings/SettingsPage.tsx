import { useEffect, useState } from 'react'
import {
  Save,
  Settings as SettingsIcon,
  Bot,
  MessageSquare,
  Key,
  Smartphone,
  Sparkles,
  HelpCircle,
} from 'lucide-react'
import { getSettings, saveSettings } from '@/services/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

export default function SettingsPage() {
  // Configurações Gerais
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [stockApiUrl, setStockApiUrl] = useState('')
  const [paymentLinkTemplate, setPaymentLinkTemplate] = useState('')

  // Configurações de Atendimento IA
  const [aiEnabled, setAiEnabled] = useState(false)
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [zapiInstanceId, setZapiInstanceId] = useState('')
  const [zapiToken, setZapiToken] = useState('')
  const [zapiClientToken, setZapiClientToken] = useState('')
  const [aiSystemPrompt, setAiSystemPrompt] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const defaultPromptTemplate = `Você é o assistente virtual de atendimento comercial inteligente da empresa CRM Intragan.
Seu objetivo é atender os clientes de forma educada, prestativa, ágil e profissional via WhatsApp.
Você pode tirar dúvidas sobre produtos, estoque atual, preços e condições de pagamento.
Sempre informe valores em Reais (R$).
Quando o cliente quiser fechar um pedido, solicitar desconto especial ou precisar de suporte avançado que não consiga resolver, informe educadamente que você irá transferir para um atendente humano da equipe comercial.`

  useEffect(() => {
    getSettings().then((s) => {
      if (s) {
        setWhatsappNumber(s.whatsapp_number || '')
        setStockApiUrl(s.stock_api_url || '')
        setPaymentLinkTemplate(s.payment_link_template || '')
        setAiEnabled(!!s.ai_enabled)
        setOpenaiApiKey(s.openai_api_key || '')
        setZapiInstanceId(s.zapi_instance_id || '')
        setZapiToken(s.zapi_token || '')
        setZapiClientToken(s.zapi_client_token || '')
        setAiSystemPrompt(s.ai_system_prompt || '')
      }
      setLoading(false)
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await saveSettings({
        whatsapp_number: whatsappNumber,
        stock_api_url: stockApiUrl,
        payment_link_template: paymentLinkTemplate,
        ai_enabled: aiEnabled,
        openai_api_key: openaiApiKey,
        zapi_instance_id: zapiInstanceId,
        zapi_token: zapiToken,
        zapi_client_token: zapiClientToken,
        ai_system_prompt: aiSystemPrompt,
      })
      toast({ title: 'Configurações salvas com sucesso!' })
    } catch (_) {
      toast({ title: 'Erro ao salvar configurações', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleUseDefaultPrompt = () => {
    setAiSystemPrompt(defaultPromptTemplate)
  }

  if (loading)
    return <div className="p-8 text-center text-slate-500">Carregando configurações...</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-6 w-6 text-slate-700" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configurações do Sistema</h1>
          <p className="text-sm text-slate-500">
            Gerencie integrações, canais de atendimento e automação inteligente
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Seção 1: Atendimento IA no WhatsApp */}
        <Card className="border-emerald-200 shadow-sm bg-gradient-to-b from-white to-emerald-50/20">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold text-slate-900">
                      Atendimento Automatizado por IA
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        aiEnabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }
                    >
                      {aiEnabled ? 'Ativo' : 'Desativado'}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Chatbot integrado ao WhatsApp para consultar estoque, preços e responder dúvidas
                    de clientes
                  </CardDescription>
                </div>
              </div>

              {/* Toggle Ligar/Desligar */}
              <div className="flex items-center gap-3 bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-xs">
                <Label
                  htmlFor="ai-toggle"
                  className="text-sm font-semibold cursor-pointer text-slate-700"
                >
                  {aiEnabled ? 'Robô Ativo' : 'Robô Desativado'}
                </Label>
                <Switch id="ai-toggle" checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Chave OpenAI */}
              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                    <Key className="h-4 w-4 text-emerald-600" /> Chave da API OpenAI (API Key)
                  </Label>
                  <span className="text-xs text-slate-400">sk-...</span>
                </div>
                <Input
                  type="password"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Chave de acesso da OpenAI (GPT-4o-mini). Se não preenchida, o sistema utilizará o
                  motor nativo integrado.
                </p>
              </div>

              {/* Z-API Instance ID */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  <Smartphone className="h-4 w-4 text-emerald-600" /> ID da Instância Z-API
                </Label>
                <Input
                  value={zapiInstanceId}
                  onChange={(e) => setZapiInstanceId(e.target.value)}
                  placeholder="Ex: 3B4C5D6E7F8G9H0"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Instance ID gerado no painel da sua conta Z-API.
                </p>
              </div>

              {/* Z-API Token */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  <Key className="h-4 w-4 text-emerald-600" /> Token da Instância Z-API
                </Label>
                <Input
                  type="password"
                  value={zapiToken}
                  onChange={(e) => setZapiToken(e.target.value)}
                  placeholder="Ex: 8A7B6C5D4E3F2G1"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Token de autenticação da instância na Z-API.
                </p>
              </div>

              {/* Z-API Client Token */}
              <div className="space-y-1.5 md:col-span-2">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  <Key className="h-4 w-4 text-emerald-600" /> Client Token Z-API (Opcional para
                  segurança extra)
                </Label>
                <Input
                  type="password"
                  value={zapiClientToken}
                  onChange={(e) => setZapiClientToken(e.target.value)}
                  placeholder="Client-Token de segurança da conta"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Cabeçalho Client-Token configurado na sua conta Z-API, caso ativado no provedor.
                </p>
              </div>
            </div>

            {/* Prompt de Sistema Customizado */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  <Sparkles className="h-4 w-4 text-emerald-600" /> Prompt de Sistema Personalizado
                  para a IA
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleUseDefaultPrompt}
                  className="text-xs text-emerald-600 hover:text-emerald-700 h-7 px-2"
                >
                  Usar modelo padrão
                </Button>
              </div>
              <Textarea
                rows={5}
                value={aiSystemPrompt}
                onChange={(e) => setAiSystemPrompt(e.target.value)}
                placeholder="Descreva a personalidade, diretrizes, instruções de tom de voz e como a IA deve se comportar ao atender clientes no WhatsApp..."
                className="bg-white font-sans text-sm leading-relaxed"
              />
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold flex items-center gap-1 text-slate-700">
                  <HelpCircle className="h-3.5 w-3.5" /> Informações automáticas inseridas no
                  contexto:
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-500">
                  <li>
                    Lista completa de produtos cadastrados com seus respectivos SKUs, preços e
                    quantidade em estoque.
                  </li>
                  <li>
                    Identificação do nome do cliente caso o número de telefone já esteja na base de
                    contatos.
                  </li>
                  <li>
                    Orientação para encaminhar a conversa para atendimento humano sempre que
                    necessário.
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Seção 2: Integrações Gerais e Links */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-slate-700" />
              <CardTitle className="text-lg font-bold text-slate-900">
                Parâmetros Gerais do CRM
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-slate-500">
              Número de contato padrão e endpoints auxiliares
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Número padrão do WhatsApp da Empresa</Label>
              <Input
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="5511999998888"
              />
              <p className="text-xs text-slate-500">
                Usado como remetente/contato de apoio nas mensagens de orçamentos e comprovantes.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>URL da API Externa de Estoque</Label>
              <Input
                value={stockApiUrl}
                onChange={(e) => setStockApiUrl(e.target.value)}
                placeholder="https://dummyjson.com/products"
              />
              <p className="text-xs text-slate-500">
                Endpoint para consulta e sincronização em tempo real de produtos.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Modelo de Link de Pagamento (Opcional)</Label>
              <Input
                value={paymentLinkTemplate}
                onChange={(e) => setPaymentLinkTemplate(e.target.value)}
                placeholder="Deixe em branco para usar a página interna de checkout"
              />
              <p className="text-xs text-slate-500">
                Pode usar espaço para gateway customizado. Ex: https://gateway.com/pay/{'{id}'}
                ?token={'{token}'}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={saving}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow px-6 py-2.5"
          >
            <Save className="mr-1.5 h-4 w-4" />{' '}
            {saving ? 'Salvando...' : 'Salvar Todas as Configurações'}
          </Button>
        </div>
      </form>
    </div>
  )
}
