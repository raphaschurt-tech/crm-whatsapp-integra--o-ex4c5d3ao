import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Play,
  RotateCw,
  CheckCircle,
  FileText,
  Trash2,
  Calendar,
  Clock,
  Sparkles,
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
  getFinancialRecurringTemplates,
  getFinancialCategories,
  createFinancialRecurringTemplate,
  updateFinancialRecurringTemplate,
  deleteFinancialRecurringTemplate,
  runRecurringCronManual,
  getBrasiliaMonthKey,
} from '@/services/financial'
import { FinancialRecurringTemplate, FinancialCategory, FinancialPaymentMethod } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

export function RecurringTemplatesList() {
  const { toast } = useToast()

  const [templates, setTemplates] = useState<FinancialRecurringTemplate[]>([])
  const [categories, setCategories] = useState<FinancialCategory[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de Criação / Edição
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<FinancialRecurringTemplate | null>(null)
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formValueType, setFormValueType] = useState<'fixo' | 'variavel'>('fixo')
  const [formAmount, setFormAmount] = useState('')
  const [formDueDay, setFormDueDay] = useState('5')
  const [formMethod, setFormMethod] = useState<FinancialPaymentMethod>('boleto')
  const [formSupplierName, setFormSupplierName] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)

  // Execução Manual do Cron
  const [runningCron, setRunningCron] = useState(false)
  const [cronCompetence, setCronCompetence] = useState(() => getBrasiliaMonthKey())

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [templatesData, catsData] = await Promise.all([
        getFinancialRecurringTemplates(),
        getFinancialCategories(),
      ])
      setTemplates(templatesData)
      setCategories(catsData.filter((c) => c.type === 'despesa'))
    } catch (err: any) {
      console.error('Erro ao carregar modelos recorrentes:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar modelos recorrentes.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleOpenCreate = () => {
    setEditingTemplate(null)
    setFormDescription('')
    setFormCategory('')
    setFormValueType('fixo')
    setFormAmount('')
    setFormDueDay('5')
    setFormMethod('boleto')
    setFormSupplierName('')
    setFormNotes('')
    setIsFormOpen(true)
  }

  const handleOpenEdit = (t: FinancialRecurringTemplate) => {
    setEditingTemplate(t)
    setFormDescription(t.description || '')
    setFormCategory(t.category || '')
    setFormValueType(t.value_type || 'fixo')
    setFormAmount(t.fixed_amount ? String(t.fixed_amount) : '')
    setFormDueDay(String(t.due_day || 5))
    setFormMethod(t.default_payment_method || 'boleto')
    setFormSupplierName(t.supplier_name || '')
    setFormNotes(t.notes || '')
    setIsFormOpen(true)
  }

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formDescription.trim()) {
      toast({ title: 'Descrição obrigatória', variant: 'destructive' })
      return
    }
    const day = parseInt(formDueDay, 10)
    if (isNaN(day) || day < 1 || day > 31) {
      toast({ title: 'Dia de vencimento inválido (1 a 31)', variant: 'destructive' })
      return
    }

    const amountNum = parseFloat(formAmount.replace(',', '.')) || 0

    setFormSubmitting(true)
    try {
      const payload: Partial<FinancialRecurringTemplate> = {
        description: formDescription.trim(),
        category: formCategory || undefined,
        value_type: formValueType,
        fixed_amount: formValueType === 'fixo' ? amountNum : 0,
        due_day: day,
        default_payment_method: formMethod,
        supplier_name: formSupplierName.trim() || undefined,
        notes: formNotes.trim() || undefined,
        is_active: true,
      }

      if (editingTemplate) {
        await updateFinancialRecurringTemplate(editingTemplate.id, payload)
        toast({ title: 'Modelo recorrente atualizado!' })
      } else {
        await createFinancialRecurringTemplate(payload)
        toast({ title: 'Novo modelo recorrente criado!' })
      }

      setIsFormOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao salvar modelo:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar modelo recorrente.',
        variant: 'destructive',
      })
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleToggleActive = async (t: FinancialRecurringTemplate) => {
    try {
      await updateFinancialRecurringTemplate(t.id, { is_active: !t.is_active })
      toast({
        title: t.is_active ? 'Modelo pausado' : 'Modelo ativado',
        description: t.is_active
          ? 'Este modelo não gerará despesas nos próximos crons.'
          : 'Modelo reativado para geração automática.',
      })
      loadData()
    } catch (err: any) {
      console.error('Erro ao alterar status:', err)
      toast({ title: 'Erro ao alterar status', variant: 'destructive' })
    }
  }

  const handleDelete = async (t: FinancialRecurringTemplate) => {
    if (!confirm(`Excluir o modelo de despesa recorrente "${t.description}"?`)) return
    try {
      await deleteFinancialRecurringTemplate(t.id)
      toast({ title: 'Modelo excluído com sucesso.' })
      loadData()
    } catch (err: any) {
      console.error('Erro ao excluir modelo:', err)
      toast({
        title: 'Erro ao excluir',
        description: err?.message || 'Falha ao excluir modelo.',
        variant: 'destructive',
      })
    }
  }

  // Executar Cron Manualmente para uma competência (com fuso de Brasília e log FIN-CRON)
  const handleRunCronManual = async () => {
    setRunningCron(true)
    try {
      const res = await runRecurringCronManual(cronCompetence)
      toast({
        title: 'Rotina de Recorrentes Executada!',
        description: `Competência ${res.competence}: ${res.generated} gerados, ${res.existing} já existentes, ${res.errors} falhas.`,
      })
    } catch (err: any) {
      console.error('Erro ao rodar cron manual:', err)
      toast({
        title: 'Erro na execução',
        description: err?.message || 'Falha ao executar rotina de despesas recorrentes.',
        variant: 'destructive',
      })
    } finally {
      setRunningCron(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Informações da Automação Cron + Disparo Manual */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-emerald-50/50 p-4 rounded-xl border border-emerald-200">
        <div>
          <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Automação Diária de Despesas Recorrentes (Cron)
          </h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Todos os dias às 03:00 (Brasília), o sistema varre os modelos ativos e gera os
            lançamentos da competência se ainda não existirem. Protegido por índice único (não
            duplica em re-execução).
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Input
            type="text"
            value={cronCompetence}
            onChange={(e) => setCronCompetence(e.target.value)}
            placeholder="AAAA-MM"
            className="w-28 h-9 text-xs bg-white text-center font-mono"
            title="Competência (AAAA-MM)"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunCronManual}
            disabled={runningCron}
            className="h-9 gap-1.5 bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-100"
          >
            <Play className={`h-3.5 w-3.5 ${runningCron ? 'animate-spin' : ''}`} />
            <span>{runningCron ? 'Executando...' : 'Rodar Agora'}</span>
          </Button>
        </div>
      </div>

      {/* Barra de Criação */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Modelos Cadastrados</h2>
          <p className="text-xs text-slate-500">
            {templates.length} modelos de despesas recorrentes configurados
          </p>
        </div>

        <Button
          onClick={handleOpenCreate}
          className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Modelo Recorrente</span>
        </Button>
      </div>

      {/* Grid de Modelos Recorrentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-8 text-center text-xs text-slate-500">
            Carregando modelos recorrentes...
          </div>
        ) : templates.length === 0 ? (
          <div className="col-span-full py-8 text-center text-xs text-slate-500">
            Nenhum modelo cadastrado. Clique em Novo Modelo Recorrente para iniciar.
          </div>
        ) : (
          templates.map((tmpl) => (
            <Card
              key={tmpl.id}
              className={`border transition-all ${
                tmpl.is_active
                  ? 'border-slate-200 bg-white hover:border-slate-300'
                  : 'border-slate-200 bg-slate-50/70 opacity-70'
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-sm truncate">
                      {tmpl.description}
                    </h3>
                    <p className="text-xs text-slate-500 truncate">
                      {tmpl.supplier_name || 'Fornecedor não especificado'}
                    </p>
                  </div>
                  <Badge
                    variant={tmpl.is_active ? 'default' : 'secondary'}
                    className={
                      tmpl.is_active
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]'
                        : 'text-[10px]'
                    }
                  >
                    {tmpl.is_active ? 'Ativo' : 'Pausado'}
                  </Badge>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Valor
                    </span>
                    <span className="text-base font-black text-slate-800">
                      {tmpl.value_type === 'fixo'
                        ? formatCurrency(tmpl.fixed_amount || 0)
                        : 'Informar no mês (Variável)'}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Vencimento
                    </span>
                    <span className="text-xs font-semibold text-slate-700 flex items-center justify-end gap-1">
                      <Calendar className="h-3 w-3 text-slate-400" />
                      Todo dia {tmpl.due_day}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span>Forma: {tmpl.default_payment_method || 'Boleto'}</span>
                  {tmpl.expand?.category && (
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tmpl.expand.category.color || '#64748b'}15`,
                        color: tmpl.expand.category.color || '#334155',
                      }}
                    >
                      {tmpl.expand.category.name}
                    </span>
                  )}
                </div>

                {tmpl.notes && (
                  <p className="text-[11px] text-slate-500 italic truncate">{tmpl.notes}</p>
                )}

                <div className="flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleActive(tmpl)}
                    className="h-7 text-xs text-slate-600 hover:text-slate-900"
                  >
                    {tmpl.is_active ? 'Pausar' : 'Ativar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(tmpl)}
                    className="h-7 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(tmpl)}
                    className="h-7 w-7 text-slate-400 hover:text-red-600"
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Modal de Criação / Edição de Modelo */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Editar Modelo Recorrente' : 'Novo Modelo Recorrente'}
            </DialogTitle>
            <DialogDescription>
              Configuração do modelo para geração automática no cron diário.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveForm} className="space-y-3.5 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700">Descrição do Modelo *</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Ex: Aluguel do Galpão, Conta de Água (Sabesp)"
                className="h-8 text-xs mt-1"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">Categoria Financeira</label>
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Tipo de Valor</label>
                <Select
                  value={formValueType}
                  onValueChange={(val) => setFormValueType(val as 'fixo' | 'variavel')}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixo">Valor Fixo</SelectItem>
                    <SelectItem value="variavel">Informar no Mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">
                  {formValueType === 'fixo' ? 'Valor Fixo (R$) *' : 'Valor Base'}
                </label>
                <Input
                  type="text"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder={formValueType === 'fixo' ? '3500,00' : '0,00'}
                  className="h-8 text-xs mt-1"
                  disabled={formValueType === 'variavel'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Dia do Vencimento (1 a 31) *
                </label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={formDueDay}
                  onChange={(e) => setFormDueDay(e.target.value)}
                  className="h-8 text-xs mt-1"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Forma Padrão</label>
                <Select
                  value={formMethod}
                  onValueChange={(val) => setFormMethod(val as FinancialPaymentMethod)}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">PIX</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="cartao">Cartão</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">
                Fornecedor / Favorecido
              </label>
              <Input
                value={formSupplierName}
                onChange={(e) => setFormSupplierName(e.target.value)}
                placeholder="Ex: Enel Distribuição, Imobiliária Nova São Paulo"
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">Observações</label>
              <Input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Instruções de pagamento..."
                className="h-8 text-xs mt-1"
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
                {formSubmitting ? 'Salvando...' : 'Salvar Modelo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
