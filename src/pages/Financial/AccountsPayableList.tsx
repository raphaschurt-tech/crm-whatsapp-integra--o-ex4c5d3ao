import { useState, useEffect, useCallback, useId } from 'react'
import {
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  FileText,
  Paperclip,
  Trash2,
  Lock,
  ArrowUpDown,
  Download,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  getAccountsPayable,
  getFinancialCategories,
  createAccountPayable,
  updateAccountPayable,
  markPayableAsPaid,
  reopenPayable,
  deleteAccountPayable,
  isOverdue,
  getBrasiliaToday,
} from '@/services/financial'
import { getCustomers } from '@/services/customers'
import { AccountsPayable, FinancialCategory, Customer, FinancialPaymentMethod } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

export function AccountsPayableList() {
  const { toast } = useToast()
  const formId = useId()

  const [items, setItems] = useState<AccountsPayable[]>([])
  const [categories, setCategories] = useState<FinancialCategory[]>([])
  const [suppliers, setSuppliers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [categoryFilter, setCategoryFilter] = useState('todos')
  const [supplierFilter, setSupplierFilter] = useState('todos')
  const [originFilter, setOriginFilter] = useState('todos')

  // Modal de Lançamento Manual / Edição
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<AccountsPayable | null>(null)
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formSupplierType, setFormSupplierType] = useState<'cadastrado' | 'livre'>('livre')
  const [formSupplierId, setFormSupplierId] = useState('')
  const [formSupplierName, setFormSupplierName] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDueDate, setFormDueDate] = useState(() => getBrasiliaToday())
  const [formNotes, setFormNotes] = useState('')
  const [formFile, setFormFile] = useState<File | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)

  // Modal de Baixa (Marcar como Pago)
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [itemToPay, setItemToPay] = useState<AccountsPayable | null>(null)
  const [payMethod, setPayMethod] = useState<FinancialPaymentMethod>('PIX')
  const [payDate, setPayDate] = useState(() => getBrasiliaToday())
  const [paySubmitting, setPaySubmitting] = useState(false)

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [payablesData, catsData, custsData] = await Promise.all([
        getAccountsPayable({
          status: statusFilter,
          category: categoryFilter,
          supplier: supplierFilter,
          origin: originFilter,
          search: searchTerm,
        }),
        getFinancialCategories(),
        getCustomers(),
      ])

      setItems(payablesData)
      setCategories(catsData.filter((c) => c.type === 'despesa'))
      // Fornecedores são clientes com cnpj ou marcados como PJ
      setSuppliers(custsData.filter((c) => !!c.cnpj || c.type === 'PJ'))
    } catch (err: any) {
      console.error('Erro ao carregar contas a pagar:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar contas a pagar.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter, supplierFilter, originFilter, searchTerm, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleOpenCreateModal = () => {
    setEditingItem(null)
    setFormDescription('')
    setFormCategory('')
    setFormSupplierType('livre')
    setFormSupplierId('')
    setFormSupplierName('')
    setFormAmount('')
    setFormDueDate(getBrasiliaToday())
    setFormNotes('')
    setFormFile(null)
    setIsFormOpen(true)
  }

  const handleOpenEditModal = (item: AccountsPayable) => {
    // GUARDA NF-e: Lançamentos vindos de NF-e não permitem edição de conteúdo (apenas baixa)
    if (item.origin === 'nfe' || !!item.nfe_access_key) {
      toast({
        title: 'Lançamento Protegido',
        description:
          'Lançamentos originados de NF-e são protegidos e não podem ter dados contratuais editados manualmente.',
        variant: 'default',
      })
      return
    }

    setEditingItem(item)
    setFormDescription(item.description || '')
    setFormCategory(item.category || '')
    if (item.supplier) {
      setFormSupplierType('cadastrado')
      setFormSupplierId(item.supplier)
      setFormSupplierName(item.supplier_name || '')
    } else {
      setFormSupplierType('livre')
      setFormSupplierId('')
      setFormSupplierName(item.supplier_name || '')
    }
    setFormAmount(String(item.amount || ''))
    setFormDueDate(item.due_date ? item.due_date.slice(0, 10) : getBrasiliaToday())
    setFormNotes(item.notes || '')
    setFormFile(null)
    setIsFormOpen(true)
  }

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formDescription.trim()) {
      toast({ title: 'Descrição obrigatória', variant: 'destructive' })
      return
    }
    const amountNum = parseFloat(formAmount.replace(',', '.'))
    if (isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor positivo maior que zero.',
        variant: 'destructive',
      })
      return
    }
    if (!formDueDate) {
      toast({ title: 'Data de vencimento obrigatória', variant: 'destructive' })
      return
    }

    setFormSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('description', formDescription.trim())
      if (formCategory) formData.append('category', formCategory)
      if (formSupplierType === 'cadastrado' && formSupplierId) {
        formData.append('supplier', formSupplierId)
        const supp = suppliers.find((s) => s.id === formSupplierId)
        formData.append('supplier_name', supp?.company || supp?.name || '')
      } else if (formSupplierName.trim()) {
        formData.append('supplier_name', formSupplierName.trim())
      }
      formData.append('amount', String(amountNum))
      formData.append('due_date', `${formDueDate} 12:00:00.000Z`)
      formData.append('notes', formNotes.trim())
      if (formFile) {
        formData.append('attachment', formFile)
      }

      if (editingItem) {
        await updateAccountPayable(editingItem.id, formData)
        toast({ title: 'Lançamento atualizado com sucesso!' })
      } else {
        formData.append('status', 'pendente')
        formData.append('origin', 'manual')
        await createAccountPayable(formData)
        toast({ title: 'Conta a pagar criada com sucesso!' })
      }

      setIsFormOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao salvar conta a pagar:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar lançamento.',
        variant: 'destructive',
      })
    } finally {
      setFormSubmitting(false)
    }
  }

  // Abertura de Baixa (Marcar como Pago)
  const handleOpenPayModal = (item: AccountsPayable) => {
    setItemToPay(item)
    setPayMethod(item.payment_method || 'PIX')
    setPayDate(getBrasiliaToday())
    setIsPayModalOpen(true)
  }

  // Executar Baixa
  const handleConfirmPay = async () => {
    if (!itemToPay) return
    setPaySubmitting(true)
    try {
      await markPayableAsPaid(itemToPay.id, payMethod, payDate)
      toast({
        title: 'Baixa realizada com sucesso!',
        description: `Lançamento baixado como PAGO via ${payMethod}.`,
      })
      setIsPayModalOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao realizar baixa:', err)
      toast({
        title: 'Erro na baixa',
        description: err?.message || 'Falha ao marcar conta como paga.',
        variant: 'destructive',
      })
    } finally {
      setPaySubmitting(false)
    }
  }

  // Estorno / Reabertura
  const handleReopen = async (item: AccountsPayable) => {
    if (
      !confirm(
        `Deseja realmente estornar/reabrir a conta "${item.description}"? O status voltará para Pendente.`,
      )
    ) {
      return
    }
    try {
      await reopenPayable(item.id)
      toast({
        title: 'Lançamento estornado',
        description: 'A conta foi reaberta para status PENDENTE.',
      })
      loadData()
    } catch (err: any) {
      console.error('Erro ao reabrir conta:', err)
      toast({
        title: 'Erro ao estornar',
        description: err?.message || 'Falha ao reabrir lançamento.',
        variant: 'destructive',
      })
    }
  }

  // Exclusão
  const handleDelete = async (item: AccountsPayable) => {
    if (item.origin === 'nfe') {
      toast({
        title: 'Exclusão não permitida',
        description: 'Lançamentos originados de NF-e não podem ser excluídos pelo financeiro.',
        variant: 'destructive',
      })
      return
    }
    if (!confirm(`Excluir permanentemente o lançamento "${item.description}"?`)) return
    try {
      await deleteAccountPayable(item.id)
      toast({ title: 'Lançamento excluído.' })
      loadData()
    } catch (err: any) {
      console.error('Erro ao excluir:', err)
      toast({
        title: 'Erro ao excluir',
        description: err?.message || 'Falha ao excluir lançamento.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de Ações Superiores */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex-1 w-full sm:w-auto flex flex-wrap items-center gap-2">
          {/* Busca textual livre */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por descrição, fornecedor, chave NF-e..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          {/* Filtro de Status */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Status</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          {/* Filtro de Categoria */}
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas Categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filtro de Origem */}
          <Select value={originFilter} onValueChange={setOriginFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas Origens</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="nfe">NF-e (Geral)</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="dfe">DF-e</SelectItem>
              <SelectItem value="recorrente">Recorrente</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleOpenCreateModal}
          className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Lançamento</span>
        </Button>
      </div>

      {/* Tabela de Contas a Pagar */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Vencimento</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Fornecedor</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4">Origem</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Carregando contas a pagar...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Nenhuma conta a pagar encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const overdue = isOverdue(item.due_date, item.status)
                    const isNfe = item.origin === 'nfe' || !!item.nfe_access_key

                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          overdue ? 'bg-red-50/30' : ''
                        }`}
                      >
                        {/* Vencimento */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              overdue
                                ? 'text-red-700 font-bold flex items-center gap-1'
                                : 'text-slate-800'
                            }`}
                          >
                            {item.due_date
                              ? new Date(item.due_date).toLocaleDateString('pt-BR')
                              : '-'}
                            {overdue && (
                              <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold uppercase">
                                Vencido
                              </span>
                            )}
                          </span>
                        </td>

                        {/* Descrição + Observações / Parcelas */}
                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-medium text-slate-900 truncate">
                            {item.description}
                          </div>
                          {item.installment_number && item.total_installments && (
                            <div className="text-[10px] text-slate-500">
                              Parcela {item.installment_number}/{item.total_installments}
                            </div>
                          )}
                          {item.notes && (
                            <div className="text-[10px] text-slate-400 truncate">{item.notes}</div>
                          )}
                        </td>

                        {/* Fornecedor */}
                        <td className="py-3 px-4 max-w-[180px] truncate text-slate-700">
                          {item.supplier_name || item.expand?.supplier?.name || '-'}
                        </td>

                        {/* Categoria */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {item.expand?.category ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-[11px] font-medium"
                              style={{
                                backgroundColor: `${item.expand.category.color || '#64748b'}15`,
                                color: item.expand.category.color || '#334155',
                              }}
                            >
                              {item.expand.category.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* Origem e Badge NF-e com Chave */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isNfe || item.origin === 'dfe' || item.origin === 'email' ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge
                                variant="secondary"
                                className={`${
                                  item.origin === 'email'
                                    ? 'bg-sky-100 text-sky-800 hover:bg-sky-100'
                                    : item.origin === 'dfe'
                                      ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100'
                                      : 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                                } text-[10px] w-fit font-bold gap-1`}
                              >
                                <Lock className="h-2.5 w-2.5" />
                                {item.origin === 'email'
                                  ? 'NF-e (Email)'
                                  : item.origin === 'dfe'
                                    ? 'NF-e (DF-e)'
                                    : 'NF-e'}
                              </Badge>
                              {item.nfe_access_key && (
                                <span
                                  className="text-[9px] text-slate-400 font-mono truncate max-w-[110px]"
                                  title={`Chave: ${item.nfe_access_key}`}
                                >
                                  {item.nfe_access_key.slice(0, 10)}...
                                </span>
                              )}
                            </div>
                          ) : item.origin === 'recorrente' ? (
                            <Badge
                              variant="secondary"
                              className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-[10px] w-fit"
                            >
                              Recorrente
                            </Badge>
                          ) : (
                            <span className="text-slate-500 text-[11px]">Manual</span>
                          )}
                        </td>

                        {/* Valor */}
                        <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-slate-900">
                          {formatCurrency(item.amount)}
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {item.status === 'pago' ? (
                            <div className="flex flex-col items-center">
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">
                                Pago
                              </Badge>
                              {item.paid_at && (
                                <span className="text-[9px] text-slate-400 mt-0.5">
                                  {new Date(item.paid_at).toLocaleDateString('pt-BR')} (
                                  {item.payment_method || 'PIX'})
                                </span>
                              )}
                            </div>
                          ) : item.status === 'cancelado' ? (
                            <Badge variant="outline" className="text-slate-500 text-[10px]">
                              Cancelado
                            </Badge>
                          ) : overdue ? (
                            <Badge variant="destructive" className="text-[10px] font-bold">
                              Vencido
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-amber-700 bg-amber-50 text-[10px]"
                            >
                              Pendente
                            </Badge>
                          )}
                        </td>

                        {/* Ações */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {item.status === 'pendente' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenPayModal(item)}
                                className="h-7 text-xs px-2 gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                title="Dar baixa (Marcar como Pago)"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Pagar</span>
                              </Button>
                            )}

                            {item.status === 'pago' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleReopen(item)}
                                className="h-7 text-xs px-2 gap-1 text-amber-700 hover:bg-amber-50"
                                title="Estornar / Reabrir conta"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>Estornar</span>
                              </Button>
                            )}

                            {/* Se for NF-e, exibe ícone de cadeado informativo */}
                            {!isNfe && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleOpenEditModal(item)}
                                className="h-7 w-7 text-slate-500 hover:text-slate-800"
                                title="Editar"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            {!isNfe && item.status !== 'pago' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDelete(item)}
                                className="h-7 w-7 text-slate-400 hover:text-red-600"
                                title="Excluir"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Lançamento Manual / Edição */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Editar Conta a Pagar' : 'Novo Lançamento a Pagar'}
            </DialogTitle>
            <DialogDescription>
              Preencha os dados da obrigação financeira. Campos marcados com * são obrigatórios.
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={handleSaveForm} className="space-y-3.5 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700">Descrição *</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Ex: Compra de Buchas Bandeja, DAS, Aluguel"
                className="h-8 text-xs mt-1"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Valor (R$) *</label>
                <Input
                  type="text"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-8 text-xs mt-1"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Vencimento *</label>
                <Input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="h-8 text-xs mt-1"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">Categoria</label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue placeholder="Selecione a categoria..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Fornecedor (Cadastrado ou Texto Livre) */}
            <div className="space-y-1.5 border border-slate-100 p-2.5 rounded-lg bg-slate-50/50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Fornecedor</label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormSupplierType('livre')}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      formSupplierType === 'livre'
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Texto Livre
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormSupplierType('cadastrado')}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      formSupplierType === 'cadastrado'
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Cadastrado
                  </button>
                </div>
              </div>

              {formSupplierType === 'cadastrado' ? (
                <Select value={formSupplierId} onValueChange={setFormSupplierId}>
                  <SelectTrigger className="h-8 text-xs mt-1 bg-white">
                    <SelectValue placeholder="Selecione o fornecedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.company || s.name} {s.cnpj ? `(${s.cnpj})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={formSupplierName}
                  onChange={(e) => setFormSupplierName(e.target.value)}
                  placeholder="Nome do fornecedor ou favorecido..."
                  className="h-8 text-xs mt-1 bg-white"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">Observações</label>
              <Input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Observações complementares..."
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">
                Anexo Opcional (Boleto / Comprovante)
              </label>
              <Input
                type="file"
                onChange={(e) => setFormFile(e.target.files?.[0] || null)}
                className="h-8 text-xs mt-1 file:text-xs file:py-0.5 file:px-2 file:rounded file:border-0 file:bg-slate-100"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsFormOpen(false)}
                disabled={formSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={formSubmitting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {formSubmitting ? 'Salvando...' : 'Salvar Lançamento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Baixa (Marcar como Pago) */}
      <Dialog open={isPayModalOpen} onOpenChange={setIsPayModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Confirmar Pagamento (Baixa)
            </DialogTitle>
            <DialogDescription>
              Confirme a liquidação deste lançamento. A operação será registrada no log de
              auditoria.
            </DialogDescription>
          </DialogHeader>

          {itemToPay && (
            <div className="space-y-4 py-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Conta:</span>
                  <span className="font-semibold text-slate-800">{itemToPay.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Valor a Pagar:</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatCurrency(itemToPay.amount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Fornecedor:</span>
                  <span className="text-slate-700">
                    {itemToPay.supplier_name || itemToPay.expand?.supplier?.name || '-'}
                  </span>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Data do Pagamento *</label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="h-8 text-xs mt-1"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Forma de Pagamento *</label>
                <Select
                  value={payMethod}
                  onValueChange={(val) => setPayMethod(val as FinancialPaymentMethod)}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue placeholder="Selecione a forma..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">PIX</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="transferencia">Transferência Bancária</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="cartao">Cartão de Crédito/Débito</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPayModalOpen(false)}
              disabled={paySubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmPay}
              disabled={paySubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{paySubmitting ? 'Registrando...' : 'Confirmar Baixa'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
