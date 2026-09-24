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
  ShoppingCart,
  Factory,
  Boxes,
  Barcode,
  MapPin,
  Tag,
  Hash,
} from 'lucide-react'
import { getProduct, deleteProduct } from '@/services/products'
import { lookupStock } from '@/services/stock'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

import { useTabs } from '@/contexts/TabsContext'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { activeTab, updateTabTitle } = useTabs()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const loadData = async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const p = await getProduct(id)
      setProduct(p)
      if (activeTab && activeTab.id) {
        updateTabTitle(activeTab.id, `Estoque — ${p.name || 'Detalhes'}`)
      }
    } catch (e: any) {
      console.error(e)
      setLoadError(e?.message || 'Falha ao carregar produto.')
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
      toast({ title: 'Produto excluído com sucesso!' })
      navigate('/produtos')
    } catch (_) {
      toast({ title: 'Erro ao excluir produto', variant: 'destructive' })
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Carregando detalhes do produto...</div>
  }

  if (loadError) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3 bg-white border border-red-200 rounded-xl">
        <p className="text-sm text-slate-700 font-medium">Erro ao carregar produto.</p>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Button onClick={loadData} variant="outline" size="sm">
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!product) {
    return <div className="p-8 text-center text-slate-500">Produto não encontrado.</div>
  }

  const isLowStock = product.stock_quantity <= (product.min_stock || 0)
  const isPur =
    product.is_purchased !== undefined
      ? Boolean(product.is_purchased)
      : product.product_type !== 'produzido'
  const isProd =
    product.is_produced !== undefined
      ? Boolean(product.is_produced)
      : product.product_type === 'produzido'
  const isComp = Boolean(product.is_component)

  const locationParts = [product.location_1, product.location_2, product.location_3]
    .map((s) => (s || '').trim())
    .filter(Boolean)
  const locationDisplay = locationParts.join(' · ')

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/produtos')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
              {product.brand && (
                <Badge variant="outline" className="text-xs font-normal text-slate-600 bg-slate-50">
                  {product.brand}
                </Badge>
              )}
              {isLowStock ? (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Estoque Baixo
                </Badge>
              ) : (
                <Badge className="bg-emerald-500 text-white">Disponível</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <p className="text-xs text-slate-400 font-mono">
                SKU: {product.sku} {product.reduced_code ? `• Red: ${product.reduced_code} ` : ''}
                {product.supplier ? `• Fornecedor/Origem: ${product.supplier}` : ''}
              </p>
              <div className="flex items-center gap-1.5">
                {isPur && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-200 flex items-center gap-1"
                  >
                    <ShoppingCart className="h-3 w-3" /> Comprado
                  </Badge>
                )}
                {isProd && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-purple-50 text-purple-800 border-purple-200 flex items-center gap-1"
                  >
                    <Factory className="h-3 w-3" /> Produzido
                  </Badge>
                )}
                {isComp && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-blue-50 text-blue-800 border-blue-200 flex items-center gap-1"
                  >
                    <Boxes className="h-3 w-3" /> Insumo
                  </Badge>
                )}
              </div>
            </div>
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
          <Button variant="outline" onClick={() => navigate(`/produtos/${product.id}/editar`)}>
            <Edit className="mr-1.5 h-4 w-4" /> Editar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="text-red-500 hover:text-red-700"
            title="Excluir produto"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
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
            {!product.stock_quantity || product.stock_quantity <= 0 ? (
              <div>
                <div className="text-xl font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded inline-block border border-amber-200">
                  Sob consulta
                </div>
                <p className="text-xs text-slate-500 mt-1.5 italic">
                  Item sem estoque imediato. Valor sob consulta.
                </p>
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold text-emerald-600">
                  {formatCurrency(product.price)}
                </div>
                {product.cost && product.cost > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Custo: {formatCurrency(product.cost)} | Margem:{' '}
                    {(((product.price - product.cost) / product.price) * 100).toFixed(1)}%
                  </p>
                )}
              </>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Identificação e Códigos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-slate-400" /> Marca do Fabricante
              </span>
              <span className="font-semibold text-slate-900">{product.brand || '—'}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-slate-400" /> Código Reduzido
              </span>
              <span className="font-mono font-semibold text-slate-900">
                {product.reduced_code || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Barcode className="h-3.5 w-3.5 text-slate-400" /> Código de Barras (EAN)
              </span>
              <span className="font-mono font-semibold text-slate-900">
                {product.barcode || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-slate-500 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" /> Localização Física
              </span>
              <span className="font-medium text-slate-900">
                {locationDisplay ? `📍 ${locationDisplay}` : '—'}
              </span>
            </div>
          </CardContent>
        </Card>

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
    </div>
  )
}
