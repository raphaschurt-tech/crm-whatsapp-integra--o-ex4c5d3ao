import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, RefreshCw, Edit, Trash2, Package } from 'lucide-react'
import { getProducts, deleteProduct } from '@/services/products'
import { syncStock, lookupStock } from '@/services/stock'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export default function ProductList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Lookup modal
  const [lookupModal, setLookupModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [lookupQty, setLookupQuantity] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)

  const loadData = async () => {
    try {
      const data = await getProducts()
      setProducts(data)
    } catch (e) {
      console.error(e)
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
      p.sku.toLowerCase().includes(search.toLowerCase())
    const matchLow = onlyLowStock ? p.stock_quantity <= (p.min_stock || 0) : true
    return matchSearch && matchLow
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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir o produto ${name}?`)) return
    try {
      await deleteProduct(id)
      toast({ title: 'Produto excluído' })
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    }
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
          <h1 className="text-2xl font-bold text-slate-900">Estoque de Produtos</h1>
          <p className="text-sm text-slate-500">Consulta e sincronização de catálogo</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={syncing} onClick={handleSyncAPI}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar via API
          </Button>
          <Button
            onClick={() => navigate('/estoque/novo')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Produto
          </Button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome ou SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch id="low-stock" checked={onlyLowStock} onCheckedChange={setOnlyLowStock} />
          <Label
            htmlFor="low-stock"
            className="text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Somente estoque baixo/em falta
          </Label>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Carregando catálogo...</div>
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
                  <th className="p-4">Preço</th>
                  <th className="p-4">Estoque</th>
                  <th className="p-4">Mínimo</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-400">SKU: {p.sku}</p>
                    </td>
                    <td className="p-4 font-semibold text-slate-900">{formatCurrency(p.price)}</td>
                    <td className="p-4 font-bold text-slate-800">{p.stock_quantity} un.</td>
                    <td className="p-4 text-slate-500">{p.min_stock || 0} un.</td>
                    <td className="p-4">{getStockBadge(p.stock_quantity, p.min_stock)}</td>
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
                        onClick={() => navigate(`/estoque/${p.id}/editar`)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(p.id, p.name)}
                          className="text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
