import { useEffect, useMemo, useState } from 'react'
import {
  Save,
  Settings as SettingsIcon,
  Bot,
  MessageSquare,
  Key,
  Smartphone,
  Sparkles,
  HelpCircle,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Layers,
  AlertTriangle,
  FileText,
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react'
import { getSettings, saveSettings } from '@/services/settings'
import { getProducts } from '@/services/products'
import { Product } from '@/types/crm'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/pocketbase/errors'
export default function SettingsPage() {
  // Configurações Gerais
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [stockApiUrl, setStockApiUrl] = useState('')
  const [paymentLinkTemplate, setPaymentLinkTemplate] = useState('')

  // Configurações de Atendimento IA
  const [aiEnabled, setAiEnabled] = useState(false)
  const [authorizedTestPhone, setAuthorizedTestPhone] = useState('5511947518805')
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [zapiInstanceId, setZapiInstanceId] = useState('')
  const [zapiToken, setZapiToken] = useState('')
  const [zapiClientToken, setZapiClientToken] = useState('')
  const [aiSystemPrompt, setAiSystemPrompt] = useState('')
  const [aiPaymentMethods, setAiPaymentMethods] = useState('')
  const [aiAutoCloseMinutes, setAiAutoCloseMinutes] = useState<number>(60)
  const [aiAutoCloseMessage, setAiAutoCloseMessage] = useState('')
  const [aiExcludedSkus, setAiExcludedSkus] = useState('')
  const [allowedFamilies, setAllowedFamilies] = useState<string[]>([])
  const [productsList, setProductsList] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  // PROMPT 2: CNPJ da Empresa (S7), Margens por Família (S4) e Fase de Estoque (F4)
  const [companyCnpj, setCompanyCnpj] = useState('')
  const [familyMarginsJson, setFamilyMarginsJson] = useState('{"default": 1.4}')
  const [stockPhase, setStockPhase] = useState<'souis_master' | 'crm_cutover'>('souis_master')

  // FASE 2 DFe: Certificado Digital A1 & Captura Automática (D7, D8, D9, CF-1c, G5)
  const [dfeEnabled, setDfeEnabled] = useState<boolean>(false)
  const [dfeAutoLaunch, setDfeAutoLaunch] = useState<boolean>(false)
  const [dfePollInterval, setDfePollInterval] = useState<number>(1)
  const [dfeToken, setDfeToken] = useState<string>('')
  const [dfeTokenActive, setDfeTokenActive] = useState<boolean>(false)
  const [generatingToken, setGeneratingToken] = useState<boolean>(false)
  const [dfePointer, setDfePointer] = useState<any>(null)
  const [newlyGeneratedToken, setNewlyGeneratedToken] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [dfeCapturedCount, setDfeCapturedCount] = useState<number>(0)
  const [dfePayablesCount, setDfePayablesCount] = useState<number>(0)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingAi, setTogglingAi] = useState(false)

  // Estado do Teste de Conexão
  const [testingConnection, setTestingConnection] = useState(false)
  const [configuringWebhook, setConfiguringWebhook] = useState(false)
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'error'
    webhookOk?: boolean
    zapiOk?: boolean
    connected?: boolean
    phone?: string
    message?: string
  }>({ status: 'idle' })

  // Estado do Teste Unitário da IA (Busca & Relevância de Produtos)
  const [runningAiUnitTest, setRunningAiUnitTest] = useState(false)
  const [aiUnitTestResult, setAiUnitTestResult] = useState<{
    success: boolean
    details: string[]
  } | null>(null)

  const defaultPromptTemplate = `Você é o assistente virtual da RPA AUTO PARTS, indústria de peças de suspensão.
Atenda clientes via WhatsApp de forma cordial, ágil e profissional.
Cumprimente o cliente na primeira mensagem da conversa.
Use a ferramenta buscar_produtos para consultar peças no catálogo sempre que o cliente perguntar por itens, SKUs ou aplicações automotivas.
REGRA CRÍTICA DE PRODUTO E ESTOQUE:
1. Estoque 0 NUNCA filtra fora e NUNCA informe que a peça está indisponível. Para estoque 0 informe sempre "disponível em até 48 horas" (sob encomenda). O preço de venda deve ser informado normalmente se for maior que zero;
2. Preço 0 ou sem preço: informe "Sob consulta" no lugar do valor;
3. Caso composto (preço 0 E estoque 0): informe os dois avisos juntos ("Sob consulta" e "disponível em até 48 horas");
4. Quando estoque > 0: informe a quantidade disponível (ex.: "6 un.") e o preço;
5. É terminantemente PROIBIDO usar a palavra "indisponível" em qualquer resposta.`

  const loadSettingsData = async () => {
    setLoading(true)
    try {
      setLoadingProducts(true)
      const [s, prods] = await Promise.all([getSettings(), getProducts()])
      setProductsList(prods)
      if (s) {
        setWhatsappNumber(s.whatsapp_number || '')
        setStockApiUrl(s.stock_api_url || '')
        setPaymentLinkTemplate(s.payment_link_template || '')
        setAiEnabled(!!s.ai_enabled)
        setAuthorizedTestPhone(s.authorized_test_phone || '5511947518805')
        setAiModel(s.ai_model || 'gpt-4o-mini')
        setOpenaiApiKey(s.openai_api_key || '')
        setZapiInstanceId(s.zapi_instance_id || '')
        setZapiToken(s.zapi_token || '')
        setZapiClientToken(s.zapi_client_token || '')
        setAiSystemPrompt(s.ai_system_prompt || '')
        setAiPaymentMethods(
          s.ai_payment_methods || 'Pix, cartão em até 3x sem juros, link de pagamento',
        )
        setAiAutoCloseMinutes(
          s.ai_auto_close_minutes !== undefined && s.ai_auto_close_minutes !== null
            ? Number(s.ai_auto_close_minutes)
            : 60,
        )
        setAiAutoCloseMessage(
          s.ai_auto_close_message ||
            'Atendimento encerrado por inatividade. Se precisar de algo, me chame aqui que continuo te ajudando! 🙂',
        )
        setAiExcludedSkus((s as any).ai_excluded_skus || '')
        let loadedAllowed: string[] = []
        if (Array.isArray(s.allowed_families)) {
          loadedAllowed = s.allowed_families
        } else if (
          typeof s.allowed_families === 'string' &&
          (s.allowed_families as string).trim()
        ) {
          try {
            const parsed = JSON.parse(s.allowed_families)
            if (Array.isArray(parsed)) loadedAllowed = parsed
          } catch (_) {
            loadedAllowed = (s.allowed_families as string)
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
          }
        }
        setAllowedFamilies(loadedAllowed)
        setCompanyCnpj((s as any).company_cnpj || '')
        if ((s as any).family_margins) {
          const rawM = (s as any).family_margins
          setFamilyMarginsJson(
            typeof rawM === 'object' ? JSON.stringify(rawM, null, 2) : String(rawM),
          )
        }
        setStockPhase((s as any).stock_phase || 'souis_master')
        setDfeEnabled(!!(s as any).dfe_enabled)
        setDfeAutoLaunch(!!(s as any).dfe_auto_launch)
        setDfePollInterval(Number((s as any).dfe_poll_interval_hours) || 1)
        setDfeToken((s as any).dfe_worker_token || '')
        setDfeTokenActive(!!(s as any).dfe_token_active)
      }

      // Carregar estado do ponteiro DFe para status do certificado (D7) e métricas
      try {
        const [ptrRec, histCountRes, payCountRes] = await Promise.all([
          pb.collection('dfe_pointer_state').getList(1, 1, { sort: '-created' }),
          pb.collection('dfe_history').getList(1, 1),
          pb.collection('accounts_payable').getList(1, 1, { filter: "origin = 'dfe'" }),
        ])
        if (ptrRec.items.length > 0) {
          setDfePointer(ptrRec.items[0])
        }
        setDfeCapturedCount(histCountRes.totalItems || 0)
        setDfePayablesCount(payCountRes.totalItems || 0)
      } catch {
        /* intentionally ignored */
      }
    } catch (e) {
      console.warn('Erro ao obter configurações:', e)
    } finally {
      setLoading(false)
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    loadSettingsData()
  }, [])

  // Agrupamento e contagem de produtos por família sou_family, ordenadas por volume decrescente
  const familyStats = useMemo(() => {
    const countsMap = new Map<string, number>()

    for (const p of productsList) {
      const raw = (p.sou_family || '').trim()
      const famName = raw || 'Sem família'
      countsMap.set(famName, (countsMap.get(famName) || 0) + 1)
    }

    const list = Array.from(countsMap.entries()).map(([name, count]) => ({
      name,
      count,
      isNoFamily: name === 'Sem família',
    }))

    // Ordenação: decrescente por volume de produtos, desempate por nome alfabético
    list.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.name.localeCompare(b.name)
    })

    return list
  }, [productsList])

  // Set estável para checagem rápida O(1) de seleção
  const allowedFamiliesSet = useMemo(() => new Set(allowedFamilies), [allowedFamilies])

  const handleToggleFamily = (familyName: string) => {
    setAllowedFamilies((prev) => {
      const exists = prev.includes(familyName)
      if (exists) {
        return prev.filter((f) => f !== familyName)
      } else {
        return [...prev, familyName]
      }
    })
  }

  const handleSelectAllFamilies = () => {
    const allNames = familyStats.map((f) => f.name)
    setAllowedFamilies(allNames)
  }

  const handleClearAllFamilies = () => {
    setAllowedFamilies([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      let parsedFamilyMargins = {}
      if (familyMarginsJson.trim()) {
        try {
          parsedFamilyMargins = JSON.parse(familyMarginsJson)
        } catch (jsonErr) {
          throw new Error(
            'JSON de margens por família inválido: ' +
              (jsonErr instanceof Error ? jsonErr.message : String(jsonErr)),
          )
        }
      }

      await saveSettings({
        whatsapp_number: whatsappNumber,
        stock_api_url: stockApiUrl,
        payment_link_template: paymentLinkTemplate,
        ai_enabled: aiEnabled,
        authorized_test_phone: authorizedTestPhone,
        ai_model: aiModel,
        openai_api_key: openaiApiKey,
        zapi_instance_id: zapiInstanceId,
        zapi_token: zapiToken,
        zapi_client_token: zapiClientToken,
        ai_system_prompt: aiSystemPrompt,
        ai_payment_methods: aiPaymentMethods,
        ai_auto_close_minutes: Number(aiAutoCloseMinutes) || 0,
        ai_auto_close_message: aiAutoCloseMessage,
        ai_excluded_skus: aiExcludedSkus,
        allowed_families: allowedFamilies,
        company_cnpj: companyCnpj.replace(/\D/g, ''),
        family_margins: parsedFamilyMargins,
        stock_phase: stockPhase,
        dfe_enabled: dfeEnabled,
        dfe_auto_launch: dfeAutoLaunch,
        dfe_poll_interval_hours: Number(dfePollInterval) || 1,
      })
      toast({ title: 'Configurações salvas com sucesso!' })
    } catch (err: unknown) {
      const errorDetail = getErrorMessage(err)
      toast({
        title: 'Erro ao salvar configurações',
        description: errorDetail,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleAi = async (newValue: boolean) => {
    // Atualiza imediatamente o estado da UI de forma otimista
    const prevValue = aiEnabled
    setAiEnabled(newValue)
    setTogglingAi(true)

    try {
      // Atualiza apenas o campo ai_enabled diretamente no registro existente
      await saveSettings({ ai_enabled: newValue })
      toast({
        title: newValue ? 'Robô de atendimento ativado' : 'Robô de atendimento desativado',
        description: newValue
          ? 'A IA responderá aos clientes autorizados via WhatsApp.'
          : 'O atendimento automatizado foi pausado.',
      })
    } catch (err: unknown) {
      // Em caso de falha, reverte para o valor anterior
      setAiEnabled(prevValue)
      const errorMsg = err instanceof Error ? err.message : 'Falha ao conectar com o servidor.'
      toast({
        title: 'Erro ao alterar estado do robô',
        description: errorMsg,
        variant: 'destructive',
      })
    } finally {
      setTogglingAi(false)
    }
  }

  const handleUseDefaultPrompt = () => {
    setAiSystemPrompt(defaultPromptTemplate)
  }

  const handleGenerateDfeToken = async () => {
    setGeneratingToken(true)
    try {
      const res = await pb.send<{ success: boolean; token?: string; message: string }>(
        '/backend/v1/dfe/token/manage',
        { method: 'POST', body: { action: 'generate' } },
      )
      if (res.success && res.token) {
        setDfeToken(res.token)
        setDfeTokenActive(true)
        setNewlyGeneratedToken(res.token)
        setCopiedToken(false)
        toast({
          title: 'Token DFe Gerado com Sucesso!',
          description: 'Copie o token e configure no worker Node.js.',
          className: 'bg-emerald-600 text-white',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao gerar token DFe',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setGeneratingToken(false)
    }
  }

  const handleCopyNewToken = async () => {
    if (!newlyGeneratedToken) return
    try {
      await navigator.clipboard.writeText(newlyGeneratedToken)
      setCopiedToken(true)
      toast({
        title: 'Token copiado!',
        description: 'Cole o token no arquivo .env ou configuração do worker Node.js.',
        className: 'bg-emerald-600 text-white',
      })
      setTimeout(() => setCopiedToken(false), 3000)
    } catch (err: any) {
      toast({
        title: 'Erro ao copiar token',
        description: 'Selecione o texto e copie manualmente.',
        variant: 'destructive',
      })
    }
  }

  const handleRevokeDfeToken = async () => {
    if (
      !confirm(
        'Tem certeza que deseja revogar o token DFe? O worker externo perderá o acesso imediatamente.',
      )
    ) {
      return
    }
    setGeneratingToken(true)
    try {
      const res = await pb.send<{ success: boolean; message: string }>(
        '/backend/v1/dfe/token/manage',
        { method: 'POST', body: { action: 'revoke' } },
      )
      if (res.success) {
        setDfeTokenActive(false)
        setDfeToken('')
        setNewlyGeneratedToken(null)
        setCopiedToken(false)
        toast({
          title: 'Token DFe Revogado',
          description:
            'O worker não conseguirá mais consultar nem enviar notas até gerar novo token.',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao revogar token',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setGeneratingToken(false)
    }
  }

  const handleConfigureWebhook = async () => {
    setConfiguringWebhook(true)
    try {
      const res = await pb.send<{
        success?: boolean
        statusCode?: number
        message?: string
      }>('/backend/v1/whatsapp/configure-webhook', { method: 'POST' })

      if (res && res.success) {
        toast({
          title: `Webhook configurado com sucesso! Status: ${res.statusCode || 200}`,
          className: 'bg-emerald-600 text-white border-emerald-700',
        })
      } else {
        const status = res?.statusCode || 500
        const msg = res?.message || 'Falha ao registrar webhook na Z-API.'
        toast({
          title: `Falha ao configurar webhook. Status: ${status} — ${msg}`,
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Erro ao conectar com o servidor.'
      toast({
        title: `Falha ao configurar webhook. Status: 500 — ${errorMsg}`,
        variant: 'destructive',
      })
    } finally {
      setConfiguringWebhook(false)
    }
  }

  const handleRunAiUnitTest = async () => {
    setRunningAiUnitTest(true)
    try {
      const { runAiSearchUnitTest } = await import('@/lib/aiSearchProduct.test')
      const result = runAiSearchUnitTest()
      setAiUnitTestResult(result)
      if (result.success) {
        toast({
          title: 'Todos os testes unitários da IA passaram com sucesso!',
          description:
            'Busca, tokenização, diacríticos/acentos, anos, ranking, disponibilidade 48h e exclusão de SKUs validados.',
          className: 'bg-emerald-600 text-white border-emerald-700',
        })
      } else {
        toast({
          title: 'Falha em testes unitários',
          description: 'Verifique os detalhes na tela.',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast({
        title: 'Erro ao rodar testes',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setRunningAiUnitTest(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setTestResult({ status: 'idle' })

    try {
      // 1. Testar endpoint do Webhook (health check)
      let webhookAlive = false
      try {
        const webhookRes = await pb.send<{ status?: string; message?: string }>(
          '/backend/v1/whatsapp/webhook/health',
          { method: 'GET' },
        )
        if (webhookRes && webhookRes.status === 'ok') {
          webhookAlive = true
        }
      } catch (err: unknown) {
        console.error('Erro ao testar webhook:', err)
        webhookAlive = false
      }

      if (!webhookAlive) {
        setTestResult({
          status: 'error',
          webhookOk: false,
          message:
            'Webhook WhatsApp não respondeu ou retornou erro (404/500). Verifique o backend.',
        })
        toast({
          title: 'Falha no Webhook',
          description: 'A rota do Webhook WhatsApp está inacessível.',
          variant: 'destructive',
        })
        setTestingConnection(false)
        return
      }

      // 2. Testar credenciais Z-API
      let zapiRes: { ok?: boolean; connected?: boolean; phone?: string; error?: string } = {}
      try {
        zapiRes = await pb.send<{
          ok?: boolean
          connected?: boolean
          phone?: string
          error?: string
        }>('/backend/v1/whatsapp/test-zapi', { method: 'GET' })
      } catch (err: unknown) {
        console.error('Erro ao testar Z-API:', err)
        zapiRes = { ok: false, error: 'Erro ao comunicar com a API do servidor' }
      }

      if (zapiRes && zapiRes.ok) {
        const isConnected = !!zapiRes.connected
        const phone = zapiRes.phone || ''
        setTestResult({
          status: 'success',
          webhookOk: true,
          zapiOk: true,
          connected: isConnected,
          phone: phone,
          message: isConnected
            ? `Webhook ativo e Z-API conectada com sucesso! ${phone ? `(Telefone: ${phone})` : ''}`
            : 'Webhook ativo e credenciais Z-API válidas! Obs: A instância Z-API está desconectada (escaneie o QR Code no painel da Z-API).',
        })
        toast({
          title: 'Conexão Testada com Sucesso!',
          description: isConnected
            ? 'Webhook e Z-API estão funcionando normalmente.'
            : 'Webhook OK e credenciais válidas na Z-API.',
        })
      } else {
        const errorMsg = zapiRes?.error || 'Erro desconhecido ao validar credenciais Z-API.'
        setTestResult({
          status: 'error',
          webhookOk: true,
          zapiOk: false,
          message: `Webhook ativo, mas houve falha na Z-API: ${errorMsg}`,
        })
        toast({
          title: 'Falha na Z-API',
          description: errorMsg,
          variant: 'destructive',
        })
      }
    } catch (generalErr: unknown) {
      setTestResult({
        status: 'error',
        message: 'Falha inesperada ao executar o teste de conexão.',
      })
      toast({
        title: 'Erro no teste',
        description: 'Não foi possível completar a validação.',
        variant: 'destructive',
      })
    } finally {
      setTestingConnection(false)
    }
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
                  className="text-sm font-semibold cursor-pointer text-slate-700 flex items-center gap-1.5"
                >
                  {togglingAi && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />}
                  {aiEnabled ? 'Robô Ativo' : 'Robô Desativado'}
                </Label>
                <Switch
                  id="ai-toggle"
                  checked={aiEnabled}
                  disabled={togglingAi || loading}
                  onCheckedChange={handleToggleAi}
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Telefone de Teste Autorizado */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                    <Smartphone className="h-4 w-4 text-emerald-600" /> Número de Teste Autorizado
                    (Etapa 2)
                  </Label>
                </div>
                <Input
                  value={authorizedTestPhone}
                  onChange={(e) => setAuthorizedTestPhone(e.target.value)}
                  placeholder="Ex: 5511947518805"
                  className="bg-white font-mono text-sm font-semibold"
                />
                <p className="text-xs text-slate-500">
                  Apenas mensagens deste número serão processadas pela IA na Etapa 2 de teste
                  controlado.
                </p>
              </div>

              {/* Modelo de IA */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                    <Sparkles className="h-4 w-4 text-emerald-600" /> Modelo de IA
                  </Label>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px]">
                    OpenAI
                  </Badge>
                </div>
                <Input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Modelo utilizado para geração de respostas (padrão estrito: gpt-4o-mini).
                </p>
              </div>

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
                  placeholder="<redacted>"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">Chave de acesso da OpenAI (GPT-4o-mini).</p>
              </div>

              {/* Meios de Pagamento informados pela IA */}
              <div className="space-y-1.5 md:col-span-2">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  <MessageSquare className="h-4 w-4 text-emerald-600" /> Formas de Pagamento (IA)
                </Label>
                <Input
                  value={aiPaymentMethods}
                  onChange={(e) => setAiPaymentMethods(e.target.value)}
                  placeholder="Ex: Pix, cartão em até 3x sem juros, link de pagamento"
                  className="bg-white text-sm"
                />
                <p className="text-xs text-slate-500">
                  Texto livre informado pela IA quando o cliente perguntar como pagar (ex.: Pix,
                  cartão em até 3x sem juros, link de pagamento). Fallback se vazio: &quot;Pagamento
                  via link enviado no orçamento&quot;.
                </p>
              </div>

              {/* SKUs Excluídos da Busca da IA (Insumos puros) */}
              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                    <XCircle className="h-4 w-4 text-rose-600" /> SKUs Excluídos da Busca da IA
                    (ai_excluded_skus)
                  </Label>
                  <span className="text-xs text-slate-400">Separados por vírgula</span>
                </div>
                <Input
                  value={aiExcludedSkus}
                  onChange={(e) => setAiExcludedSkus(e.target.value)}
                  placeholder="Ex: 3899, 4120, 9901"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Paliativo temporário para insumos puros (produtos que o cliente final nunca compra
                  sozinho, ex.: capa de bucha). Produtos híbridos (peça de venda que também é insumo
                  de montagem) <strong>NUNCA</strong> devem ser incluídos. Lidos ao vivo pela IA a
                  cada busca.
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
                  <Key className="h-4 w-4 text-emerald-600" /> Client Token da Conta Z-API
                  (Client-Token)
                </Label>
                <Input
                  type="password"
                  value={zapiClientToken}
                  onChange={(e) => setZapiClientToken(e.target.value)}
                  placeholder="Ex: F1234567890ABCDEF..."
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Client-Token da sua conta Z-API (obrigatório se o Client-Token estiver ativo na
                  segurança da sua conta Z-API).
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

            {/* Botões de Ação: Configurar Webhook e Testar Conexão */}
            <div className="pt-2 border-t border-emerald-100/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-emerald-600" /> Diagnóstico e Configuração do
                    Webhook
                  </h4>
                  <p className="text-xs text-slate-500">
                    Configure a URL do webhook na Z-API ou teste a conectividade em tempo real.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleConfigureWebhook}
                    disabled={configuringWebhook || testingConnection}
                    className="border-emerald-400 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-900 shadow-xs font-medium"
                  >
                    {configuringWebhook ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-emerald-600" />
                        Configurando...
                      </>
                    ) : (
                      <>
                        <SettingsIcon className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Configurar Webhook
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRunAiUnitTest}
                    disabled={runningAiUnitTest || testingConnection || configuringWebhook}
                    className="border-purple-300 hover:bg-purple-50 text-purple-800 bg-white shadow-xs font-medium"
                    title="Executar os 10 testes unitários da busca IA (tokenização, anos, ranking, 48h, ai_excluded_skus)"
                  >
                    {runningAiUnitTest ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-purple-600" />
                        Rodando Testes...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5 text-purple-600" />
                        Rodar Testes IA
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testingConnection || configuringWebhook || runningAiUnitTest}
                    className="border-emerald-300 hover:bg-emerald-50 text-emerald-800 bg-white shadow-xs font-medium"
                  >
                    {testingConnection ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-emerald-600" />
                        Testando...
                      </>
                    ) : (
                      <>
                        <Activity className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Testar Conexão
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Feedback Visual dos Testes Unitários da IA */}
              {aiUnitTestResult && (
                <div
                  className={`p-3 rounded-lg text-xs border animate-in fade-in duration-200 ${
                    aiUnitTestResult.success
                      ? 'bg-purple-50/70 border-purple-200 text-purple-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                      {aiUnitTestResult.success
                        ? '✅ Testes Unitários da IA (10/10 APROVADOS)'
                        : '❌ Falha nos Testes Unitários da IA'}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        aiUnitTestResult.success
                          ? 'bg-purple-100 text-purple-800 border-purple-300'
                          : 'bg-rose-100 text-rose-800 border-rose-300'
                      }
                    >
                      {aiUnitTestResult.success ? '100% Sucesso' : 'Falhou'}
                    </Badge>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1 bg-white/70 p-2 rounded border border-purple-100 font-mono text-[11px]">
                    {aiUnitTestResult.details.map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.startsWith('ERRO:')
                            ? 'text-rose-600 font-bold'
                            : line.startsWith('SUCESSO:')
                              ? 'text-emerald-700 font-semibold'
                              : 'text-slate-600'
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback Visual do Teste */}
              {testResult.status === 'success' && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-start gap-2.5 animate-in fade-in duration-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-emerald-900">
                      {testResult.connected
                        ? '✅ Conexão estabelecida com sucesso!'
                        : '✅ Webhook ativo e credenciais validadas!'}
                    </p>
                    <p className="text-emerald-700 leading-relaxed">{testResult.message}</p>
                  </div>
                </div>
              )}

              {testResult.status === 'error' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2.5 animate-in fade-in duration-200">
                  <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-red-900">❌ Falha no teste de conexão</p>
                    <p className="text-red-700 leading-relaxed">{testResult.message}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        {/* Seção Nova: Encerramento Automático do Atendimento Humano (Retorno para a IA) */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-slate-700" />
              <CardTitle className="text-lg font-bold text-slate-900">
                Encerramento Automático do Atendimento Humano
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-slate-500">
              Devolve o controle da conversa para a IA após período de inatividade, preservando todo
              o histórico
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                  Timeout de Inatividade (Minutos)
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={aiAutoCloseMinutes}
                  onChange={(e) => setAiAutoCloseMinutes(Number(e.target.value))}
                  placeholder="60"
                  className="bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Tempo sem nenhuma nova interação (cliente ou atendente) para reativar a IA
                  automaticamente. Padrão: 60 minutos (0 = desativa encerramento automático).
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-slate-800 font-medium">
                Mensagem de Encerramento por Inatividade
              </Label>
              <Input
                value={aiAutoCloseMessage}
                onChange={(e) => setAiAutoCloseMessage(e.target.value)}
                placeholder="Atendimento encerrado por inatividade. Se precisar de algo, me chame aqui que continuo te ajudando! 🙂"
                className="bg-white text-sm"
              />
              <p className="text-xs text-slate-500">
                Aviso enviado ao WhatsApp do cliente ao reativar a IA por timeout de inatividade.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Seção Nova: Famílias Permitidas para Orçamento e IA (Allowlist) */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center text-white shadow-sm">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold text-slate-900">
                      Famílias Disponíveis para Orçamento (Allowlist)
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        allowedFamilies.length > 0
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }
                    >
                      {allowedFamilies.length > 0
                        ? `${allowedFamilies.length} selecionada(s)`
                        : 'Lista Vazia (Todas liberadas)'}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Define quais famílias de peças da SOU.IS podem ser ofertadas pela IA no WhatsApp
                    e selecionadas em propostas comerciais. O módulo de compras permanece livre para
                    insumos e inativos.
                  </CardDescription>
                </div>
              </div>

              {familyStats.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAllFamilies}
                    className="text-xs h-8"
                  >
                    Marcar todas
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllFamilies}
                    className="text-xs h-8"
                  >
                    Limpar
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            {/* Aviso destacado quando a lista de famílias está vazia */}
            {allowedFamilies.length === 0 && (
              <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/80 text-amber-900 flex items-start gap-3 animate-in fade-in">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-sm text-amber-950">
                    Configure as famílias disponíveis para orçamento
                  </p>
                  <p className="leading-relaxed text-amber-800">
                    Nenhuma família está selecionada no momento. Por segurança (guarda da lista
                    vazia), o sistema mantém o comportamento padrão liberando todos os produtos
                    ativos (exceto os SKUs bloqueados em ai_excluded_skus). Selecione abaixo as
                    famílias permitidas para restringir o catálogo de venda e IA.
                  </p>
                </div>
              </div>
            )}

            {loadingProducts ? (
              <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                Carregando famílias do catálogo SOU.IS...
              </div>
            ) : familyStats.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                Nenhum produto cadastrado no catálogo para extrair famílias.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-medium">
                  <span>
                    Total de famílias encontradas: <strong>{familyStats.length}</strong> (
                    {productsList.length} produtos no catálogo)
                  </span>
                  <span>Ordenadas por volume decrescente</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto p-1 border rounded-lg bg-slate-50/40">
                  {familyStats.map((fam) => {
                    const isSelected = allowedFamiliesSet.has(fam.name)
                    return (
                      <label
                        key={fam.name}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-colors select-none ${
                          isSelected
                            ? 'bg-amber-50 border-amber-300 text-amber-950 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleFamily(fam.name)}
                            className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600 shrink-0"
                          />
                          <span className="font-medium truncate cursor-pointer" title={fam.name}>
                            {fam.isNoFamily ? (
                              <span className="italic text-slate-500 font-normal">Sem família</span>
                            ) : (
                              fam.name
                            )}
                          </span>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] shrink-0 font-mono ${
                            isSelected
                              ? 'bg-amber-200 text-amber-900 border-amber-300'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {fam.count} {fam.count === 1 ? 'item' : 'itens'}
                        </Badge>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Seção FASE 2: Captura Automática de NF-e via Distribuição DFe (Certificado A1) */}
        <Card className="bg-white border-indigo-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold text-slate-900">
                      Captura Automática DF-e (Certificado A1 & Worker)
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        dfeEnabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }
                    >
                      {dfeEnabled ? 'Captura Ativada' : 'DESLIGADO por Padrão'}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Integração oficial SEFAZ (NFeDistribuicaoDFe) via Worker externo Node.js —
                    guards D1 a D12
                  </CardDescription>
                </div>
              </div>

              {/* Toggles DFe: Captura (D7) e Lançamento Automático em Contas a Pagar (G5) */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                  <label className="text-xs font-semibold text-slate-700 cursor-pointer flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={dfeEnabled}
                      onChange={(e) => setDfeEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    />
                    <span>Captura Automática (Worker)</span>
                  </label>
                </div>
                <div
                  className={`flex items-center gap-2 border px-3 py-1.5 rounded-lg transition-colors ${
                    dfeAutoLaunch
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-amber-50/60 border-amber-200 text-amber-900'
                  }`}
                >
                  <label className="text-xs font-semibold cursor-pointer flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={dfeAutoLaunch}
                      onChange={(e) => setDfeAutoLaunch(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-emerald-600"
                    />
                    <span>Lançar Automático em Contas a Pagar</span>
                  </label>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Aviso de Status do Certificado / Worker */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                  Status Reportado do Certificado A1 & Worker (D7, D8, D9)
                </span>
                <Badge
                  variant={
                    dfePointer?.worker_status === 'online'
                      ? 'secondary'
                      : dfePointer?.worker_status === 'error'
                        ? 'destructive'
                        : 'outline'
                  }
                  className="capitalize font-mono text-[10px]"
                >
                  Worker: {dfePointer?.worker_status || 'offline'}
                </Badge>
              </div>

              {/* Cards de Métricas DF-e: Modo, Capturados e Lançados em Contas a Pagar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    Modo do Worker
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        dfePointer?.worker_mode === 'real' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                    <span className="font-bold text-slate-800 uppercase tracking-wide text-xs">
                      {dfePointer?.worker_mode === 'real'
                        ? 'Real (SEFAZ Produção)'
                        : dfePointer?.worker_mode === 'simulacao'
                          ? 'Simulação'
                          : 'Aguardando Ciclo'}
                    </span>
                  </div>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    Documentos Capturados
                  </span>
                  <span className="font-mono font-bold text-base text-slate-800 mt-0.5 block">
                    {dfeCapturedCount}
                  </span>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    Lançados em Contas a Pagar
                  </span>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono font-bold text-base text-emerald-700">
                      {dfePayablesCount}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        dfeAutoLaunch
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {dfeAutoLaunch ? 'Gate Ativo' : 'Lançamento Off'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-slate-600">
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-400 block">CNPJ do Certificado</span>
                  <span className="font-mono font-medium text-slate-800">
                    {dfePointer?.cert_cnpj || 'Não detectado'}
                  </span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-400 block">Validade</span>
                  <span className="font-mono font-medium text-slate-800">
                    {dfePointer?.cert_valid_until
                      ? new Date(dfePointer.cert_valid_until).toLocaleDateString('pt-BR')
                      : 'N/A'}
                  </span>
                  {dfePointer?.cert_days_remaining !== undefined && (
                    <span
                      className={`text-[10px] ml-1.5 font-bold ${
                        dfePointer.cert_days_remaining < 30 ? 'text-amber-600' : 'text-emerald-600'
                      }`}
                    >
                      ({dfePointer.cert_days_remaining} dias)
                    </span>
                  )}
                </div>
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-400 block">Último NSU / Consulta</span>
                  <span className="font-mono font-medium text-slate-800">
                    NSU: {dfePointer?.ult_nsu || '0'} |{' '}
                    {dfePointer?.last_poll_at
                      ? new Date(dfePointer.last_poll_at).toLocaleTimeString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                        })
                      : 'Nunca'}
                  </span>
                </div>
              </div>

              {/* Alertas D7, D8, D9 */}
              {(!dfePointer || !dfePointer.cert_cnpj) && (
                <div className="text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 flex items-center gap-2 mt-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>Certificado não configurado:</strong> O worker externo ainda não
                    reportou a leitura do arquivo .pfx. Nenhuma consulta automática rodará.
                  </span>
                </div>
              )}

              {dfePointer?.cert_days_remaining !== undefined &&
                dfePointer.cert_days_remaining < 30 &&
                dfePointer.cert_days_remaining >= 0 && (
                  <div className="text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 flex items-center gap-2 mt-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>Atenção:</strong> O Certificado Digital A1 expira em menos de 30 dias
                      ({dfePointer.cert_days_remaining} dias restantes).
                    </span>
                  </div>
                )}

              {dfePointer?.cert_days_remaining !== undefined &&
                dfePointer.cert_days_remaining < 0 && (
                  <div className="text-rose-800 bg-rose-50 p-2 rounded border border-rose-200 flex items-center gap-2 mt-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>
                      <strong>CERTIFICADO DIGITAL VENCIDO:</strong> Capturas DFe suspensas com
                      parada explícita (D9).
                    </span>
                  </div>
                )}

              {dfePointer?.last_error && (
                <div className="text-rose-800 bg-rose-50 p-2 rounded border border-rose-200 flex items-center gap-2 mt-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>
                    <strong>Último erro registrado:</strong> {dfePointer.last_error}
                  </span>
                </div>
              )}
            </div>

            {/* Parâmetros de Configuração: Intervalo e Token Dedicado (CF-1c, D10) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Intervalo de Consulta Periódica (Horas — D10)</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={dfePollInterval}
                  onChange={(e) => setDfePollInterval(Number(e.target.value))}
                  placeholder="1"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-slate-500">
                  Padrão SEFAZ: mínimo de 1 hora para evitar consumo indevido (cStat 656).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center justify-between">
                  <span>Token Dedicado DFe (CF-1c)</span>
                  <Badge
                    variant="outline"
                    className={
                      dfeTokenActive
                        ? 'bg-emerald-50 text-emerald-700'
                        : dfeToken
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-500'
                    }
                  >
                    {dfeTokenActive ? 'Ativo' : dfeToken ? 'Revogado' : 'Não Gerado'}
                  </Badge>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    readOnly
                    value={dfeTokenActive && dfeToken ? '••••••••••••••••••••••••••••••••' : ''}
                    placeholder="Nenhum token configurado"
                    className="font-mono text-xs bg-slate-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={generatingToken}
                    onClick={handleGenerateDfeToken}
                    className="text-xs shrink-0"
                  >
                    {generatingToken ? 'Gerando...' : 'Gerar Token'}
                  </Button>
                  {dfeTokenActive && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={generatingToken}
                      onClick={handleRevokeDfeToken}
                      className="text-xs shrink-0"
                    >
                      Revogar
                    </Button>
                  )}
                </div>

                {newlyGeneratedToken && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-1.5 text-amber-800 text-xs font-semibold">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>
                        Copie o token agora — ele não será exibido novamente após fechar ou
                        recarregar esta tela
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        readOnly
                        value={newlyGeneratedToken}
                        className="font-mono text-xs bg-white text-slate-900 border-amber-300 font-bold select-all"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCopyNewToken}
                        className="text-xs shrink-0 bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
                      >
                        {copiedToken ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copiar Token
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-500">
                  Token com escopo exclusivo para o worker (CF-1c). A senha do .pfx e a chave
                  privada nunca passam pelo CRM (D9).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Seção PROMPT 2: Ingestão de NF-e, Regras Fiscais e Controle de Estoque */}
        <Card className="bg-white border-blue-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-slate-900">
                  Pipeline Fiscal NF-e e Mestre de Estoque
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Parâmetros de segurança para conferência de destinatário (S7), cálculo de preço de
                  venda (S4) e controle de fase de estoque (F4)
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>CNPJ da Empresa (Destinatário Canônico — S7)</span>
                <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">
                  Crítico / Guarda de Cegueira
                </span>
              </Label>
              <Input
                value={companyCnpj}
                onChange={(e) => setCompanyCnpj(e.target.value)}
                placeholder="Ex: 12.345.678/0001-90 ou 14 dígitos"
                className="font-mono text-sm"
              />
              <p className="text-xs text-slate-500">
                Se este campo estiver vazio, o pipeline <strong>não processará nenhuma nota</strong>{' '}
                (Guarda de Cegueira). Se o destinatário do XML for diferente deste CNPJ, a nota é
                retida na Fila de Revisão.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Fator de Margem por Família de Peças (JSON — S4-FINAL / Guard 6a)</Label>
              <textarea
                value={familyMarginsJson}
                onChange={(e) => setFamilyMarginsJson(e.target.value)}
                rows={4}
                className="w-full text-xs font-mono p-3 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                placeholder='{"default": 1.4, "AMORTECEDOR": 1.5, "PASTILHA": 1.45}'
              />
              <p className="text-xs text-slate-500">
                O preço sugerido é calculado por: <code>Custo Real da NF × Fator da Família</code>{' '}
                (apenas se a SOU.IS mandar preço 0/vazio). Se a família não tiver margem definida,
                nenhum preço é sugerido (Guard 6a). Preço sugerido nunca abaixo do custo (Guard 6b).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Mestre do Estoque (Fase de Operação — F4)</Label>
              <select
                value={stockPhase}
                onChange={(e) => setStockPhase(e.target.value as any)}
                className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="souis_master">
                  Fase 1: SOU.IS é o MESTRE do Estoque (Ativo — CRM apenas lembra de lançar no ERP)
                </option>
                <option value="crm_cutover" disabled>
                  Fase 2: CRM Mestre do Estoque (Disponível no Cutover final)
                </option>
              </select>
              <p className="text-xs text-slate-500">
                Na Fase 1, o CRM não movimenta estoque na compra; a entrada física e contábil é
                lançada manualmente no SOU.IS com o custo da NF e propagada via sincronização.
              </p>
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
                placeholder="https://seu-link-aqui/{valor}"
              />
              <p className="text-xs text-slate-500">
                Molde de link para futura integração bancária/gateway (ex: https://seu-link-aqui/
                {'{valor}'}). Se vazio, envie o link manualmente.
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
