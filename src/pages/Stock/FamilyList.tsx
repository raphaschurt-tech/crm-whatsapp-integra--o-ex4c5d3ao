import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Trash2, Layers, Package, AlertCircle } from 'lucide-react'
import { getFamilies, createFamily, updateFamily, deleteFamily } from '@/services/families'
import { getProducts } from '@/services/products'
import { ItemFamily, Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export default function FamilyList() {
  const [families, setFamilies] = useState<ItemFamily[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Modal de Criar/Editar Família
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFamily, setEditingFamily] = useState<ItemFamily | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [fams, prods] = await Promise.all([getFamilies(), getProducts()])
      setFamilies(fams)
      setProducts(prods)
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleOpenCreate = () => {
    setEditingFamily(null)
    setName('')
    setDescription('')
    setSelectedProductIds([])
    setProductSearch('')
    setModalOpen(true)
  }

  const handleOpenEdit = (fam: ItemFamily) => {
    setEditingFamily(fam)
    setName(fam.name || '')
    setDescription(fam.description || '')
    setSelectedProductIds(Array.isArray(fam.products) ? [...fam.products] : [])
    setProductSearch('')
    setModalOpen(true)
  }

  const handleToggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    )
  }

  const handleSaveFamily = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast({ title: 'Informe o nome da família', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      if (editingFamily) {
        await updateFamily(editingFamily.id, {
          name: name.trim(),
          description: description.trim(),
          products: selectedProductIds,
        })
        toast({ title: 'Família atualizada com sucesso' })
      } else {
        await createFamily({
          name: name.trim(),
          description: description.trim(),
          products: selectedProductIds,
        })
        toast({ title: 'Família cadastrada com sucesso' })
      }
      setModalOpen(false)
      loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao salvar família', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (fam: ItemFamily) => {
    if (!confirm(`Deseja realmente excluir a família "${fam.name}"?`)) return
    try {
      await deleteFamily(fam.id)
      toast({ title: 'Família excluída com sucesso' })
      loadData()
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao excluir família', variant: 'destructive' })
    }
  }

  const filteredFamilies = families.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      (f.description && f.description.toLowerCase().includes(search.toLowerCase())),
  )

  // Regra de negócio: na seleção de itens da família, listar APENAS produtos
  // com a flag "Composto (insumo)" marcada, com quantidade disponível, fornecedor e custo.
  const componentProducts = products.filter((p) => Boolean(p.is_component))

  const filteredModalProducts = componentProducts.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.supplier && p.supplier.toLowerCase().includes(productSearch.toLowerCase())),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Famílias de Insumos</h1>
          <p className="text-sm text-slate-500">
            Organização de insumos por categoria (ex: Borracha, Capa, Pino, Bucha) para PCP
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Nova Família
        </Button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar famílias..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Carregando famílias de insumos...</div>
      ) : filteredFamilies.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
          Nenhuma família de insumos encontrada. Clique em &quot;Nova Família&quot; para começar.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {filteredFamilies.map((fam) => {
            const famProductIds = Array.isArray(fam.products) ? fam.products : []
            const famProducts = products.filter((p) => famProductIds.includes(p.id))

            return (
              <Card key={fam.id} className="border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-slate-50/70 border-b border-slate-100 py-3.5 px-5 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                        {fam.name}
                        <Badge variant="outline" className="text-xs font-normal">
                          {famProducts.length} {famProducts.length === 1 ? 'item' : 'itens'}
                        </Badge>
                      </CardTitle>
                      {fam.description && (
                        <p className="text-xs text-slate-500">{fam.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(fam)}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(fam)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  {famProducts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Nenhum produto associado a esta família. Clique em &quot;Editar&quot; para
                      vincular insumos do estoque.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-400 font-semibold border-b">
                            <th className="py-2.5 px-5">Produto / Insumo</th>
                            <th className="py-2.5 px-4">SKU</th>
                            <th className="py-2.5 px-4">Fornecedor</th>
                            <th className="py-2.5 px-4">Qtd em Estoque</th>
                            <th className="py-2.5 px-4">Custo de Compra / OP</th>
                            <th className="py-2.5 px-4 text-right">Preço de Venda</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {famProducts.map((p) => {
                            const isLow = (p.stock_quantity || 0) <= (p.min_stock || 0)
                            return (
                              <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                                <td className="py-3 px-5">
                                  <div className="flex items-center gap-2">
                                    <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                    <span className="font-semibold text-slate-900">{p.name}</span>
                                    {Boolean(p.is_produced ?? p.product_type === 'produzido') && (
                                      <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] px-1 py-0">
                                        Produzido
                                      </Badge>
                                    )}
                                    {Boolean(p.is_component) && (
                                      <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1 py-0">
                                        Insumo
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-mono text-slate-600">{p.sku}</td>
                                <td className="py-3 px-4 text-slate-600">{p.supplier || '—'}</td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`font-bold ${
                                      isLow ? 'text-amber-600' : 'text-slate-800'
                                    }`}
                                  >
                                    {p.stock_quantity || 0} un.
                                  </span>
                                  {isLow && (
                                    <span className="text-[10px] text-amber-600 ml-1.5 font-normal">
                                      (mín: {p.min_stock || 0})
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 font-semibold text-emerald-700">
                                  {p.cost ? formatCurrency(p.cost || 0) : 'R$ 0,00'}
                                </td>
                                <td className="py-3 px-4 text-right font-medium text-slate-700">
                                  {!p.stock_quantity || p.stock_quantity <= 0 ? (
                                    <span className="text-amber-700 font-semibold text-xs italic bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                      Sob consulta
                                    </span>
                                  ) : (
                                    formatCurrency(p.price || 0)
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal Criar / Editar Família */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingFamily ? 'Editar Família de Insumos' : 'Nova Família de Insumos'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveFamily} className="space-y-4 flex-1 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Nome da Família *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Borracha, Capa, Pino, Bucha"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descrição / Especificação</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Descrição técnica dos componentes pertencentes a este grupo..."
              />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Vincular Insumos a esta Família ({selectedProductIds.length} selecionados)
                </Label>
              </div>
              <p className="text-xs text-slate-500">
                Apenas produtos cadastrados com a flag{' '}
                <strong>&quot;Composto (insumo)&quot;</strong> são listados abaixo como opções. Cada
                item exibe quantidade disponível, fornecedor e custo real.
              </p>

              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Filtrar por nome, SKU ou fornecedor..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>

              <div className="max-h-60 overflow-y-auto border rounded-lg divide-y divide-slate-100 bg-slate-50/40">
                {componentProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-amber-700 bg-amber-50">
                    Nenhum produto possui a flag &quot;Composto (insumo)&quot; marcada. Marque esta
                    flag no Cadastro de Produtos para que ele apareça aqui.
                  </div>
                ) : filteredModalProducts.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">
                    Nenhum produto cadastrado coincide com a busca.
                  </p>
                ) : (
                  filteredModalProducts.map((p) => {
                    const isChecked = selectedProductIds.includes(p.id)
                    return (
                      <label
                        key={p.id}
                        className={`flex items-start gap-2.5 p-2.5 text-xs cursor-pointer hover:bg-slate-100 transition-colors ${
                          isChecked ? 'bg-emerald-50/60' : ''
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => handleToggleProduct(p.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 truncate">{p.name}</span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0">
                              SKU: {p.sku}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                            <span>
                              Estoque: <strong>{p.stock_quantity} un.</strong>
                            </span>
                            <span>
                              Fornecedor: <strong>{p.supplier || '—'}</strong>
                            </span>
                            <span className="text-emerald-700">
                              Custo: <strong>{formatCurrency(p.cost || 0)}</strong>
                            </span>
                          </div>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <DialogFooter className="pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
              >
                {saving ? 'Salvando...' : 'Salvar Família'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
