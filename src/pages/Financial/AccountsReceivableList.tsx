import { useState, useEffect, useCallback, useId } from 'react'
import { Plus, Search, CheckCircle2, RotateCcw, FileText, Trash2 } from 'lucide-react'
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
  getAccountsReceivable,
  getFinancialCategories,
  createAccountReceivable,
  updateAccountReceivable,
  markReceivableAsPaid,
  reopenReceivable,
  deleteAccountReceivable,
  isOverdue,
  getBrasiliaToday,
} from '@/services/financial'
import { getCustomers } from '@/services/customers'
import { getQuotes } from '@/services/quotes'
import {
  AccountsReceivable,
  FinancialCategory,
  Customer,
  Quote,
  FinancialPaymentMethod,
} from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

export function AccountsReceivableList() {
  const { toast } = useToast()
  const formId = useId()

  const [items, setItems] = useState<AccountsReceivable[]>([])
  const [categories, setCategories] = useState<FinancialCategory[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [categoryFilter, setCategoryFilter] = useState('todos')
  const [customerFilter, setCustomerFilter] = useState('todos')

  // Modal de Lançamento Manual / Edição
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<AccountsReceivable | null>(null)
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formCustomerType, setFormCustomerType] = useState<'cadastrado' | 'livre'>('livre')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formCustomerName, setFormCustomerName] = useState('')
  const [formQuoteId, setFormQuoteId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDueDate, setFormDueDate] = useState(() => getBrasiliaToday())
  const [formNotes, setFormNotes] = useState('')
  const [formFile, setFormFile] = useState<File | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)

  // Modal de Baixa (Marcar como Recebido)
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [itemToPay, setItemToPay] = useState<AccountsReceivable | null>(null)
  const [payMethod, setPayMethod] = useState<FinancialPaymentMethod>('PIX')
  const [payDate, setPayDate] = useState(() => getBrasiliaToday())
  const [paySubmitting, setPaySubmitting] = useState(false)

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [receivablesData, catsData, custsData, quotesData] = await Promise.all([
        getAccountsReceivable({
          status: statusFilter,
          category: categoryFilter,
          customer: customerFilter,
          search: searchTerm,
        }),
        getFinancialCategories(),
        getCustomers(),
        getQuotes(),
      ])

      setItems(receivablesData)
      setCategories(catsData.filter((c) => c.type === 'receita'))
      setCustomers(custsData)
      setQuotes(quotesData)
    } catch (err: any) {
      console.error('Erro ao carregar contas a receber:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar contas a receber.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter, customerFilter, searchTerm, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleOpenCreateModal = () => {
    setEditingItem(null)
    setFormDescription('')
    setFormCategory('')
    setFormCustomerType('livre')
    setFormCustomerId('')
    setFormCustomerName('')
    setFormQuoteId('')
    setFormAmount('')
    setFormDueDate(getBrasiliaToday())
    setFormNotes('')
    setFormFile(null)
    setIsFormOpen(true)
  }

  const handleOpenEditModal = (item: AccountsReceivable) => {
    setEditingItem(item)
    setFormDescription(item.description || '')
    setFormCategory(item.category || '')
    if (item.customer) {
      setFormCustomerType('cadastrado')
      setFormCustomerId(item.customer)
      setFormCustomerName(item.customer_name || '')
    } else {
      setFormCustomerType('livre')
      setFormCustomerId('')
      setFormCustomerName(item.customer_name || '')
    }
    setFormQuoteId(item.quote || '')
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
      if (formCustomerType === 'cadastrado' && formCustomerId) {
        formData.append('customer', formCustomerId)
        const cust = customers.find((c) => c.id === formCustomerId)
        formData.append('customer_name', cust?.company || cust?.name || '')
      } else if (formCustomerName.trim()) {
        formData.append('customer_name', formCustomerName.trim())
      }
      if (formQuoteId) {
        formData.append('quote', formQuoteId)
      }
      formData.append('amount', String(amountNum))
      formData.append('due_date', `${formDueDate} 12:00:00.000Z`)
      formData.append('notes', formNotes.trim())
      if (formFile) {
        formData.append('attachment', formFile)
      }

      if (editingItem) {
        await updateAccountReceivable(editingItem.id, formData)
        toast({ title: 'Lançamento atualizado com sucesso!' })
      } else {
        formData.append('status', 'pendente')
        formData.append('origin', 'manual')
        await createAccountReceivable(formData)
        toast({ title: 'Conta a receber criada com sucesso!' })
      }

      setIsFormOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao salvar conta a receber:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar lançamento.',
        variant: 'destructive',
      })
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleOpenPayModal = (item: AccountsReceivable) => {
    setItemToPay(item)
    setPayMethod(item.payment_method || 'PIX')
    setPayDate(getBrasiliaToday())
    setIsPayModalOpen(true)
  }

  const handleConfirmPay = async () => {
    if (!itemToPay) return
    setPaySubmitting(true)
    try {
      await markReceivableAsPaid(itemToPay.id, payMethod, payDate)
      toast({
        title: 'Recebimento confirmado!',
        description: `Lançamento baixado como RECEBIDO via ${payMethod}.`,
      })
      setIsPayModalOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao confirmar recebimento:', err)
      toast({
        title: 'Erro na baixa',
        description: err?.message || 'Falha ao marcar conta como recebida.',
        variant: 'destructive',
      })
    } finally {
      setPaySubmitting(false)
    }
  }

  const handleReopen = async (item: AccountsReceivable) => {
    if (
      !confirm(
        `Deseja realmente reabrir a conta a receber "${item.description}"? O status voltará para Pendente.`,
      )
    ) {
      return
    }
    try {
      await reopenReceivable(item.id)
      toast({
        title: 'Recebimento estornado',
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

  const handleDelete = async (item: AccountsReceivable) => {
    if (!confirm(`Excluir permanentemente o lançamento "${item.description}"?`)) return
    try {
      await deleteAccountReceivable(item.id)
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
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por descrição, cliente, notas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Status</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="pago">Recebido</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>

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
        </div>

        <Button
          onClick={handleOpenCreateModal}
          className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Recebimento</span>
        </Button>
      </div>

      {/* Tabela de Contas a Receber */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Vencimento</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Cliente / Origem</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Carregando contas a receber...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Nenhuma conta a receber encontrada.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const overdue = isOverdue(item.due_date, item.status)

                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          overdue ? 'bg-red-50/20' : ''
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              overdue ? 'text-red-700 font-bold' : 'text-slate-800'
                            }`}
                          >
                            {item.due_date
                              ? new Date(item.due_date).toLocaleDateString('pt-BR')
                              : '-'}
                            {overdue && (
                              <span className="ml-1.5 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold uppercase">
                                Vencido
                              </span>
                            )}
                          </span>
                        </td>

                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-medium text-slate-900 truncate">
                            {item.description}
                          </div>
                          {item.expand?.quote && (
                            <div className="text-[10px] text-emerald-700 font-medium">
                              Vínculo: Orçamento #{item.expand.quote.number || item.quote}
                            </div>
                          )}
                          {item.notes && (
                            <div className="text-[10px] text-slate-400 truncate">{item.notes}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[180px] truncate text-slate-700">
                          {item.customer_name || item.expand?.customer?.name || '-'}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {item.expand?.category ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-[11px] font-medium"
                              style={{
                                backgroundColor: `${item.expand.category.color || '#10b981'}15`,
                                color: item.expand.category.color || '#047857',
                              }}
                            >
                              {item.expand.category.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-slate-900">
                          {formatCurrency(item.amount)}
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {item.status === 'pago' ? (
                            <div className="flex flex-col items-center">
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">
                                Recebido
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
                              className="text-blue-700 bg-blue-50 text-[10px]"
                            >
                              Pendente
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {item.status === 'pendente' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenPayModal(item)}
                                className="h-7 text-xs px-2 gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                title="Receber (Baixar)"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Receber</span>
                              </Button>
                            )}

                            {item.status === 'pago' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleReopen(item)}
                                className="h-7 text-xs px-2 gap-1 text-amber-700 hover:bg-amber-50"
                                title="Estornar recebimento"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>Estornar</span>
                              </Button>
                            )}

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenEditModal(item)}
                              className="h-7 w-7 text-slate-500 hover:text-slate-800"
                              title="Editar"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>

                            {item.status !== 'pago' && (
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
              {editingItem ? 'Editar Conta a Receber' : 'Novo Recebimento a Receber'}
            </DialogTitle>
            <DialogDescription>
              Fase 1: Lançamento manual com vínculo opcional a cliente e orçamento.
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={handleSaveForm} className="space-y-3.5 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700">Descrição *</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Ex: Venda de Peças Balcão, Serviço de Retífica"
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

            {/* Cliente */}
            <div className="space-y-1.5 border border-slate-100 p-2.5 rounded-lg bg-slate-50/50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Cliente (Opcional)</label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormCustomerType('livre')}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      formCustomerType === 'livre'
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Texto Livre
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormCustomerType('cadastrado')}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      formCustomerType === 'cadastrado'
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Cadastrado
                  </button>
                </div>
              </div>

              {formCustomerType === 'cadastrado' ? (
                <Select value={formCustomerId} onValueChange={setFormCustomerId}>
                  <SelectTrigger className="h-8 text-xs mt-1 bg-white">
                    <SelectValue placeholder="Selecione o cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={formCustomerName}
                  onChange={(e) => setFormCustomerName(e.target.value)}
                  placeholder="Nome do cliente ou pagador..."
                  className="h-8 text-xs mt-1 bg-white"
                />
              )}
            </div>

            {/* Vínculo opcional com Orçamento */}
            <div>
              <label className="text-xs font-semibold text-slate-700">
                Vincular a Orçamento (Opcional)
              </label>
              <Select value={formQuoteId} onValueChange={setFormQuoteId}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue placeholder="Sem vínculo a orçamento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {quotes.slice(0, 30).map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      #{q.number} - R$ {Number(q.total || 0).toFixed(2)} ({q.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <label className="text-xs font-semibold text-slate-700">Anexo Opcional</label>
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
                {formSubmitting ? 'Salvando...' : 'Salvar Recebimento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Recebimento (Baixa) */}
      <Dialog open={isPayModalOpen} onOpenChange={setIsPayModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Confirmar Recebimento (Baixa)
            </DialogTitle>
            <DialogDescription>
              Marque esta entrada como recebida e selecione o método utilizado pelo cliente.
            </DialogDescription>
          </DialogHeader>

          {itemToPay && (
            <div className="space-y-4 py-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Descrição:</span>
                  <span className="font-semibold text-slate-800">{itemToPay.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Valor a Receber:</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatCurrency(itemToPay.amount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cliente:</span>
                  <span className="text-slate-700">
                    {itemToPay.customer_name || itemToPay.expand?.customer?.name || '-'}
                  </span>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Data do Recebimento *</label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="h-8 text-xs mt-1"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Forma de Recebimento *</label>
                <Select
                  value={payMethod}
                  onValueChange={(val) => setPayMethod(val as FinancialPaymentMethod)}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue placeholder="Selecione a forma..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">PIX</SelectItem>
                    <SelectItem value="cartao">Cartão de Crédito / Débito</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro em Espécie</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="transferencia">Transferência Bancária</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
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
              type="submit"
              size="sm"
              onClick={handleConfirmPay}
              disabled={paySubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{paySubmitting ? 'Registrando...' : 'Confirmar Recebimento'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
