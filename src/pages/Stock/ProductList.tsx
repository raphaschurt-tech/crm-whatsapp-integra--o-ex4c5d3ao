import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  RefreshCw,
  Edit,
  Trash2,
  Package,
  ShoppingCart,
  Factory,
  Boxes,
  Check,
  AlertCircle,
} from 'lucide-react'
import { getProducts, deleteProduct } from '@/services/products'
import { syncStock, lookupStock } from '@/services/stock'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export default function ProductList() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [natureFilter, setNatureFilter] = useState<'todas' | 'comprado' | 'produzido' | 'composto'>(
    'todas',
  )
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)

  // Lookup modal
  const [lookupModal, setLookupModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [lookupQty, setLookupQuantity] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getProducts()
      setProducts(data)
    } catch (e: any) {
      console.error('Erro ao carregar produtos:', e)
      setLoadError(e?.message || 'Falha ao comunicar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('products', () => {
    loadData()
  })

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.supplier && p.supplier.toLowerCase().includes(search.toLowerCase()))

    const isPurchased =
      p.is_purchased !== undefined ? p.is_purchased : p.product_type !== 'produzido'
    const isProduced = p.is_produced !== undefined ? p.is_produced : p.product_type === 'produzido'
    const isComponent = Boolean(p.is_component)

    let matchNature = true
    if (natureFilter === 'comprado') matchNature = Boolean(isPurchased)
    else if (natureFilter === 'produzido') matchNature = Boolean(isProduced)
    else if (natureFilter === 'composto') matchNature = Boolean(isComponent)

    const matchLow = onlyLowStock ? p.stock_quantity <= (p.min_stock || 0) : true
    return matchSearch && matchNature && matchLow
  })

  const handleSyncAPI = async () => {
    setSyncing(true)
    try {
      const res = await syncStock()
      toast({
        title: 'Sincronização Concluída',
        description: `Produtos atualizados: ${res.updated}, criados: ${res.created}`,
      })
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao sincronizar', variant: 'destructive' })
    } finally {
      setSyncing(false)
    }
  }

  const handleOpenLookup = async (product: Product) => {
    setSelectedProduct(product)
    setLookupModal(true)
    setChecking(true)
    setLookupQuantity(null)
    try {
      const res = await lookupStock(product.sku)
      setLookupQuantity(res.quantity)
    } catch (_) {
      toast({ title: 'Erro na consulta do SKU', variant: 'destructive' })
    } finally {
      setChecking(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!productToDelete) return
    setDeletingId(productToDelete.id)
    try {
      await deleteProduct(productToDelete.id)
      toast({ title: 'Produto excluído com sucesso!' })
      setDeleteDialogOpen(false)
      setProductToDelete(null)
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao excluir produto', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const promptDelete = (p: Product) => {
    setProductToDelete(p)
    setDeleteDialogOpen(true)
  }

  const getStockBadge = (quantity: number, min: number = 0) => {
    if (quantity === 0) return <Badge variant="destructive">Sem Estoque</Badge>
    if (quantity <= min) return <Badge className="bg-amber-500 text-white">Estoque Baixo</Badge>
    return <Badge className="bg-emerald-500 text-white">OK ({quantity})</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cadastro de Produtos</h1>
          <p className="text-sm text-slate-500">
            Catálogo completo, controle de estoque, naturezas operacionais e composição de peças
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={syncing} onClick={handleSyncAPI}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar via API
          </Button>
          <Button
            onClick={() => navigate('/produtos/novo')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Produto
          </Button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, SKU ou fornecedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold text-slate-600 shrink-0">
              Filtrar Natureza:
            </Label>
            <Select value={natureFilter} onValueChange={(val: any) => setNatureFilter(val)}>
              <SelectTrigger className="w-44 text-xs h-9 bg-white">
                <SelectValue placeholder="Todas as naturezas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as naturezas</SelectItem>
                <SelectItem value="comprado">Comprado</SelectItem>
                <SelectItem value="produzido">Produzido (PCP)</SelectItem>
                <SelectItem value="composto">Composto (insumo)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="low-stock" checked={onlyLowStock} onCheckedChange={setOnlyLowStock} />
            <Label
              htmlFor="low-stock"
              className="text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Estoque baixo/em falta
            </Label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
          <p>Carregando catálogo...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white p-8 rounded-xl border border-red-200 text-center space-y-3">
          <Package className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-700 font-medium">
            Não foi possível carregar o catálogo de produtos.
          </p>
          <p className="text-xs text-slate-500">O servidor pode estar inicializando.</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
          Nenhum produto encontrado.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b">
                  <th className="p-4">Produto / SKU</th>
                  <th className="p-4">Naturezas</th>
                  <th className="p-4">Preço</th>
                  <th className="p-4">Custo</th>
                  <th className="p-4">Estoque</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((p) => {
                  const isPur =
                    p.is_purchased !== undefined
                      ? Boolean(p.is_purchased)
                      : p.product_type !== 'produzido'
                  const isProd =
                    p.is_produced !== undefined
                      ? Boolean(p.is_produced)
                      : p.product_type === 'produzido'
                  const isComp = Boolean(p.is_component)

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <button
                          type="button"
                          onClick={() => navigate(`/produtos/${p.id}`)}
                          className="text-left group cursor-pointer"
                        >
                          <p className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                            {p.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono">SKU: {p.sku}</p>
                          {p.supplier && (
                            <p className="text-[11px] text-slate-500 truncate max-w-xs">
                              {p.supplier}
                            </p>
                          )}
                        </button>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-[210px]">
                          {isPur && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 px-1.5 bg-emerald-50 text-emerald-800 border-emerald-200 flex items-center gap-1 font-semibold"
                              title="Comprado: pode gerar ordem de compra"
                            >
                              <ShoppingCart className="h-3 w-3" /> Comprado
                            </Badge>
                          )}
                          {isProd && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 px-1.5 bg-purple-50 text-purple-800 border-purple-200 flex items-center gap-1 font-semibold"
                              title="Produzido: fabricado internamente com composição"
                            >
                              <Factory className="h-3 w-3" /> Produzido
                            </Badge>
                          )}
                          {isComp && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 px-1.5 bg-blue-50 text-blue-800 border-blue-200 flex items-center gap-1 font-semibold"
                              title="Composto (insumo): pode ser insumo em famílias de produtos fabricados"
                            >
                              <Boxes className="h-3 w-3" /> Insumo
                            </Badge>
                          )}
                          {!isPur && !isProd && !isComp && (
                            <span className="text-xs text-slate-400 italic">Sem classificação</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 font-semibold text-slate-900">
                        {!p.stock_quantity || p.stock_quantity <= 0 ? (
                          <span className="text-amber-700 font-semibold text-xs italic bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            Sob consulta
                          </span>
                        ) : (
                          formatCurrency(p.price || 0)
                        )}
                      </td>
                      <td className="p-4 text-xs font-semibold text-slate-600">
                        {p.cost ? formatCurrency(p.cost || 0) : '—'}
                      </td>
                      <td className="p-4 font-bold text-slate-800">{p.stock_quantity || 0} un.</td>
                      <td className="p-4">
                        {getStockBadge(p.stock_quantity || 0, p.min_stock || 0)}
                      </td>
                      <td className="p-4 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenLookup(p)}
                          title="Consultar API Externa"
                        >
                          <RefreshCw className="h-4 w-4 text-emerald-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/produtos/${p.id}/editar`)}
                          title="Editar Produto"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => promptDelete(p)}
                          className="text-red-500 hover:text-red-700"
                          title="Excluir Produto"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Confirmar Exclusão de Produto
            </DialogTitle>
            <DialogDescription className="pt-2 text-xs text-slate-600">
              Tem certeza que deseja excluir o produto{' '}
              <strong className="text-slate-900">{productToDelete?.name}</strong> (SKU:{' '}
              {productToDelete?.sku})? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-3">
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={Boolean(deletingId)}
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingId ? 'Excluindo...' : 'Excluir Produto'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lookupModal} onOpenChange={setLookupModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Consulta de Estoque via API</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center space-y-3">
            <Package className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="font-bold text-slate-900">{selectedProduct?.name}</p>
            <p className="text-xs text-slate-500">SKU: {selectedProduct?.sku}</p>

            {checking ? (
              <p className="text-sm text-slate-500">Consultando API de estoque externa...</p>
            ) : lookupQty !== null ? (
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                <p className="text-xs text-emerald-700">Quantidade retornada da API:</p>
                <p className="text-3xl font-extrabold text-emerald-800">{lookupQty} unidades</p>
              </div>
            ) : (
              <p className="text-sm text-red-500">Não foi possível obter a quantidade.</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setLookupModal(false)} className="bg-slate-800 text-white">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
