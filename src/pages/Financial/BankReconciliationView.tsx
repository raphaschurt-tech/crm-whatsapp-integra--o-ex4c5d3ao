import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Landmark,
  Upload,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  FileText,
  Calendar,
  DollarSign,
  ArrowDownCircle,
  ArrowUpCircle,
  RotateCcw,
  PlusCircle,
  EyeOff,
  Filter,
  Check,
  Search,
  Scale,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  Info,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency } from '@/lib/whatsapp'
import {
  BankAccount,
  FinancialCategory,
  StatementLineWithMatch,
  MatchCandidate,
  MatchSuggestionConfidence,
} from '@/types/crm'
import { getActiveBankAccounts } from '@/services/bankAccounts'
import { getFinancialCategories } from '@/services/financial'
import {
  readBankStatementFile,
  parseOfxContent,
  parseCsvContent,
  ParsedStatementResult,
} from '@/services/statementParser'
import {
  buildReconciliationMatches,
  importBankStatement,
  confirmReconciliationMatch,
  createAdHocEntryAndReconcile,
  ignoreStatementLine,
  undoReconciliation,
  calculateAccountCompetenceClosing,
  saveBankReconciliationClosing,
  getPluggyStatus,
  syncPluggyStatement,
  PluggyStatusResult,
} from '@/services/bankReconciliation'

export function BankReconciliationView() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Estado geral
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [categories, setCategories] = useState<FinancialCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Linhas do extrato e casamentos
  const [matches, setMatches] = useState<StatementLineWithMatch[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [reconciledCount, setReconciledCount] = useState(0)
  const [ignoredCount, setIgnoredCount] = useState(0)

  // Filtros de visualização
  const [statusFilter, setStatusFilter] = useState<
    'todos' | 'pendente' | 'conciliado' | 'ignorado'
  >('pendente')
  const [confidenceFilter, setConfidenceFilter] = useState<'todos' | MatchSuggestionConfidence>(
    'todos',
  )
  const [typeFilter, setTypeFilter] = useState<'todos' | 'debito' | 'credito'>('todos')
  const [searchTerm, setSearchTerm] = useState('')

  // Estado e Controle Sincronização Pluggy (Open Finance)
  const [pluggyStatus, setPluggyStatus] = useState<PluggyStatusResult | null>(null)
  const [syncingPluggy, setSyncingPluggy] = useState(false)
  const [pluggyModalOpen, setPluggyModalOpen] = useState(false)
  const [pluggyErrorMessage, setPluggyErrorMessage] = useState<string | null>(null)

  // Modal de Importação de Arquivo
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileParsing, setFileParsing] = useState(false)
  const [parsedPreview, setParsedPreview] = useState<ParsedStatementResult | null>(null)
  const [importing, setImporting] = useState(false)

  // Modal de Lançamento Avulso (tarifa/TED/transferência)
  const [adHocModalOpen, setAdHocModalOpen] = useState(false)
  const [adHocTargetMatch, setAdHocTargetMatch] = useState<StatementLineWithMatch | null>(null)
  const [adHocDesc, setAdHocDesc] = useState('')
  const [adHocCategoryId, setAdHocCategoryId] = useState('')
  const [adHocPaymentMethod, setAdHocPaymentMethod] = useState('outros')
  const [adHocNotes, setAdHocNotes] = useState('')
  const [savingAdHoc, setSavingAdHoc] = useState(false)

  // Modal de Seleção de Candidato Alternativo (para sugestões dúbias)
  const [selectCandidateModalOpen, setSelectCandidateModalOpen] = useState(false)
  const [selectTargetMatch, setSelectTargetMatch] = useState<StatementLineWithMatch | null>(null)

  // Fechamento de Competência
  const [competence, setCompetence] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [closingData, setClosingData] = useState<any | null>(null)
  const [closingModalOpen, setClosingModalOpen] = useState(false)
  const [closingNotes, setClosingNotes] = useState('')
  const [savingClosing, setSavingClosing] = useState(false)

  // Carrega contas bancárias e categorias no boot
  useEffect(() => {
    loadInitialData()
  }, [])

  // Carrega casamentos quando a conta selecionada mudar
  useEffect(() => {
    if (selectedAccountId) {
      loadReconciliationData(selectedAccountId)
    } else {
      setMatches([])
    }
  }, [selectedAccountId])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const [accs, cats, pStatus] = await Promise.all([
        getActiveBankAccounts(),
        getFinancialCategories(),
        getPluggyStatus(),
      ])
      setBankAccounts(accs)
      setCategories(cats)
      setPluggyStatus(pStatus)

      if (accs.length > 0) {
        // Pré-seleciona a conta Itaú se existir, ou a primeira ativa
        const itau = accs.find(
          (a) => a.bank_code === '341' || a.nickname.toLowerCase().includes('itau'),
        )
        setSelectedAccountId(itau ? itau.id : accs[0].id)
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao carregar dados',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const loadReconciliationData = async (accountId: string) => {
    setRefreshing(true)
    try {
      const res = await buildReconciliationMatches(accountId)
      setMatches(res.linesWithMatches)
      setPendingCount(res.pendingLinesCount)
      setReconciledCount(res.reconciledLinesCount)
      setIgnoredCount(res.ignoredLinesCount)
    } catch (err: any) {
      toast({
        title: 'Erro ao carregar conciliação',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setRefreshing(false)
    }
  }

  // Linhas filtradas
  const filteredMatches = useMemo(() => {
    return matches.filter((item) => {
      // Filtro de status
      if (statusFilter !== 'todos' && item.line.status !== statusFilter) {
        return false
      }

      // Filtro de confiança (apenas para pendentes)
      if (
        item.line.status === 'pendente' &&
        confidenceFilter !== 'todos' &&
        item.confidence !== confidenceFilter
      ) {
        return false
      }

      // Filtro de tipo
      if (typeFilter !== 'todos' && item.line.type !== typeFilter) {
        return false
      }

      // Busca por texto
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim()
        const matchLine =
          item.line.description.toLowerCase().includes(query) ||
          (item.line.memo && item.line.memo.toLowerCase().includes(query)) ||
          item.line.amount.toString().includes(query) ||
          item.line.date.includes(query)

        const matchCandidate = item.bestMatch
          ? item.bestMatch.description.toLowerCase().includes(query) ||
            (item.bestMatch.entity_name && item.bestMatch.entity_name.toLowerCase().includes(query))
          : false

        if (!matchLine && !matchCandidate) return false
      }

      return true
    })
  }, [matches, statusFilter, confidenceFilter, typeFilter, searchTerm])

  // Lida com seleção de arquivo de extrato
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setFileParsing(true)
    setParsedPreview(null)

    try {
      const { content, format } = await readBankStatementFile(file)
      let parsed: ParsedStatementResult
      if (format === 'ofx') {
        parsed = parseOfxContent(content)
      } else {
        parsed = parseCsvContent(content)
      }

      if (parsed.errors.length > 0) {
        toast({
          title: 'Aviso ao ler extrato',
          description: parsed.errors.join('; '),
          variant: 'destructive',
        })
      }

      setParsedPreview(parsed)
    } catch (err: any) {
      toast({
        title: 'Erro ao processar arquivo',
        description: `O arquivo está ilegível ou corrompido: ${err.message || String(err)}`,
        variant: 'destructive',
      })
    } finally {
      setFileParsing(false)
    }
  }

  // Ação de Sincronização Pluggy (Extrato Automático)
  const handleSyncPluggy = async (force: boolean = false) => {
    if (!selectedAccountId) {
      toast({
        title: 'Selecione uma conta bancária',
        description: 'É necessário selecionar uma conta bancária para sincronizar o extrato.',
        variant: 'destructive',
      })
      return
    }

    setSyncingPluggy(true)
    setPluggyErrorMessage(null)

    try {
      const res = await syncPluggyStatement({
        bankAccountId: selectedAccountId,
        force,
      })

      toast({
        title: 'Extrato sincronizado com sucesso!',
        description: `${res.imported_count} novas transações importadas (${res.duplicated_count} já existentes ignoradas).`,
      })

      // Atualiza status e casamentos
      const updatedStatus = await getPluggyStatus()
      setPluggyStatus(updatedStatus)
      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      const msg = err.message || 'Erro ao sincronizar com a Pluggy.'
      setPluggyErrorMessage(msg)

      // Se for ausência de credenciais ou consentimento expirado, abre modal explicativo
      if (
        err.code === 'MISSING_CREDENTIALS' ||
        err.code === 'USER_AUTHORIZATION_EXPIRED' ||
        msg.toLowerCase().includes('credenciais pluggy') ||
        msg.toLowerCase().includes('meu.pluggy.ai')
      ) {
        setPluggyModalOpen(true)
      } else {
        toast({
          title: 'Aviso na sincronização',
          description: msg,
          variant: err.code === 'RATE_LIMIT_COOLDOWN' ? 'default' : 'destructive',
        })
      }
    } finally {
      setSyncingPluggy(false)
    }
  }

  // Confirmação de importação do extrato
  const handleConfirmImport = async () => {
    if (!selectedAccountId || !parsedPreview || parsedPreview.transactions.length === 0) {
      return
    }

    setImporting(true)
    try {
      const res = await importBankStatement({
        bankAccountId: selectedAccountId,
        transactions: parsedPreview.transactions,
        fileName: selectedFile?.name,
      })

      toast({
        title: 'Importação concluída',
        description: `${res.importedCount} linhas importadas com sucesso (${res.duplicatedCount} linhas duplicadas ignoradas).`,
      })

      setImportModalOpen(false)
      setSelectedFile(null)
      setParsedPreview(null)
      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      toast({
        title: 'Erro na importação',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setImporting(false)
    }
  }

  // Ação de confirmar casamento (1 clique)
  const handleConfirmMatch = async (item: StatementLineWithMatch, candidate?: MatchCandidate) => {
    const targetCandidate = candidate || item.bestMatch
    if (!targetCandidate) return

    try {
      await confirmReconciliationMatch({
        lineId: item.line.id,
        candidate: targetCandidate,
      })

      toast({
        title: 'Lançamento conciliado!',
        description: `Vinculado com sucesso e marcado como pago em ${item.line.date.substring(0, 10)}.`,
      })

      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      toast({
        title: 'Erro ao conciliar',
        description: err.message || String(err),
        variant: 'destructive',
      })
    }
  }

  // Ignorar linha
  const handleIgnoreLine = async (lineId: string) => {
    try {
      await ignoreStatementLine(lineId)
      toast({
        title: 'Linha ignorada',
        description: 'A linha não será considerada pendente na conciliação.',
      })
      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      toast({
        title: 'Erro ao ignorar',
        description: err.message || String(err),
        variant: 'destructive',
      })
    }
  }

  // Desfazer conciliação
  const handleUndo = async (lineId: string) => {
    try {
      await undoReconciliation(lineId)
      toast({
        title: 'Conciliação desfeita',
        description: 'A linha voltou ao status pendente.',
      })
      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      toast({
        title: 'Erro ao desfazer',
        description: err.message || String(err),
        variant: 'destructive',
      })
    }
  }

  // Abre modal de lançamento avulso
  const handleOpenAdHocModal = (item: StatementLineWithMatch) => {
    setAdHocTargetMatch(item)
    setAdHocDesc(item.line.description)
    setAdHocNotes('')
    setAdHocCategoryId('')
    setAdHocPaymentMethod(item.line.type === 'debito' ? 'PIX' : 'PIX')
    setAdHocModalOpen(true)
  }

  // Salva lançamento avulso e concilia
  const handleSaveAdHoc = async () => {
    if (!adHocTargetMatch) return

    setSavingAdHoc(true)
    try {
      await createAdHocEntryAndReconcile({
        lineId: adHocTargetMatch.line.id,
        description: adHocDesc,
        categoryId: adHocCategoryId || undefined,
        paymentMethod: adHocPaymentMethod,
        notes: adHocNotes,
      })

      toast({
        title: 'Lançamento avulso registrado e conciliado!',
        description: 'Gerado no CRM com a data real do extrato.',
      })

      setAdHocModalOpen(false)
      setAdHocTargetMatch(null)
      await loadReconciliationData(selectedAccountId)
    } catch (err: any) {
      toast({
        title: 'Erro ao criar lançamento avulso',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setSavingAdHoc(false)
    }
  }

  // Calcula e abre fechamento da competência
  const handleOpenClosing = async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const data = await calculateAccountCompetenceClosing({
        bankAccountId: selectedAccountId,
        competence,
      })
      setClosingData(data)
      setClosingNotes('')
      setClosingModalOpen(true)
    } catch (err: any) {
      toast({
        title: 'Erro ao calcular fechamento',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Salva fechamento de conciliação
  const handleSaveClosing = async () => {
    if (!closingData) return
    setSavingClosing(true)
    try {
      await saveBankReconciliationClosing({
        bankAccountId: selectedAccountId,
        competence,
        statementClosingBalance: closingData.statementClosingBalance,
        crmCalculatedBalance: closingData.crmCalculatedBalance,
        differenceAmount: closingData.differenceAmount,
        status: closingData.isReconciled ? 'conciliado' : 'divergente',
        pendingLinesCount: closingData.pendingLinesCount,
        notes: closingNotes,
      })

      toast({
        title: 'Fechamento de competência salvo!',
        description: closingData.isReconciled
          ? 'Competência conciliada sem divergência.'
          : `Fechamento registrado com divergência de ${formatCurrency(closingData.differenceAmount)}.`,
      })

      setClosingModalOpen(false)
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar fechamento',
        description: err.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setSavingClosing(false)
    }
  }

  const selectedAccount = bankAccounts.find((a) => a.id === selectedAccountId)

  return (
    <div className="space-y-6 p-1 sm:p-2">
      {/* Barra Superior: Seleção de Conta, Ações e KPIs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            Conciliação Bancária
          </h2>
          <p className="text-sm text-slate-500">
            Importe extratos OFX/CSV, case lançamentos com confirmação humana em 1 clique e feche a
            competência.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Conta Bancária */}
          <div className="w-56">
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Escolha a Conta..." />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.nickname} ({acc.bank_name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadReconciliationData(selectedAccountId)}
            disabled={refreshing || !selectedAccountId}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>

          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => handleSyncPluggy(false)}
            disabled={syncingPluggy || !selectedAccountId}
            title={
              pluggyStatus && !pluggyStatus.has_credentials
                ? 'Credenciais Pluggy não configuradas'
                : pluggyStatus && !pluggyStatus.can_sync_now
                  ? 'Aguarde o intervalo Open Finance'
                  : 'Sincronizar extrato bancário automaticamente via Meu Pluggy'
            }
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncingPluggy ? 'animate-spin' : ''}`} />
            Sincronizar extrato
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportModalOpen(true)}
            disabled={!selectedAccountId}
          >
            <Upload className="h-4 w-4 mr-1" />
            Importar Extrato (OFX/CSV)
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenClosing}
            disabled={!selectedAccountId}
          >
            <Scale className="h-4 w-4 mr-1" />
            Fechamento Mensal
          </Button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
              Pendentes de Conciliação
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-amber-900">{pendingCount}</div>
            <p className="text-xs text-amber-700 mt-1">Aguardando conferência humana</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
              Conciliadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-emerald-900">{reconciledCount}</div>
            <p className="text-xs text-emerald-700 mt-1">Casadas e confirmadas</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-slate-50/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Ignoradas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-slate-800">{ignoredCount}</div>
            <p className="text-xs text-slate-500 mt-1">Transferências internas / neutras</p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-blue-800 uppercase tracking-wider">
              Conta Selecionada
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-sm font-bold text-blue-900 truncate">
              {selectedAccount?.nickname || 'Nenhuma conta'}
            </div>
            <p className="text-xs text-blue-700 mt-1">
              Ag: {selectedAccount?.agency || '-'} | C/C: {selectedAccount?.account_number || '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros e Busca */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar por descrição, valor ou data..."
                  className="pl-9 bg-white"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="w-40">
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Apenas Pendentes</SelectItem>
                  <SelectItem value="conciliado">Apenas Conciliadas</SelectItem>
                  <SelectItem value="ignorado">Apenas Ignoradas</SelectItem>
                  <SelectItem value="todos">Todos os Status</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {statusFilter === 'pendente' && (
              <div className="w-48">
                <Select value={confidenceFilter} onValueChange={(v: any) => setConfidenceFilter(v)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Sugestão" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as Sugestões</SelectItem>
                    <SelectItem value="provavel">✅ Provável</SelectItem>
                    <SelectItem value="dubia">❓ Dúbia (2+ candidatos)</SelectItem>
                    <SelectItem value="sem_correspondencia">⬜ Sem correspondência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="w-36">
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Tipos</SelectItem>
                  <SelectItem value="debito">Saídas (Débito)</SelectItem>
                  <SelectItem value="credito">Entradas (Crédito)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Conciliação em Lado a Lado (Linha do Extrato × Lançamento Sugerido do CRM) */}
      <Card>
        <CardHeader className="p-4 border-b bg-slate-50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-800">
              Extrato Bancário Importado × Lançamentos a Pagar/Receber no CRM
            </CardTitle>
            <span className="text-xs text-slate-500 font-normal">
              Mostrando {filteredMatches.length} de {matches.length} linhas
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0 divide-y divide-slate-100">
          {filteredMatches.length === 0 ? (
            <div className="p-8 text-center text-slate-500 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto" />
              <p className="text-sm font-medium">
                Nenhuma linha encontrada para os filtros selecionados.
              </p>
              {matches.length === 0 && (
                <p className="text-xs text-slate-400">
                  Clique em "Importar Extrato (OFX/CSV)" para carregar os lançamentos bancários da
                  conta.
                </p>
              )}
            </div>
          ) : (
            filteredMatches.map((item) => {
              const line = item.line
              const isDebit = line.type === 'debito'
              const bestMatch = item.bestMatch
              const isReconciled = line.status === 'conciliado'
              const isIgnored = line.status === 'ignorado'

              return (
                <div
                  key={line.id}
                  className={`p-4 transition-colors ${
                    isReconciled
                      ? 'bg-emerald-50/20'
                      : isIgnored
                        ? 'bg-slate-50/50 opacity-75'
                        : item.confidence === 'provavel'
                          ? 'bg-blue-50/15'
                          : 'hover:bg-slate-50/40'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                    {/* Coluna Esquerda: Linha do Extrato (5 colunas) */}
                    <div className="lg:col-span-5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-slate-500">
                          {line.date.substring(0, 10)}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            isDebit
                              ? 'bg-rose-50 text-rose-700 border-rose-200 text-[10px]'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]'
                          }
                        >
                          {isDebit ? 'Saída' : 'Entrada'}
                        </Badge>
                        {line.fitid && (
                          <span
                            className="text-[10px] text-slate-400 font-mono"
                            title={`FITID: ${line.fitid}`}
                          >
                            ID: {line.fitid.substring(0, 12)}
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-semibold text-slate-900 break-words">
                        {line.description}
                      </div>

                      {line.memo && line.memo !== line.description && (
                        <div className="text-xs text-slate-500 italic break-words">{line.memo}</div>
                      )}

                      <div
                        className={`text-base font-bold ${
                          isDebit ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {isDebit ? '-' : '+'}
                        {formatCurrency(Math.abs(line.amount))}
                      </div>
                    </div>

                    {/* Coluna Central: Indicador de Confiança / Status (2 colunas) */}
                    <div className="lg:col-span-2 flex flex-col items-center justify-center text-center py-2 lg:py-0 border-y lg:border-y-0 lg:border-x border-slate-100">
                      {isReconciled ? (
                        <div className="flex flex-col items-center text-emerald-700">
                          <CheckCircle2 className="h-5 w-5 mb-1" />
                          <span className="text-xs font-bold uppercase tracking-wider">
                            Conciliado
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {line.reconciled_at ? line.reconciled_at.substring(0, 10) : ''}
                          </span>
                        </div>
                      ) : isIgnored ? (
                        <div className="flex flex-col items-center text-slate-400">
                          <EyeOff className="h-5 w-5 mb-1" />
                          <span className="text-xs font-semibold uppercase tracking-wider">
                            Ignorado
                          </span>
                        </div>
                      ) : item.confidence === 'provavel' ? (
                        <div className="flex flex-col items-center text-emerald-700">
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 flex items-center gap-1">
                            <Check className="h-3 w-3" />
                            Provável
                          </Badge>
                          <span className="text-[10px] text-emerald-600 mt-1">
                            1 candidato forte
                          </span>
                        </div>
                      ) : item.confidence === 'dubia' ? (
                        <div className="flex flex-col items-center text-amber-700">
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 flex items-center gap-1">
                            <HelpCircle className="h-3 w-3" />
                            Dúbia
                          </Badge>
                          <span className="text-[10px] text-amber-600 mt-1">
                            {item.candidates.length} candidatos
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Badge variant="outline" className="text-slate-500 border-slate-200">
                            Sem Par
                          </Badge>
                          <span className="text-[10px] text-slate-400 mt-1">0 candidatos</span>
                        </div>
                      )}
                    </div>

                    {/* Coluna Direita: Lançamento do CRM e Ações (5 colunas) */}
                    <div className="lg:col-span-5 flex flex-col justify-between gap-2">
                      {isReconciled ? (
                        <div className="bg-white/80 p-2.5 rounded border border-emerald-100 text-xs space-y-1">
                          <div className="font-semibold text-emerald-900">
                            Vinculado a:{' '}
                            {line.matched_type === 'payable'
                              ? 'Conta a Pagar'
                              : line.matched_type === 'receivable'
                                ? 'Conta a Receber'
                                : line.matched_type === 'avulso_despesa'
                                  ? 'Despesa Avulsa'
                                  : 'Receita Avulsa'}
                          </div>
                          <div className="text-slate-600">
                            {line.expand?.matched_payable?.description ||
                              line.expand?.matched_receivable?.description ||
                              'Lançamento liquidado no CRM'}
                          </div>
                          <div className="pt-1 flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-slate-500 hover:text-rose-600"
                              onClick={() => handleUndo(line.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              Desfazer
                            </Button>
                          </div>
                        </div>
                      ) : isIgnored ? (
                        <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-100/60 p-2 rounded">
                          <span>{line.notes || 'Lançamento ignorado na conciliação'}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleUndo(line.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Restaurar
                          </Button>
                        </div>
                      ) : bestMatch ? (
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-medium text-slate-500">
                                {bestMatch.kind === 'payable' ? 'Conta a Pagar' : 'Conta a Receber'}{' '}
                                • Venc: {bestMatch.due_date}
                              </div>
                              <div className="text-sm font-semibold text-slate-900">
                                {bestMatch.description}
                              </div>
                              {bestMatch.entity_name && (
                                <div className="text-xs text-slate-600 font-medium">
                                  {bestMatch.entity_name}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold text-slate-900">
                                {formatCurrency(bestMatch.amount)}
                              </div>
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-slate-50 text-slate-600"
                              >
                                {bestMatch.status}
                              </Badge>
                            </div>
                          </div>

                          {/* Motivos da sugestão */}
                          <div className="flex flex-wrap gap-1">
                            {bestMatch.reasons.map((r, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600"
                              >
                                {r}
                              </span>
                            ))}
                          </div>

                          {/* Botões de Ação */}
                          <div className="pt-1 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100">
                            {item.candidates.length > 1 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
                                onClick={() => {
                                  setSelectTargetMatch(item)
                                  setSelectCandidateModalOpen(true)
                                }}
                              >
                                Ver outros ({item.candidates.length})
                              </Button>
                            )}

                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-slate-500 hover:text-slate-800"
                              onClick={() => handleIgnoreLine(line.id)}
                            >
                              Ignorar
                            </Button>

                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                              onClick={() => handleConfirmMatch(item, bestMatch)}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Confirmar Casamento
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-50 p-3 rounded-lg border border-dashed border-slate-200 text-xs space-y-2">
                          <div className="text-slate-600">
                            Nenhum lançamento a pagar/receber no CRM coincide com este valor e data.
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-slate-500"
                              onClick={() => handleIgnoreLine(line.id)}
                            >
                              Ignorar Linha
                            </Button>

                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs bg-primary text-white"
                              onClick={() => handleOpenAdHocModal(item)}
                            >
                              <PlusCircle className="h-3.5 w-3.5 mr-1" />
                              Lançar como Avulso
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Modal de Importação de Extrato (OFX / CSV) */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Importar Extrato Bancário
            </DialogTitle>
            <DialogDescription>
              Selecione o arquivo OFX ou CSV do banco para a conta{' '}
              <strong>{selectedAccount?.nickname}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-4 border-2 border-dashed border-slate-200 rounded-lg text-center hover:bg-slate-50/50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,.qfx,.csv,.txt"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileParsing || importing}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {selectedFile ? 'Trocar Arquivo' : 'Escolher Arquivo OFX ou CSV'}
              </Button>
              {selectedFile && (
                <p className="text-xs text-slate-600 mt-2 font-medium">
                  Arquivo selecionado: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)}{' '}
                  KB)
                </p>
              )}
              <p className="text-[11px] text-slate-400 mt-1">
                Suporta OFX SGML/XML (Itaú, Bradesco, BB, Santander, etc.) e CSV brasileiro.
                Antiduplicação automática por data, valor e descrição.
              </p>
            </div>

            {/* Preview do arquivo parseado */}
            {parsedPreview && (
              <div className="bg-slate-50 p-3 rounded border text-xs space-y-2">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span>Prévia do Extrato</span>
                  <Badge variant="outline">{parsedPreview.rawFormat.toUpperCase()}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-200">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Total Linhas</span>
                    <span className="font-bold text-slate-900">
                      {parsedPreview.transactions.length}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Entradas</span>
                    <span className="font-bold text-emerald-700">
                      +{formatCurrency(parsedPreview.totalInflows)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Saídas</span>
                    <span className="font-bold text-rose-700">
                      -{formatCurrency(parsedPreview.totalOutflows)}
                    </span>
                  </div>
                </div>

                {parsedPreview.header.closingBalance !== undefined && (
                  <div className="text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                    Saldo final informado no extrato:{' '}
                    <strong>{formatCurrency(parsedPreview.header.closingBalance)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportModalOpen(false)
                setSelectedFile(null)
                setParsedPreview(null)
              }}
              disabled={importing}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={!parsedPreview || parsedPreview.transactions.length === 0 || importing}
              className="bg-primary text-white"
            >
              {importing ? 'Importando...' : 'Confirmar Importação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Lançamento Avulso (Tarifa / TED / Recebimento Avulso) */}
      <Dialog open={adHocModalOpen} onOpenChange={setAdHocModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançamento Avulso</DialogTitle>
            <DialogDescription>
              Classifique a linha do extrato como despesa ou receita avulsa no CRM.
            </DialogDescription>
          </DialogHeader>

          {adHocTargetMatch && (
            <div className="space-y-3 py-2 text-sm">
              <div className="p-2.5 bg-slate-50 rounded border text-xs space-y-1">
                <div className="flex justify-between font-medium">
                  <span className="text-slate-500">Data no Extrato:</span>
                  <span className="font-mono">{adHocTargetMatch.line.date.substring(0, 10)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-500">Valor Real:</span>
                  <span
                    className={
                      adHocTargetMatch.line.type === 'debito'
                        ? 'text-rose-700 font-bold'
                        : 'text-emerald-700 font-bold'
                    }
                  >
                    {formatCurrency(Math.abs(adHocTargetMatch.line.amount))} (
                    {adHocTargetMatch.line.type === 'debito' ? 'Despesa' : 'Receita'})
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="adHocDesc" className="text-xs">
                  Descrição
                </Label>
                <Input
                  id="adHocDesc"
                  value={adHocDesc}
                  onChange={(e) => setAdHocDesc(e.target.value)}
                  placeholder="Ex: Tarifa de Manutenção de Conta"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="adHocCat" className="text-xs">
                  Categoria Financeira
                </Label>
                <Select value={adHocCategoryId} onValueChange={setAdHocCategoryId}>
                  <SelectTrigger id="adHocCat" className="bg-white">
                    <SelectValue placeholder="Selecione a categoria..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) =>
                        adHocTargetMatch.line.type === 'debito'
                          ? c.type === 'despesa'
                          : c.type === 'receita',
                      )
                      .map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="adHocNotes" className="text-xs">
                  Observações (Opcional)
                </Label>
                <Textarea
                  id="adHocNotes"
                  rows={2}
                  value={adHocNotes}
                  onChange={(e) => setAdHocNotes(e.target.value)}
                  placeholder="Detalhes adicionais..."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdHocModalOpen(false)}
              disabled={savingAdHoc}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveAdHoc} disabled={savingAdHoc || !adHocDesc.trim()}>
              {savingAdHoc ? 'Salvando...' : 'Criar e Conciliar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Seleção de Candidato Alternativo (para sugestões dúbias) */}
      <Dialog open={selectCandidateModalOpen} onOpenChange={setSelectCandidateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Escolher Lançamento Correspondente</DialogTitle>
            <DialogDescription>
              Foram encontrados múltiplos lançamentos com valor e data próximos. Selecione o
              lançamento correto para conciliar com um clique.
            </DialogDescription>
          </DialogHeader>

          {selectTargetMatch && (
            <div className="space-y-3 py-2">
              <div className="text-xs p-2 bg-slate-50 rounded border">
                <strong>Extrato:</strong> {selectTargetMatch.line.description} •{' '}
                {formatCurrency(Math.abs(selectTargetMatch.line.amount))} •{' '}
                {selectTargetMatch.line.date.substring(0, 10)}
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {selectTargetMatch.candidates.map((cand) => (
                  <div
                    key={cand.id}
                    className="p-3 border rounded-lg hover:border-primary/50 transition-colors flex items-center justify-between gap-3 bg-white"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-slate-900">{cand.description}</div>
                      {cand.entity_name && <div className="text-slate-600">{cand.entity_name}</div>}
                      <div className="text-slate-400">
                        Vencimento: {cand.due_date} • Status: {cand.status}
                      </div>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {cand.reasons.map((r, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] bg-slate-100 text-slate-600 px-1 py-0.5 rounded"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                      onClick={() => {
                        handleConfirmMatch(selectTargetMatch, cand)
                        setSelectCandidateModalOpen(false)
                      }}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Escolher
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectCandidateModalOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Fechamento por Conta / Competência */}
      <Dialog open={closingModalOpen} onOpenChange={setClosingModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              Fechamento de Competência
            </DialogTitle>
            <DialogDescription>
              Comparativo entre o saldo real do extrato e o saldo calculado pelo CRM (saldo inicial
              + liquidados).
            </DialogDescription>
          </DialogHeader>

          {closingData && (
            <div className="space-y-4 py-2 text-sm">
              <div className="flex items-center gap-3">
                <Label htmlFor="compInput" className="text-xs font-semibold shrink-0">
                  Competência:
                </Label>
                <Input
                  id="compInput"
                  type="month"
                  value={competence}
                  onChange={(e) => setCompetence(e.target.value)}
                  className="w-44 bg-white"
                />
                <Button variant="outline" size="sm" onClick={handleOpenClosing} disabled={loading}>
                  Recalcular
                </Button>
              </div>

              {/* Tabela de Saldos */}
              <div className="bg-slate-50 p-3 rounded-lg border space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Saldo Inicial da Conta:</span>
                  <span className="font-semibold">
                    {formatCurrency(closingData.initialBalance)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-emerald-700 font-medium">
                    (+) Entradas Liquidadas no CRM:
                  </span>
                  <span className="font-semibold text-emerald-700">
                    +{formatCurrency(closingData.totalInflows)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-rose-700 font-medium">(-) Saídas Liquidadas no CRM:</span>
                  <span className="font-semibold text-rose-700">
                    -{formatCurrency(closingData.totalOutflows)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 font-bold text-slate-900 border-b border-slate-300">
                  <span>(=) Saldo Calculado no CRM:</span>
                  <span>{formatCurrency(closingData.crmCalculatedBalance)}</span>
                </div>
                <div className="flex justify-between py-1.5 font-bold text-blue-900 border-b border-slate-300">
                  <span>(=) Saldo do Extrato Bancário:</span>
                  <span>{formatCurrency(closingData.statementClosingBalance)}</span>
                </div>
                <div
                  className={`flex justify-between py-2 text-sm font-bold rounded px-2 ${
                    closingData.isReconciled
                      ? 'bg-emerald-100/70 text-emerald-900'
                      : 'bg-rose-100/70 text-rose-900'
                  }`}
                >
                  <span>Divergência:</span>
                  <span>{formatCurrency(closingData.differenceAmount)}</span>
                </div>
              </div>

              {/* Alerta de status */}
              {closingData.isReconciled ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    <strong>Competência Conciliada!</strong> O saldo do CRM bate perfeitamente com o
                    extrato.
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>
                      Divergência detectada ({formatCurrency(closingData.differenceAmount)})
                    </span>
                  </div>
                  {closingData.pendingLinesCount > 0 && (
                    <p className="text-[11px]">
                      Ainda existem{' '}
                      <strong>{closingData.pendingLinesCount} linha(s) pendente(s)</strong> no
                      extrato deste período aguardando conciliação.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="closingNotes" className="text-xs">
                  Notas de Fechamento (Opcional)
                </Label>
                <Textarea
                  id="closingNotes"
                  rows={2}
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="Justificativa da divergência ou observações da contabilidade..."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClosingModalOpen(false)}
              disabled={savingClosing}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveClosing}
              disabled={savingClosing || !closingData}
              className={closingData?.isReconciled ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {savingClosing ? 'Salvando...' : 'Salvar Fechamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Informativo: Conexão Meu Pluggy / Credenciais */}
      <Dialog open={pluggyModalOpen} onOpenChange={setPluggyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <RefreshCw className="h-5 w-5 text-emerald-600" />
              Sincronização Meu Pluggy
            </DialogTitle>
            <DialogDescription>
              Integração de extrato bancário automático via Open Finance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm text-slate-700">
            {pluggyErrorMessage?.toLowerCase().includes('credenciais pluggy') ||
            (pluggyStatus && !pluggyStatus.has_credentials) ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2 font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  Credenciais Pluggy não configuradas
                </div>
                <p className="text-xs text-amber-800">
                  Para utilizar a sincronização automática, configure as seguintes variáveis de
                  ambiente no backend do CRM:
                </p>
                <div className="bg-amber-100/60 p-2 rounded text-xs font-mono text-amber-950 space-y-1">
                  <div>PLUGGY_CLIENT_ID</div>
                  <div>PLUGGY_CLIENT_SECRET</div>
                </div>
                <p className="text-[11px] text-amber-700">
                  Obtenha suas credenciais gratuitamente em{' '}
                  <a
                    href="https://meu.pluggy.ai/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold"
                  >
                    meu.pluggy.ai
                  </a>
                  . Enquanto isso, você pode continuar importando extratos normalmente pelo botão{' '}
                  <strong>Importar Extrato (OFX/CSV)</strong>.
                </p>
              </div>
            ) : pluggyErrorMessage?.toLowerCase().includes('meu.pluggy.ai') ||
              pluggyErrorMessage?.toLowerCase().includes('consentimento') ? (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2 font-semibold text-rose-900">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  Conexão bancária expirada ou pendente
                </div>
                <p className="text-xs text-rose-800">
                  O consentimento de acesso à sua conta Itaú expirou ou requer nova autorização no
                  Open Finance.
                </p>
                <p className="text-xs text-rose-800 font-medium">
                  Acesse o painel do{' '}
                  <a
                    href="https://meu.pluggy.ai/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-rose-900 font-bold"
                  >
                    meu.pluggy.ai
                  </a>{' '}
                  para reconectar/renovar o consentimento da sua conta e depois clique em
                  Sincronizar novamente.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border rounded-lg space-y-2">
                <div className="font-semibold text-slate-800">Detalhes da sincronização:</div>
                <p className="text-xs text-slate-600">{pluggyErrorMessage}</p>
              </div>
            )}

            {pluggyStatus?.last_sync_at && (
              <div className="text-xs text-slate-500 border-t pt-2 space-y-1">
                <div>
                  <strong>Última sincronização:</strong>{' '}
                  {new Date(pluggyStatus.last_sync_at).toLocaleString('pt-BR')}
                </div>
                {pluggyStatus.last_sync_message && (
                  <div className="text-[11px] text-slate-400">{pluggyStatus.last_sync_message}</div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-between items-center sm:justify-between">
            {pluggyStatus?.has_credentials && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPluggyModalOpen(false)
                  handleSyncPluggy(true)
                }}
                disabled={syncingPluggy}
                className="text-xs"
              >
                Forçar Sincronização
              </Button>
            )}
            <Button size="sm" onClick={() => setPluggyModalOpen(false)} className="ml-auto">
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
