import { useState, useEffect, useCallback, useId } from 'react'
import {
  Landmark,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  PowerOff,
  Edit2,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getBankAccountsWithBalance,
  createBankAccount,
  updateBankAccount,
  toggleBankAccountActive,
  checkDuplicateBankAccount,
  FEBRABAN_BANKS,
  BANK_ACCOUNT_TYPE_LABELS,
} from '@/services/bankAccounts'
import { getCustomers } from '@/services/customers'
import { getBrasiliaToday } from '@/services/financial'
import { BankAccountWithBalance, BankAccountType, Customer } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

export function BankAccountsView() {
  const { toast } = useToast()
  const formId = useId()

  const [accounts, setAccounts] = useState<BankAccountWithBalance[]>([])
  const [entities, setEntities] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todas' | 'ativas' | 'inativas'>('todas')

  // Modal de Criação / Edição
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccountWithBalance | null>(null)

  // Campos do formulário
  const [nickname, setNickname] = useState('')
  const [selectedBankCode, setSelectedBankCode] = useState('001')
  const [customBankName, setCustomBankName] = useState('')
  const [agency, setAgency] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState<BankAccountType>('corrente')
  const [selectedEntityId, setSelectedEntityId] = useState<string>('none')
  const [customEntityName, setCustomEntityName] = useState('')
  const [initialBalance, setInitialBalance] = useState('0,00')
  const [initialBalanceDate, setInitialBalanceDate] = useState(() => getBrasiliaToday())
  const [isActive, setIsActive] = useState(true)
  const [notes, setNotes] = useState('')

  // Aviso de antiduplicidade
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [accsWithBalance, customersData] = await Promise.all([
        getBankAccountsWithBalance(),
        getCustomers(),
      ])
      setAccounts(accsWithBalance)
      setEntities(customersData.filter((c) => !!c.cnpj || c.type === 'PJ'))
    } catch (err: any) {
      console.error('Erro ao carregar contas bancárias:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar contas bancárias.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Verificação de antiduplicidade em tempo real durante preenchimento
  useEffect(() => {
    if (!agency.trim() || !accountNumber.trim()) {
      setDuplicateWarning(null)
      return
    }

    let isMounted = true
    const timer = setTimeout(async () => {
      try {
        const dup = await checkDuplicateBankAccount({
          bank_code: selectedBankCode,
          agency,
          account_number: accountNumber,
          account_type: accountType,
          excludeId: editingAccount?.id,
        })
        if (isMounted) {
          if (dup) {
            setDuplicateWarning(
              `Atenção: Já existe uma conta cadastrada com esses mesmos dados: "${dup.nickname}" (Ag: ${dup.agency}, Conta: ${dup.account_number}, Tipo: ${BANK_ACCOUNT_TYPE_LABELS[dup.account_type]}). Como contas conjuntas podem existir, você pode prosseguir, mas confirme se não é uma duplicata acidental.`,
            )
          } else {
            setDuplicateWarning(null)
          }
        }
      } catch (err) {
        console.error('Erro na checagem de antiduplicidade:', err)
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [selectedBankCode, agency, accountNumber, accountType, editingAccount])

  const handleOpenCreate = () => {
    setEditingAccount(null)
    setNickname('')
    setSelectedBankCode('001')
    setCustomBankName('')
    setAgency('')
    setAccountNumber('')
    setAccountType('corrente')
    setSelectedEntityId('none')
    setCustomEntityName('')
    setInitialBalance('0,00')
    setInitialBalanceDate(getBrasiliaToday())
    setIsActive(true)
    setNotes('')
    setDuplicateWarning(null)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (acc: BankAccountWithBalance) => {
    setEditingAccount(acc)
    setNickname(acc.nickname || '')
    setSelectedBankCode(acc.bank_code || '001')
    setCustomBankName(acc.bank_name || '')
    setAgency(acc.agency || '')
    setAccountNumber(acc.account_number || '')
    setAccountType(acc.account_type || 'corrente')
    setSelectedEntityId(acc.customer_entity || 'none')
    setCustomEntityName(acc.entity_name || '')
    setInitialBalance(
      acc.initial_balance !== undefined && acc.initial_balance !== null
        ? String(acc.initial_balance).replace('.', ',')
        : '0,00',
    )
    setInitialBalanceDate(
      acc.initial_balance_date ? acc.initial_balance_date.slice(0, 10) : getBrasiliaToday(),
    )
    setIsActive(acc.is_active ?? true)
    setNotes(acc.notes || '')
    setDuplicateWarning(null)
    setIsModalOpen(true)
  }

  const handleToggleActive = async (acc: BankAccountWithBalance) => {
    const nextActive = !acc.is_active
    const actionText = nextActive ? 'reativar' : 'desativar'
    if (
      !confirm(
        `Deseja ${actionText} a conta bancária "${acc.nickname}"? Nenhuma conta é excluída para preservar o histórico.`,
      )
    ) {
      return
    }

    try {
      await toggleBankAccountActive(acc.id, nextActive)
      toast({
        title: nextActive ? 'Conta reativada' : 'Conta desativada',
        description: `A conta "${acc.nickname}" foi ${nextActive ? 'reativada' : 'desativada'} com sucesso.`,
      })
      loadData()
    } catch (err: any) {
      console.error('Erro ao alterar status da conta:', err)
      toast({
        title: 'Erro ao alterar status',
        description: err?.message || 'Falha ao salvar status da conta.',
        variant: 'destructive',
      })
    }
  }

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!nickname.trim()) {
      toast({
        title: 'Apelido obrigatório',
        description: 'Informe um apelido de identificação da conta.',
        variant: 'destructive',
      })
      return
    }
    if (!agency.trim()) {
      toast({
        title: 'Agência obrigatória',
        description: 'Informe o número da agência bancária.',
        variant: 'destructive',
      })
      return
    }
    if (!accountNumber.trim()) {
      toast({
        title: 'Número da conta obrigatório',
        description: 'Informe o número da conta.',
        variant: 'destructive',
      })
      return
    }

    let bankNameResolved = ''
    if (selectedBankCode === '999') {
      bankNameResolved = customBankName.trim() || 'Outro Banco'
    } else {
      const foundBank = FEBRABAN_BANKS.find((b) => b.code === selectedBankCode)
      bankNameResolved = foundBank ? foundBank.name : 'Banco'
    }

    const cleanBalanceStr = initialBalance.replace(/\./g, '').replace(',', '.')
    const initialBalanceNum = parseFloat(cleanBalanceStr) || 0

    let resolvedEntityId = ''
    let resolvedEntityName = customEntityName.trim()
    if (selectedEntityId && selectedEntityId !== 'none') {
      resolvedEntityId = selectedEntityId
      const foundEntity = entities.find((e) => e.id === selectedEntityId)
      if (foundEntity) {
        resolvedEntityName = foundEntity.company || foundEntity.name
      }
    }

    setIsSubmitting(true)
    try {
      const payload: Record<string, any> = {
        nickname: nickname.trim(),
        bank_code: selectedBankCode,
        bank_name: bankNameResolved,
        agency: agency.trim(),
        account_number: accountNumber.trim(),
        account_type: accountType,
        customer_entity: resolvedEntityId || null,
        entity_name: resolvedEntityName || null,
        initial_balance: initialBalanceNum,
        initial_balance_date: initialBalanceDate ? `${initialBalanceDate} 12:00:00.000Z` : null,
        is_active: isActive,
        notes: notes.trim() || null,
      }

      if (editingAccount) {
        await updateBankAccount(editingAccount.id, payload)
        toast({ title: 'Conta bancária atualizada com sucesso!' })
      } else {
        await createBankAccount(payload)
        toast({ title: 'Conta bancária cadastrada com sucesso!' })
      }

      setIsModalOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao salvar conta bancária:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar conta bancária.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredAccounts = accounts.filter((acc) => {
    if (statusFilter === 'ativas' && !acc.is_active) return false
    if (statusFilter === 'inativas' && acc.is_active) return false

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      const match =
        acc.nickname?.toLowerCase().includes(q) ||
        acc.bank_name?.toLowerCase().includes(q) ||
        acc.bank_code?.toLowerCase().includes(q) ||
        acc.agency?.toLowerCase().includes(q) ||
        acc.account_number?.toLowerCase().includes(q) ||
        acc.entity_name?.toLowerCase().includes(q)
      if (!match) return false
    }

    return true
  })

  const totalBalanceActive = accounts
    .filter((a) => a.is_active)
    .reduce((sum, a) => sum + (a.current_balance || 0), 0)

  return (
    <div className="space-y-6">
      {/* Banner de resumo / KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Saldo Total (Contas Ativas)</span>
              <Wallet className="h-4 w-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${totalBalanceActive >= 0 ? 'text-slate-900' : 'text-rose-600'}`}
            >
              {formatCurrency(totalBalanceActive)}
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              Calculado apenas de lançamentos liquidados
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Contas Ativas</span>
              <Landmark className="h-4 w-4 text-blue-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {accounts.filter((a) => a.is_active).length}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              De um total de {accounts.length} conta{accounts.length === 1 ? '' : 's'} cadastrada
              {accounts.length === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Regra de Conciliação</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold text-slate-800">Multi-conta ativado</div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Lançamentos pendentes não alteram saldo até a confirmação de baixa/liquidação.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Ações e Filtros */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex-1 w-full sm:w-auto flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por apelido, banco, agência, conta ou filial..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
            <SelectTrigger className="w-[140px] h-9 text-xs bg-slate-50">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as contas</SelectItem>
              <SelectItem value="ativas">Somente Ativas</SelectItem>
              <SelectItem value="inativas">Somente Inativas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleOpenCreate}
          className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 font-medium shadow-sm flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nova Conta Bancária
        </Button>
      </div>

      {/* Lista de Contas */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
          Carregando contas bancárias...
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Landmark className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            Nenhuma conta bancária encontrada
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            Cadastre as contas correntes, poupanças, aplicações ou caixas físicos da empresa para
            vincular aos pagamentos e recebimentos.
          </p>
          <Button
            onClick={handleOpenCreate}
            size="sm"
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Cadastrar Primeira Conta
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.map((acc) => {
            const isNegative = (acc.current_balance || 0) < 0
            return (
              <Card
                key={acc.id}
                className={`bg-white border transition-all ${
                  acc.is_active
                    ? 'border-slate-200 hover:border-slate-300 shadow-sm'
                    : 'border-slate-200 bg-slate-50/60 opacity-80'
                }`}
              >
                <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4
                        className="text-sm font-bold text-slate-900 truncate"
                        title={acc.nickname}
                      >
                        {acc.nickname}
                      </h4>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 font-medium ${
                          acc.is_active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-200 text-slate-600 border-slate-300'
                        }`}
                      >
                        {acc.is_active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </div>
                    <p
                      className="text-xs text-slate-500 truncate"
                      title={`${acc.bank_code} - ${acc.bank_name}`}
                    >
                      {acc.bank_code} • {acc.bank_name}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(acc)}
                      className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                      title="Editar conta"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(acc)}
                      className={`h-8 w-8 p-0 ${
                        acc.is_active
                          ? 'text-slate-400 hover:text-rose-600'
                          : 'text-slate-400 hover:text-emerald-600'
                      }`}
                      title={acc.is_active ? 'Desativar conta' : 'Reativar conta'}
                    >
                      <PowerOff className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="pt-3 space-y-3">
                  {/* Dados da conta */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        Agência
                      </span>
                      <span className="font-mono font-medium text-slate-800">{acc.agency}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        Conta
                      </span>
                      <span className="font-mono font-medium text-slate-800">
                        {acc.account_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        Tipo
                      </span>
                      <span className="text-slate-700 font-medium">
                        {BANK_ACCOUNT_TYPE_LABELS[acc.account_type] || acc.account_type}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                        Filial / Titular
                      </span>
                      <span
                        className="text-slate-700 font-medium truncate block"
                        title={acc.entity_name || 'Geral'}
                      >
                        {acc.entity_name || 'Geral (Matriz)'}
                      </span>
                    </div>
                  </div>

                  {/* Saldo Atual */}
                  <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                        Saldo Atual Liquidado
                      </span>
                      <span
                        className={`text-lg font-bold font-mono ${
                          isNegative ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {formatCurrency(acc.current_balance)}
                      </span>
                    </div>

                    <div className="text-right text-[11px] text-slate-500 space-y-0.5">
                      <div className="flex items-center justify-end gap-1 text-emerald-600">
                        <ArrowDownLeft className="h-3 w-3" />
                        <span>+{formatCurrency(acc.total_received)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1 text-rose-600">
                        <ArrowUpRight className="h-3 w-3" />
                        <span>-{formatCurrency(acc.total_paid)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Saldo inicial informativo */}
                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-50">
                    <span>Saldo inicial: {formatCurrency(acc.initial_balance || 0)}</span>
                    <span>
                      {acc.settled_entries_count} lançamento
                      {acc.settled_entries_count === 1 ? '' : 's'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de Cadastro / Edição */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Landmark className="h-5 w-5 text-slate-700" />
              {editingAccount ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Cadastre as informações da conta. Nenhuma conta é excluída para preservar o histórico
              financeiro.
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={handleSaveForm} className="space-y-4 py-2">
            {/* Aviso de Antiduplicidade */}
            {duplicateWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">{duplicateWarning}</div>
              </div>
            )}

            {/* Apelido da Conta */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Apelido da Conta <span className="text-rose-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="Ex: Itaú Principal, Bradesco Folha, Caixa Loja..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Banco (Febraban) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Banco (Febraban) <span className="text-rose-500">*</span>
                </Label>
                <Select value={selectedBankCode} onValueChange={setSelectedBankCode}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecione o banco" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {FEBRABAN_BANKS.map((b) => (
                      <SelectItem key={b.code} value={b.code} className="text-xs">
                        {b.code} - {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Tipo da Conta <span className="text-rose-500">*</span>
                </Label>
                <Select
                  value={accountType}
                  onValueChange={(val: BankAccountType) => setAccountType(val)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corrente">Conta Corrente</SelectItem>
                    <SelectItem value="poupanca">Conta Poupança</SelectItem>
                    <SelectItem value="investimento">Investimento / Aplicação</SelectItem>
                    <SelectItem value="caixa">Caixa Físico / Espécie</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedBankCode === '999' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Nome do Banco / Instituição
                </Label>
                <Input
                  type="text"
                  placeholder="Nome da cooperativa ou instituição..."
                  value={customBankName}
                  onChange={(e) => setCustomBankName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            )}

            {/* Agência e Número */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Agência <span className="text-rose-500">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: 0123 ou 0123-4"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  className="h-9 text-xs font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Número da Conta <span className="text-rose-500">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: 12345-6"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="h-9 text-xs font-mono"
                  required
                />
              </div>
            </div>

            {/* Vínculo com Entidade / Filial */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Vínculo com Entidade / Filial (Opcional)</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Identificação do CNPJ titular
                </span>
              </Label>
              <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione se for filial específica" />
                </SelectTrigger>
                <SelectContent className="max-h-52">
                  <SelectItem value="none" className="text-xs">
                    Geral / Não vinculado (Matriz)
                  </SelectItem>
                  {entities.map((ent) => (
                    <SelectItem key={ent.id} value={ent.id} className="text-xs">
                      {ent.company || ent.name} {ent.cnpj ? `(${ent.cnpj})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Saldo Inicial e Data */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Saldo Inicial (R$)</Label>
                <Input
                  type="text"
                  placeholder="0,00"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Data do Saldo Inicial
                </Label>
                <Input
                  type="date"
                  value={initialBalanceDate}
                  onChange={(e) => setInitialBalanceDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Observações / Chave PIX da Conta
              </Label>
              <Input
                type="text"
                placeholder="Ex: Chave PIX CNPJ xxxx, limite de cheque especial..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </form>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={isSubmitting}
              size="sm"
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs"
            >
              {isSubmitting
                ? 'Salvando...'
                : editingAccount
                  ? 'Salvar Alterações'
                  : 'Cadastrar Conta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
