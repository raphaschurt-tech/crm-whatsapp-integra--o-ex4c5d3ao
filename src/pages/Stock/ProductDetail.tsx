import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Edit,
  Trash2,
  RefreshCw,
  Package,
  DollarSign,
  Layers,
  AlertTriangle,
} from 'lucide-react'
import { getProduct, deleteProduct } from '@/services/products'
import { lookupStock } from '@/services/stock'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  const loadData = async () => {
    if (!id) return
    try {
      const p = await getProduct(id)
      setProduct(p)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar produto', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  const handleLookup = async () => {
    if (!product) return
    setChecking(true)
    try {
      const res = await lookupStock(product.sku)
      setProduct((prev) => (prev ? { ...prev, stock_quantity: res.quantity } : null))
      toast({
        title: 'Estoque Atualizado via API',
        description: `Quantidade atualizada para ${res.quantity} unidades.`,
      })
    } catch (_) {
      toast({ title: 'Erro ao consultar API externa', variant: 'destructive' })
    } finally {
      setChecking(false)
    }
  }

  const handleDelete = async () => {
    if (!product || !confirm(`Deseja realmente excluir ${product.name}?`)) return
    try {
      await deleteProduct(product.id)
      toast({ title: 'Produto excluído' })
      navigate('/estoque')
    } catch (_) {
      toast({ title: 'Erro ao excluir produto', variant: 'destructive' })
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Carregando detalhes do produto...</div>
  }

  if (!product) {
    return <div className="p-8 text-center text-slate-500">Produto não encontrado.</div>
  }

  const isLowStock = product.stock_quantity <= (product.min_stock || 0)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/estoque')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
              {isLowStock ? (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Estoque Baixo
                </Badge>
              ) : (
                <Badge className="bg-emerald-500 text-white">Disponível</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono">SKU: {product.sku}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleLookup}
            disabled={checking}
            className="text-emerald-700 border-emerald-300"
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
            Consultar Estoque API
          </Button>
          <Button variant="outline" onClick={() => navigate(`/estoque/${product.id}/editar`)}>
            <Edit className="mr-1.5 h-4 w-4" /> Editar
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Preço de Venda
            </CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {formatCurrency(product.price)}
            </div>
            {product.cost && product.cost > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Custo: {formatCurrency(product.cost)} | Margem:{' '}
                {(((product.price - product.cost) / product.price) * 100).toFixed(1)}%
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Estoque Atual
            </CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{product.stock_quantity} un.</div>
            <p className="text-xs text-slate-500 mt-1">
              Mínimo recomendado: {product.min_stock || 0} un.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Status do Item
            </CardTitle>
            <Layers className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-base font-bold text-slate-800">
              {product.stock_quantity === 0
                ? 'Esgotado'
                : product.stock_quantity <= (product.min_stock || 0)
                  ? 'Abaixo do Mínimo'
                  : 'Estoque Regular'}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Cadastrado em {new Date(product.created).toLocaleDateString('pt-BR')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base font-bold">Informações Detalhadas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase">Descrição</h4>
            <p className="text-sm text-slate-700 mt-1 whitespace-pre-line">
              {product.description || 'Nenhuma descrição detalhada informada.'}
            </p>
          </div>

          <div className="pt-4 border-t flex items-center justify-between">
            <span className="text-xs text-slate-400">ID no Sistema: {product.id}</span>
            <Link
              to="/orcamentos/novo"
              className="text-xs text-emerald-600 font-semibold hover:underline"
            >
              Criar Orçamento com este Produto &rarr;
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
