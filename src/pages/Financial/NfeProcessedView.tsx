import React, { useState, useEffect } from 'react'
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  Check,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Trash2,
  Sparkles,
  History,
  Clock,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency } from '@/lib/whatsapp'
import pb from '@/lib/pocketbase/client'
import {
  getNfeProcessedList,
  getNfePriceQueue,
  getNfeProductMappings,
  deleteNfeProductMapping,
  uploadNfeXml,
  reconcileMatchItem,
  applyQueuePrice,
  markSouisStockLaunched,
} from '@/services/financial'
import { getProducts } from '@/services/products'
import { getSettings } from '@/services/settings'
import type { NfeProcessed, NfePriceQueueItem, NfeProductMapping, Product } from '@/types/crm'

export function NfeProcessedView() {
  const { toast } = useToast()
  const [activeSubTab, setActiveSubTab] = useState<
    'nfe' | 'pauta' | 'excecoes' | 'mapeamentos' | 'historico_dfe'
  >('nfe')

  // Estado da FASE 2: Captura DFe (D2, D7, CF-1b, CF-1d, G5)
  const [dfePointer, setDfePointer] = useState<any>(null)
  const [companyCnpjConfigured, setCompanyCnpjConfigured] = useState<string>('')
  const [dfeHistoryList, setDfeHistoryList] = useState<any[]>([])
  const [dfePayablesCount, setDfePayablesCount] = useState<number>(0)
  const [dfeAutoLaunchEnabled, setDfeAutoLaunchEnabled] = useState<boolean>(false)
  const [enqueuingCommand, setEnqueuingCommand] = useState<boolean>(false)
  const [retroactiveDays, setRetroactiveDays] = useState<number>(30)
  const [isRetroactiveModalOpen, setIsRetroactiveModalOpen] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Listas de dados
  const [nfeList, setNfeList] = useState<NfeProcessed[]>([])
  const [priceQueue, setPriceQueue] = useState<NfePriceQueueItem[]>([])
  const [mappings, setMappings] = useState<NfeProductMapping[]>([])

  // Modal de Upload
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [xmlTextInput, setXmlTextInput] = useState('')

  // Modal de Reconciliação
  const [reconcilingItem, setReconcilingItem] = useState<NfePriceQueueItem | null>(null)
  const [reconcileSearch, setReconcileSearch] = useState('')
  const [productList, setProductList] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [reconcilingLoading, setReconcilingLoading] = useState(false)

  // Modal de Aprovação de Preço
  const [approvingItem, setApprovingItem] = useState<NfePriceQueueItem | null>(null)
  const [customPrice, setCustomPrice] = useState<string>('')
  const [approvingLoading, setApprovingLoading] = useState(false)

  // Ação de Lançar estoque SOU.IS (F1)
  const [markingNfeId, setMarkingNfeId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [nfes, queue, maps, pointer, hist, appSettings, payablesDfe] = await Promise.all([
        getNfeProcessedList(),
        getNfePriceQueue(),
        getNfeProductMappings(),
        pb
          .collection('dfe_pointer_state')
          .getList(1, 1, { sort: '-created' })
          .catch(() => ({ items: [] })),
        pb
          .collection('dfe_history')
          .getList(1, 100, { sort: '-created' })
          .catch(() => ({ items: [] })),
        getSettings().catch(() => null),
        pb
          .collection('accounts_payable')
          .getList(1, 1, { filter: "origin = 'dfe'" })
          .catch(() => ({ totalItems: 0, items: [] })),
      ])
      setNfeList(nfes)
      setPriceQueue(queue)
      setMappings(maps)
      if (appSettings) {
        if (appSettings.company_cnpj) {
          setCompanyCnpjConfigured(String(appSettings.company_cnpj).replace(/\D/g, ''))
        }
        setDfeAutoLaunchEnabled(Boolean((appSettings as any).dfe_auto_launch))
      }
      if (pointer.items.length > 0) setDfePointer(pointer.items[0])
      setDfeHistoryList(hist.items)
      setDfePayablesCount(payablesDfe.totalItems || 0)
    } catch (err: any) {
      toast({
        title: 'Erro ao carregar dados',
        description: err.message || 'Não foi possível carregar os dados de NF-e.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Buscar produtos para reconciliação
  const searchProductsForReconcile = async (query: string) => {
    setLoadingProducts(true)
    try {
      const prods = await getProducts()
      const q = query.toLowerCase().trim()
      const filtered = prods.filter(
        (p) =>
          p.is_active !== false &&
          (p.sku.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.reduced_code && p.reduced_code.toLowerCase().includes(q))),
      )
      setProductList(filtered.slice(0, 15))
    } catch {
      /* intentionally ignored */
    } finally {
      setLoadingProducts(false)
    }
  }

  const handleOpenReconcile = (item: NfePriceQueueItem) => {
    setReconcilingItem(item)
    setSelectedProductId('')
    const initialSearch = item.supplier_code || item.description?.slice(0, 15) || ''
    setReconcileSearch(initialSearch)
    searchProductsForReconcile(initialSearch)
  }

  const handleConfirmReconcile = async () => {
    if (!reconcilingItem || !selectedProductId) return
    setReconcilingLoading(true)
    try {
      const res = await reconcileMatchItem(reconcilingItem.id, selectedProductId)
      if (res.success) {
        toast({
          title: 'Item reconciliado com sucesso!',
          description: `Casado com SKU ${res.sku}. Aprendizado registrado para as próximas notas!`,
        })
        setReconcilingItem(null)
        loadData()
      } else {
        toast({
          title: 'Erro na reconciliação',
          description: res.error || 'Falha ao conciliar item.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message || 'Falha na requisição.',
        variant: 'destructive',
      })
    } finally {
      setReconcilingLoading(false)
    }
  }

  const handleOpenApprovePrice = (item: NfePriceQueueItem) => {
    setApprovingItem(item)
    setCustomPrice(item.suggested_sell_price ? String(item.suggested_sell_price) : '')
  }

  const handleConfirmApprovePrice = async () => {
    if (!approvingItem) return
    const priceNum = Number(customPrice)
    if (isNaN(priceNum) || priceNum <= 0) {
      toast({
        title: 'Preço inválido',
        description: 'Informe um valor maior que zero.',
        variant: 'destructive',
      })
      return
    }
    setApprovingLoading(true)
    try {
      const res = await applyQueuePrice(approvingItem.id, priceNum)
      if (res.success) {
        toast({
          title: 'Preço aprovado e aplicado!',
          description: `Novo preço ${formatCurrency(priceNum)} gravado no produto ${res.sku}.`,
        })
        setApprovingItem(null)
        loadData()
      } else {
        toast({
          title: 'Erro ao aplicar preço',
          description: res.error || 'Falha ao gravar preço.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setApprovingLoading(false)
    }
  }

  // F1: Marcar entrada no SOU.IS como lançada
  const handleMarkSouisStock = async (nfeId: string) => {
    setMarkingNfeId(nfeId)
    try {
      const res = await markSouisStockLaunched(nfeId)
      if (res.success) {
        toast({
          title: 'Entrada confirmada no SOU.IS',
          description: 'A nota foi marcada como lançada no ERP SOU.IS.',
        })
        loadData()
      } else {
        toast({
          title: 'Erro ao atualizar',
          description: res.error,
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setMarkingNfeId(null)
    }
  }

  // Upload manual de XML
  // CF-1b: Botão "Consultar Agora" DFe (grava comando na fila)
  const handleEnqueueConsultarAgora = async () => {
    setEnqueuingCommand(true)
    try {
      const res = await pb.send<{ success: boolean; message: string }>(
        '/backend/v1/dfe/commands/enqueue',
        {
          method: 'POST',
          body: { command: 'consultar_agora' },
        },
      )
      if (res.success) {
        toast({
          title: 'Comando Enfileirado (CF-1b)',
          description: 'comando enfileirado — executa no próximo ciclo do worker',
          className: 'bg-indigo-600 text-white',
        })
        loadData()
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao consultar',
        description: err.message || 'Falha ao enfileirar comando.',
        variant: 'destructive',
      })
    } finally {
      setEnqueuingCommand(false)
    }
  }

  // D2: Importação Retroativa Explícita
  const handleConfirmRetroactive = async () => {
    setEnqueuingCommand(true)
    try {
      const res = await pb.send<{ success: boolean; message: string }>(
        '/backend/v1/dfe/commands/enqueue',
        {
          method: 'POST',
          body: {
            command: 'importacao_retroativa',
            params: { days: Number(retroactiveDays) || 30 },
          },
        },
      )
      if (res.success) {
        toast({
          title: 'Importação Retroativa Enfileirada (D2)',
          description: `Solicitação para os últimos ${retroactiveDays} dias enviada ao worker.`,
          className: 'bg-indigo-600 text-white',
        })
        setIsRetroactiveModalOpen(false)
        loadData()
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao solicitar importação',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setEnqueuingCommand(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Guard 1b: só XML
    if (!file.name.toLowerCase().endsWith('.xml')) {
      toast({
        title: 'Arquivo inválido (Guard 1b)',
        description: 'Só XML de NF-e válido é aceito. PDF/DANFE sozinho deve ser enviado como XML.',
        variant: 'destructive',
      })
      return
    }

    const reader = new FileReader()
    reader.onload = async (event) => {
      const content = event.target?.result as string
      if (content) {
        await processXmlUpload(content)
      }
    }
    reader.readAsText(file)
  }

  const handleTextUpload = async () => {
    if (!xmlTextInput.trim()) {
      toast({
        title: 'Conteúdo vazio',
        description: 'Cole o conteúdo do XML da NF-e.',
        variant: 'destructive',
      })
      return
    }
    await processXmlUpload(xmlTextInput)
  }

  const processXmlUpload = async (xml: string) => {
    setUploading(true)
    try {
      const res = await uploadNfeXml(xml)
      if (res.success) {
        if (res.duplicate) {
          toast({
            title: 'NF-e já processada (Guard 1a)',
            description: res.message || 'Esta chave de acesso já existe no sistema.',
          })
        } else {
          toast({
            title: 'NF-e processada com sucesso!',
            description: `Chave ${res.access_key}. Contas a pagar e custos gerados!`,
          })
        }
        setIsUploadOpen(false)
        setXmlTextInput('')
        loadData()
      } else {
        if (res.exception) {
          toast({
            title: 'Nota enviada para Fila de Revisão',
            description: res.reason || res.message,
            variant: 'destructive',
          })
          setIsUploadOpen(false)
          setXmlTextInput('')
          loadData()
          setActiveSubTab('excecoes')
        } else {
          toast({
            title: 'Falha no processamento',
            description: res.error || res.message,
            variant: 'destructive',
          })
        }
      }
    } catch (err: any) {
      toast({
        title: 'Erro de comunicação',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Deseja realmente remover este mapeamento de aprendizado?')) return
    try {
      await deleteNfeProductMapping(id)
      toast({ title: 'Mapeamento removido' })
      loadData()
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' })
    }
  }

  // Filtragens
  const filteredNfe = nfeList.filter(
    (n) =>
      n.access_key?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.nfe_number?.includes(searchTerm),
  )

  const pendingExceptions = nfeList.filter(
    (n) => n.status === 'erro' || n.status === 'pendente_reconciliacao',
  )
  const pendingStockEntries = nfeList.filter(
    (n) => n.status === 'processada' && n.souis_stock_status === 'pendente',
  )
  const pautaPrecoItems = priceQueue.filter(
    (q) => q.status === 'pendente' && q.item_type !== 'excecao',
  )
  const reconciliacaoItems = priceQueue.filter(
    (q) => q.status === 'pendente' && q.item_type === 'reconciliacao_item',
  )

  return (
    <div className="space-y-6">
      {/* Banner Informativo sobre a integração com o pipeline NF-e */}
      <div className="flex items-start gap-3 bg-blue-50/60 p-4 rounded-xl border border-blue-200">
        <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-900 leading-relaxed flex-1">
          <p className="font-bold">Pipeline NF-e Automático (PROMPT 2 Ativo)</p>
          <p className="text-blue-700 mt-0.5">
            Ingestão automática via <strong>WhatsApp</strong> (desvio silencioso sem criar chat) e{' '}
            <strong>Upload manual</strong>. Contas a pagar com parcelas do XML, gravação do custo
            real no produto, sugestão de preço por família quando SOU.IS não tem preço, e painel de
            exceções.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            onClick={handleEnqueueConsultarAgora}
            disabled={enqueuingCommand}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-1.5 shadow-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${enqueuingCommand ? 'animate-spin' : ''}`} />
            <span>Consultar Agora (DFe)</span>
          </Button>

          <Button
            onClick={() => setIsUploadOpen(true)}
            variant="outline"
            className="text-blue-700 border-blue-300 hover:bg-blue-100 text-xs font-semibold gap-1.5 shadow-xs"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload de XML</span>
          </Button>
        </div>
      </div>

      {/* Avisos de Observabilidade DFe (CF-1d, D7, D8, D9) */}
      {/* 1. Worker offline ou não inicializado */}
      {(!dfePointer || dfePointer.worker_status === 'offline') && (
        <div className="bg-slate-100 border border-slate-300 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-800 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-slate-600 shrink-0" />
            <span>
              <strong>WORKER OFFLINE:</strong> O serviço de captura automática DF-e está offline ou
              não sincronizado recentemente. Consultas sob demanda aguardarão o início do worker.
            </span>
          </div>
        </div>
      )}

      {/* 2. Certificado digital A1 não configurado */}
      {(!dfePointer || !dfePointer.cert_cnpj) && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Certificado não configurado:</strong> Certificado digital A1 não configurado
              no worker externo. Nenhuma consulta automática rodará.
            </span>
          </div>
        </div>
      )}

      {/* 3. CNPJ divergente entre o certificado A1 e a empresa no CRM (D8) */}
      {dfePointer?.cert_cnpj &&
        companyCnpjConfigured &&
        dfePointer.cert_cnpj.replace(/\D/g, '') !== companyCnpjConfigured && (
          <div className="bg-rose-50 border border-rose-300 rounded-xl p-3.5 flex items-center justify-between text-xs text-rose-900 shadow-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
              <span>
                <strong>CNPJ divergente (D8):</strong> O CNPJ do certificado digital (
                {dfePointer.cert_cnpj}) diverge do CNPJ cadastrado nas Configurações da Empresa (
                {companyCnpjConfigured}). O ciclo de captura automática do worker foi suspenso para
                evitar notas indevidas.
              </span>
            </div>
          </div>
        )}

      {/* 4. Erro do worker ou falhas consecutivas */}
      {dfePointer && dfePointer.worker_status === 'error' && (
        <div className="bg-rose-50 border border-rose-300 rounded-xl p-3.5 flex items-center justify-between text-xs text-rose-900 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>
              <strong>ALERTA WORKER DFe (CF-1d / D3):</strong> Três ou mais falhas consecutivas
              registradas. Erro: {dfePointer.last_error || 'Falha de comunicação'}
            </span>
          </div>
        </div>
      )}

      {/* Lembrete / Alerta de Entradas Pendentes no SOU.IS (F1 / F2) */}
      {pendingStockEntries.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-950">
              <span className="font-bold">
                Atenção: {pendingStockEntries.length} NF-e com Entrada de Estoque Pendente no SOU.IS
                (Fase 1)
              </span>
              <p className="text-amber-800 mt-0.5">
                O SOU.IS é o mestre do estoque. Lance a entrada manualmente no SOU.IS{' '}
                <strong>com o custo da NF</strong> (F2) e clique em &quot;Marcar como lançado&quot;.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActiveSubTab('nfe')}
            className="border-amber-400 text-amber-900 bg-amber-100/50 hover:bg-amber-200 text-xs shrink-0 font-bold"
          >
            Ver {pendingStockEntries.length} pendentes
          </Button>
        </div>
      )}

      {/* Navegação entre Abas */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveSubTab('nfe')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeSubTab === 'nfe'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Notas Processadas ({nfeList.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('pauta')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'pauta'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>Pauta de Preço ({pautaPrecoItems.length})</span>
            {pautaPrecoItems.length > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {pautaPrecoItems.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('excecoes')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'excecoes'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>Painel de Exceções</span>
            {(pendingExceptions.length > 0 || reconciliacaoItems.length > 0) && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {pendingExceptions.length + reconciliacaoItems.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('mapeamentos')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'mapeamentos'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Mapeamentos de Aprendizado ({mappings.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('historico_dfe')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'historico_dfe'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <History className="h-3.5 w-3.5 text-indigo-300" />
            <span>Histórico DFe ({dfeHistoryList.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por chave, fornecedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={loadData}
            disabled={loading}
            className="h-9 w-9 shrink-0"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 1. ABA DE NOTAS PROCESSADAS */}
      {activeSubTab === 'nfe' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-4">Emissão</th>
                    <th className="py-3 px-4">NF-e / Chave</th>
                    <th className="py-3 px-4">Fornecedor</th>
                    <th className="py-3 px-4 text-center">Itens Casados</th>
                    <th className="py-3 px-4 text-right">Valor Total</th>
                    <th className="py-3 px-4 text-center">Entrada SOU.IS (F1)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Carregando notas fiscais...
                      </td>
                    </tr>
                  ) : filteredNfe.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        Nenhuma NF-e processada encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredNfe.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                          {item.issue_date
                            ? new Date(item.issue_date).toLocaleDateString('pt-BR')
                            : new Date(item.created).toLocaleDateString('pt-BR')}
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {item.nfe_number ? `NF-e #${item.nfe_number}` : 'Nota Fiscal'}
                            {item.series ? ` (Série ${item.series})` : ''}
                          </div>
                          <div
                            className="text-[10px] font-mono text-slate-400 truncate max-w-[260px]"
                            title={item.access_key}
                          >
                            {item.access_key}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">
                            {item.supplier_name || item.expand?.supplier?.name || '-'}
                          </div>
                          {item.supplier_cnpj && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              CNPJ: {item.supplier_cnpj}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1 text-xs">
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                              {item.matched_items_count || 0} casados
                            </span>
                            {(item.pending_items_count || 0) > 0 && (
                              <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded">
                                {item.pending_items_count} pendentes
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-black text-slate-900 whitespace-nowrap">
                          {formatCurrency(item.total_amount || 0)}
                        </td>

                        <td className="py-3 px-4 text-center">
                          {item.souis_stock_status === 'lancado' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] gap-1">
                              <Check className="h-3 w-3" /> Lançado
                            </Badge>
                          ) : item.souis_stock_status === 'pendente' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleMarkSouisStock(item.id)}
                              disabled={markingNfeId === item.id}
                              className="text-[10px] h-7 px-2 font-bold text-amber-700 border-amber-300 hover:bg-amber-100"
                              title="Marcar que a entrada já foi lançada no SOU.IS com o custo da NF"
                            >
                              {markingNfeId === item.id ? 'Gravando...' : 'Marcar Lançado'}
                            </Button>
                          ) : (
                            <span className="text-slate-400 text-[10px]">N/A</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          {item.status === 'processada' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              Processada
                            </Badge>
                          ) : item.status === 'pendente_reconciliacao' ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              Reconciliação
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">
                              Exceção / Erro
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. ABA DE PAUTA DE TRABALHO (PREÇO SUGERIDO S4-FINAL) */}
      {activeSubTab === 'pauta' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
              <strong>Pauta de Trabalho de Preço:</strong> Sugestões calculadas quando a SOU.IS
              enviou preço 0/vazio (custo real × margem por família). Conferir e aprovar para
              aplicar no produto.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-4">Item / Descrição</th>
                    <th className="py-3 px-4">SKU Casado</th>
                    <th className="py-3 px-4">Família / Margem</th>
                    <th className="py-3 px-4 text-right">Custo Real NF</th>
                    <th className="py-3 px-4 text-right">Preço Sugerido</th>
                    <th className="py-3 px-4">Fonte (S4-h)</th>
                    <th className="py-3 px-4 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pautaPrecoItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                        Nenhum item aguardando conferência de preço.
                      </td>
                    </tr>
                  ) : (
                    pautaPrecoItems.map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-semibold text-slate-900 truncate">
                            {q.description}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Cód Fornecedor: {q.supplier_code} | NCM: {q.ncm}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-700">{q.sku || '-'}</td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">{q.family || 'Padrão'}</div>
                          <div className="text-[10px] text-slate-400">
                            Fator: {q.margin_factor ? `${q.margin_factor}x` : 'Sem margem'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-black text-slate-900">
                          {formatCurrency(q.unit_cost || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-emerald-600 text-sm">
                          {formatCurrency(q.suggested_sell_price || 0)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500 max-w-[200px]">
                          {q.price_source_payload || 'SOU.IS view'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            size="sm"
                            onClick={() => handleOpenApprovePrice(q)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 px-3 font-semibold gap-1"
                          >
                            <Check className="h-3 w-3" /> Aprovar Preço
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. ABA DE EXCEÇÕES (NOTAS RETIDAS & RECONCILIAÇÃO) */}
      {activeSubTab === 'excecoes' && (
        <div className="space-y-6">
          {/* Seção A: Notas Retidas por Regra Fiscal (CFOP, Destinatário S7, Status S8, etc.) */}
          <Card className="border-red-200 shadow-sm overflow-hidden">
            <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-900 font-bold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span>
                Notas Retidas em Fila de Revisão (Sem lançamento de contas a pagar nem custo)
              </span>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                    <tr>
                      <th className="py-3 px-4">Emissão</th>
                      <th className="py-3 px-4">NF-e / Chave</th>
                      <th className="py-3 px-4">Fornecedor</th>
                      <th className="py-3 px-4">Motivo da Retenção (Guard)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingExceptions.filter((n) => n.status === 'erro').length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          Nenhuma nota retida por regra fiscal.
                        </td>
                      </tr>
                    ) : (
                      pendingExceptions
                        .filter((n) => n.status === 'erro')
                        .map((n) => (
                          <tr key={n.id} className="hover:bg-red-50/30 transition-colors">
                            <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                              {n.issue_date
                                ? new Date(n.issue_date).toLocaleDateString('pt-BR')
                                : new Date(n.created).toLocaleDateString('pt-BR')}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">
                                {n.nfe_number ? `NF-e #${n.nfe_number}` : 'Nota Fiscal'}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400 truncate max-w-[240px]">
                                {n.access_key}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-800">{n.supplier_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                CNPJ: {n.supplier_cnpj}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge className="bg-red-100 text-red-900 border-red-300 font-semibold text-xs leading-normal py-1 px-2.5">
                                {n.exception_reason ||
                                  'Inconsistência identificada nas validações fiscais'}
                              </Badge>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Seção B: Itens sem match aguardando Reconciliação (MA-t) */}
          <Card className="border-amber-200 shadow-sm overflow-hidden">
            <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <span>Itens sem Match no Catálogo (Reconciliação Humana com Aprendizado MA-t)</span>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                    <tr>
                      <th className="py-3 px-4">Item do XML (Fornecedor)</th>
                      <th className="py-3 px-4">Código Fornecedor</th>
                      <th className="py-3 px-4 text-right">Qtd</th>
                      <th className="py-3 px-4 text-right">Custo Unitário</th>
                      <th className="py-3 px-4 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reconciliacaoItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Nenhum item pendente de casamento no catálogo.
                        </td>
                      </tr>
                    ) : (
                      reconciliacaoItems.map((q) => (
                        <tr key={q.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className="py-3 px-4 max-w-[280px]">
                            <div className="font-semibold text-slate-900 truncate">
                              {q.description}
                            </div>
                            {q.ncm && (
                              <div className="text-[10px] text-slate-400">NCM: {q.ncm}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700 font-bold">
                            {q.supplier_code || '-'}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-700">{q.quantity}</td>
                          <td className="py-3 px-4 text-right font-black text-slate-900">
                            {formatCurrency(q.unit_cost || 0)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Button
                              size="sm"
                              onClick={() => handleOpenReconcile(q)}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3 font-semibold gap-1"
                            >
                              <span>Casar com Produto</span>
                              <ArrowRight className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 5. ABA HISTÓRICO DFE (D2 — Backlog e Visibilidade da Captura Automática) */}
      {activeSubTab === 'historico_dfe' && (
        <div className="space-y-4">
          <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="text-xs text-indigo-950 space-y-1">
              <span className="font-bold flex items-center gap-1.5 text-sm text-indigo-900">
                <History className="h-4 w-4 text-indigo-600" />
                Histórico de Documentos Recebidos via Distribuição DF-e (D2)
              </span>
              <p className="text-indigo-800">
                Esta aba lista todos os documentos e resumos capturados da SEFAZ pelo ponteiro NSU.
                Na ativação (NSU-START), o backlog histórico fica apenas listado aqui sem criar
                lançamentos nem contas a pagar fantasma.
              </p>
              <div className="flex items-center gap-4 pt-1 font-mono text-[11px] text-slate-600 flex-wrap">
                <span>
                  Modo Worker:{' '}
                  <strong className="uppercase">
                    {dfePointer?.worker_mode === 'real'
                      ? 'REAL (SEFAZ)'
                      : dfePointer?.worker_mode === 'simulacao'
                        ? 'SIMULAÇÃO'
                        : 'AGUARDANDO'}
                  </strong>
                </span>
                <span>
                  Ponteiro ultNSU: <strong>{dfePointer?.ult_nsu || '0'}</strong>
                </span>
                <span>
                  maxNSU: <strong>{dfePointer?.max_nsu || '0'}</strong>
                </span>
                <span>
                  Lançados em CP: <strong>{dfePayablesCount}</strong> (
                  {dfeAutoLaunchEnabled ? 'Gate Ativo' : 'Gate Off'})
                </span>
                <span>
                  Status Worker: <strong>{dfePointer?.worker_status || 'offline'}</strong>
                </span>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => setIsRetroactiveModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs shrink-0 font-semibold gap-1.5 shadow-xs"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Importação Retroativa Manual</span>
            </Button>
          </div>

          {dfeHistoryList.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded-xl">
              Nenhum documento registrado no histórico DFe até o momento. Execute &quot;Consultar
              Agora&quot; ou aguarde o ciclo do worker.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">NSU</th>
                      <th className="py-2.5 px-3">Chave de Acesso</th>
                      <th className="py-2.5 px-3">Emitente</th>
                      <th className="py-2.5 px-3">Data Emissão</th>
                      <th className="py-2.5 px-3">Valor Total</th>
                      <th className="py-2.5 px-3">Tipo / Schema</th>
                      <th className="py-2.5 px-3">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dfeHistoryList.map((hist) => (
                      <tr key={hist.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-700">
                          {hist.nsu}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-800">
                          {hist.access_key}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">
                            {hist.emitter_name || 'Desconhecido'}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {hist.emitter_cnpj}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {hist.issue_date
                            ? new Date(hist.issue_date).toLocaleDateString('pt-BR')
                            : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 font-mono">
                          {formatCurrency(hist.total_amount || 0)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-[10px]">
                            {hist.document_type || 'outro'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant={hist.is_backlog ? 'secondary' : 'default'}
                            className={`text-[10px] ${
                              hist.is_backlog
                                ? 'bg-amber-100 text-amber-900 border-amber-200'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                            }`}
                          >
                            {hist.is_backlog ? 'Backlog (NSU-START)' : 'Captura em Regime'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. ABA DE MAPEAMENTOS DE APRENDIZADO (MA-t-2) */}
      {activeSubTab === 'mapeamentos' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 flex items-center justify-between">
            <div>
              <strong>Aprendizado Contínuo (MA-t / MA-t-2):</strong> Cada reconciliação humana
              confirmada gera uma regra única (CNPJ Fornecedor + Código do Item → Produto CRM). As
              próximas notas casam sozinhas com log [NF-MATCH].
            </div>
            <Badge variant="outline" className="bg-white">
              {mappings.length} mapeamentos salvos
            </Badge>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-4">CNPJ Fornecedor</th>
                    <th className="py-3 px-4">Cód. Fornecedor</th>
                    <th className="py-3 px-4">Descrição no XML</th>
                    <th className="py-3 px-4">Produto Casado (CRM)</th>
                    <th className="py-3 px-4">SKU CRM</th>
                    <th className="py-3 px-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mappings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500">
                        Nenhum mapeamento registrado ainda. Os mapeamentos são gerados
                        automaticamente a cada reconciliação confirmada.
                      </td>
                    </tr>
                  ) : (
                    mappings.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-800">
                          {m.supplier_cnpj}
                          {m.supplier_name && (
                            <div className="text-[10px] text-slate-400 font-sans">
                              {m.supplier_name}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {m.supplier_code}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-[220px] truncate">
                          {m.supplier_description || '-'}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900 max-w-[220px] truncate">
                          {m.product_name || m.expand?.product?.name || '-'}
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-700">{m.product_sku}</td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteMapping(m.id)}
                            className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title="Remover regra de aprendizado"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MODAL DE IMPORTAÇÃO RETROATIVA MANUAL (D2) */}
      <Dialog open={isRetroactiveModalOpen} onOpenChange={setIsRetroactiveModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-indigo-950">
              <Clock className="h-5 w-5 text-indigo-600" />
              <span>Importação Retroativa Manual (D2)</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Solicita ao worker a busca de notas autorizadas em janela retroativa configurada. As
              notas passam pelo fluxo oficial com proteção total de deduplicação (Guard 1a).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Janela de Busca (em dias)
              </Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={retroactiveDays}
                onChange={(e) => setRetroactiveDays(Number(e.target.value))}
                placeholder="30"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-slate-500">
                Padrão recomendado: últimos 30 dias. Notas já existentes no CRM serão ignoradas pela
                deduplicação (Guard 1a).
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsRetroactiveModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={enqueuingCommand}
              onClick={handleConfirmRetroactive}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {enqueuingCommand ? 'Enfileirando...' : 'Iniciar Importação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE UPLOAD DE XML */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              <span>Ingestão de NF-e (Upload Manual)</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Envie o arquivo .XML da nota fiscal de compra fornecida pelo emissor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors bg-slate-50/50">
              <FileText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700">
                Selecione o arquivo .XML no seu computador
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Guard 1b: Somente XML válido de NF-e é aceito.
              </p>
              <input
                type="file"
                accept=".xml"
                onChange={handleFileUpload}
                disabled={uploading}
                className="mt-4 text-xs mx-auto block file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase">
                <span className="bg-white px-2 text-slate-400 font-bold">
                  Ou cole o texto do XML
                </span>
              </div>
            </div>

            <div>
              <textarea
                placeholder="<nfeProc ...>...</nfeProc>"
                value={xmlTextInput}
                onChange={(e) => setXmlTextInput(e.target.value)}
                disabled={uploading}
                className="w-full h-28 text-[11px] font-mono p-3 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsUploadOpen(false)}
              disabled={uploading}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleTextUpload}
              disabled={uploading || !xmlTextInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1.5"
            >
              {uploading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <span>Processar XML</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE RECONCILIAÇÃO HUMANA (MA-t) */}
      <Dialog
        open={Boolean(reconcilingItem)}
        onOpenChange={(open) => !open && setReconcilingItem(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <span>Reconciliação de Item (Item do XML → Produto do Catálogo)</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Selecione o produto correspondente no catálogo. A confirmação gravará o mapeamento de
              aprendizado (MA-t) e o custo real da NF no produto.
            </DialogDescription>
          </DialogHeader>

          {reconcilingItem && (
            <div className="space-y-4 py-2">
              <div className="bg-amber-50/60 p-3 rounded-lg border border-amber-200 text-xs text-amber-950">
                <div className="font-bold">Item no XML do Fornecedor:</div>
                <div className="text-sm font-semibold mt-0.5">{reconcilingItem.description}</div>
                <div className="flex gap-4 mt-2 text-[11px] font-mono text-amber-900">
                  <span>
                    Cód: <strong>{reconcilingItem.supplier_code || '-'}</strong>
                  </span>
                  <span>
                    Qtd: <strong>{reconcilingItem.quantity}</strong>
                  </span>
                  <span>
                    Custo Real: <strong>{formatCurrency(reconcilingItem.unit_cost)}</strong>
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Buscar no Catálogo de Produtos:
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={reconcileSearch}
                    onChange={(e) => {
                      setReconcileSearch(e.target.value)
                      searchProductsForReconcile(e.target.value)
                    }}
                    placeholder="Digite SKU, código reduzido ou nome..."
                    className="h-9 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => searchProductsForReconcile(reconcileSearch)}
                    disabled={loadingProducts}
                    className="h-9 text-xs"
                  >
                    Buscar
                  </Button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {loadingProducts ? (
                  <div className="p-4 text-center text-xs text-slate-400">Buscando produtos...</div>
                ) : productList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    Nenhum produto encontrado. Tente refinar a busca.
                  </div>
                ) : (
                  productList.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={`p-2.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        selectedProductId === p.id
                          ? 'bg-amber-100/60 border-l-4 border-amber-600'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900">
                          {p.sku} - {p.name}
                        </div>
                        <div className="text-[10px] text-slate-500 flex gap-3 mt-0.5">
                          {p.reduced_code && <span>Cód Reduzido: {p.reduced_code}</span>}
                          <span>Família: {p.sou_family || 'Geral'}</span>
                          <span>Preço Atual: {formatCurrency(p.price || 0)}</span>
                        </div>
                      </div>
                      <input
                        type="radio"
                        checked={selectedProductId === p.id}
                        onChange={() => setSelectedProductId(p.id)}
                        className="text-amber-600 focus:ring-amber-500"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReconcilingItem(null)}
              disabled={reconcilingLoading}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmReconcile}
              disabled={reconcilingLoading || !selectedProductId}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5"
            >
              {reconcilingLoading ? 'Gravando...' : 'Confirmar e Aprender'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE APROVAÇÃO DE PREÇO SUGERIDO (PAUTA DE TRABALHO) */}
      <Dialog
        open={Boolean(approvingItem)}
        onOpenChange={(open) => !open && setApprovingItem(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span>Aprovar Preço de Venda (Pauta)</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Conferir e gravar o preço de venda no catálogo para o SKU {approvingItem?.sku}.
            </DialogDescription>
          </DialogHeader>

          {approvingItem && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <div className="font-bold text-slate-800">{approvingItem.description}</div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] text-slate-600">
                  <div>
                    SKU: <strong>{approvingItem.sku}</strong>
                  </div>
                  <div>
                    Família: <strong>{approvingItem.family || 'Padrão'}</strong>
                  </div>
                  <div>
                    Custo Real NF: <strong>{formatCurrency(approvingItem.unit_cost)}</strong>
                  </div>
                  <div>
                    Margem: <strong>{approvingItem.margin_factor || 0}x</strong>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Preço de Venda Final (R$):
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="h-10 text-base font-bold text-emerald-700"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Guard 6b: Não deve ser inferior ao custo real (
                  {formatCurrency(approvingItem.unit_cost)}).
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApprovingItem(null)}
              disabled={approvingLoading}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmApprovePrice}
              disabled={approvingLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {approvingLoading ? 'Gravando...' : 'Gravar Preço no Produto'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
