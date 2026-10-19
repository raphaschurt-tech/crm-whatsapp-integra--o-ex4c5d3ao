import { useState, useEffect, useCallback } from 'react'
import { Plus, Tag, Trash2, FileText, AlertCircle, TrendingDown, TrendingUp } from 'lucide-react'
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
  getFinancialCategories,
  createFinancialCategory,
  updateFinancialCategory,
  deleteFinancialCategory,
} from '@/services/financial'
import { FinancialCategory, FinancialCategoryType } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

const DEFAULT_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#64748b',
]

export function FinancialCategoriesView() {
  const { toast } = useToast()

  const [categories, setCategories] = useState<FinancialCategory[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de Criação / Edição
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<FinancialCategory | null>(null)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<FinancialCategoryType>('despesa')
  const [formDescription, setFormDescription] = useState('')
  const [formColor, setFormColor] = useState('#3b82f6')
  const [formSubmitting, setFormSubmitting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getFinancialCategories()
      setCategories(data)
    } catch (err: any) {
      console.error('Erro ao carregar categorias:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar categorias financeiras.',
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
    setEditingCategory(null)
    setFormName('')
    setFormType('despesa')
    setFormDescription('')
    setFormColor('#3b82f6')
    setIsFormOpen(true)
  }

  const handleOpenEdit = (c: FinancialCategory) => {
    setEditingCategory(c)
    setFormName(c.name || '')
    setFormType(c.type || 'despesa')
    setFormDescription(c.description || '')
    setFormColor(c.color || '#3b82f6')
    setIsFormOpen(true)
  }

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      toast({ title: 'Nome da categoria obrigatório', variant: 'destructive' })
      return
    }

    setFormSubmitting(true)
    try {
      const payload: Partial<FinancialCategory> = {
        name: formName.trim(),
        type: formType,
        description: formDescription.trim() || undefined,
        color: formColor,
        is_active: true,
      }

      if (editingCategory) {
        await updateFinancialCategory(editingCategory.id, payload)
        toast({ title: 'Categoria atualizada com sucesso!' })
      } else {
        await createFinancialCategory(payload)
        toast({ title: 'Nova categoria financeira criada!' })
      }

      setIsFormOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Erro ao salvar categoria:', err)
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha ao salvar categoria.',
        variant: 'destructive',
      })
    } finally {
      setFormSubmitting(false)
    }
  }

  // GUARDA: Bloqueio de exclusão de categoria com lançamentos vinculados
  const handleDelete = async (c: FinancialCategory) => {
    if (!confirm(`Deseja excluir permanentemente a categoria "${c.name}"?`)) return
    try {
      await deleteFinancialCategory(c.id)
      toast({ title: 'Categoria excluída com sucesso.' })
      loadData()
    } catch (err: any) {
      console.error('Erro ao excluir categoria:', err)
      toast({
        title: 'Exclusão Bloqueada',
        description:
          err?.message ||
          'Não é possível excluir esta categoria pois ela possui lançamentos vinculados.',
        variant: 'destructive',
      })
    }
  }

  const expenses = categories.filter((c) => c.type === 'despesa')
  const incomes = categories.filter((c) => c.type === 'receita')

  return (
    <div className="space-y-6">
      {/* Banner Informativo */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Tag className="h-5 w-5 text-emerald-600" />
            Categorias de Despesa e Receita
          </h2>
          <p className="text-xs text-slate-500">
            Estrutura do plano de contas para classificação das obrigações e receitas da RPA Auto
            Peças.
          </p>
        </div>

        <Button
          onClick={handleOpenCreate}
          className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          <span>Nova Categoria</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Coluna 1: Categorias de Despesa */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h3 className="text-sm font-bold text-red-800 flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Categorias de Despesas ({expenses.length})
            </h3>
          </div>

          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {loading ? (
                  <div className="p-6 text-center text-xs text-slate-500">Carregando...</div>
                ) : expenses.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Nenhuma categoria de despesa cadastrada.
                  </div>
                ) : (
                  expenses.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: c.color || '#ef4444' }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{c.name}</p>
                          {c.description && (
                            <p className="text-[11px] text-slate-500 truncate">{c.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(c)}
                          className="h-7 text-xs text-slate-600"
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(c)}
                          className="h-7 w-7 text-slate-400 hover:text-red-600"
                          title="Excluir categoria"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coluna 2: Categorias de Receita */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h3 className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Categorias de Receitas ({incomes.length})
            </h3>
          </div>

          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {loading ? (
                  <div className="p-6 text-center text-xs text-slate-500">Carregando...</div>
                ) : incomes.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Nenhuma categoria de receita cadastrada.
                  </div>
                ) : (
                  incomes.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: c.color || '#10b981' }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{c.name}</p>
                          {c.description && (
                            <p className="text-[11px] text-slate-500 truncate">{c.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(c)}
                          className="h-7 text-xs text-slate-600"
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(c)}
                          className="h-7 w-7 text-slate-400 hover:text-red-600"
                          title="Excluir categoria"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de Criação / Edição */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? 'Editar Categoria' : 'Nova Categoria Financeira'}
            </DialogTitle>
            <DialogDescription>
              Defina o nome, tipo e descrição para agrupamento nos relatórios e lançamentos.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveForm} className="space-y-3.5 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700">Nome da Categoria *</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Aluguel, DAS, Combustível, Peças"
                className="h-8 text-xs mt-1"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Tipo *</label>
                <Select
                  value={formType}
                  onValueChange={(val) => setFormType(val as FinancialCategoryType)}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="despesa">Despesa (Saída)</SelectItem>
                    <SelectItem value="receita">Receita (Entrada)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Cor de Identificação</label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="h-8 w-12 p-0.5 cursor-pointer"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    {DEFAULT_COLORS.slice(0, 6).map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setFormColor(c)}
                        className="h-5 w-5 rounded-full border border-white shadow-xs"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">Descrição / Finalidade</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Breve descrição da categoria..."
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
                {formSubmitting ? 'Salvando...' : 'Salvar Categoria'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
