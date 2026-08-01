import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProduct, createProduct, updateProduct } from '@/services/products'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

export default function ProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState<number>(0)
  const [cost, setCost] = useState<number>(0)
  const [stockQuantity, setStockQuantity] = useState<number>(0)
  const [minStock, setMinStock] = useState<number>(5)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const isEditing = Boolean(id)

  useEffect(() => {
    if (id) {
      getProduct(id).then((p) => {
        setName(p.name)
        setSku(p.sku)
        setPrice(p.price)
        setCost(p.cost || 0)
        setStockQuantity(p.stock_quantity)
        setMinStock(p.min_stock || 0)
        setDescription(p.description || '')
      })
    }
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !sku) {
      toast({ title: 'Preencha nome e SKU', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      if (isEditing && id) {
        await updateProduct(id, {
          name,
          sku,
          price,
          cost,
          stock_quantity: stockQuantity,
          min_stock: minStock,
          description,
        })
      } else {
        await createProduct({
          name,
          sku,
          price,
          cost,
          stock_quantity: stockQuantity,
          min_stock: minStock,
          description,
        })
      }
      toast({ title: 'Produto salvo com sucesso!' })
      navigate('/estoque')
    } catch (_) {
      toast({
        title: 'Erro ao salvar produto. Verifique se o SKU é único.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {isEditing ? 'Editar Produto' : 'Novo Produto'}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 rounded-xl border border-slate-200 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Nome do Produto *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Ex: Monitor UltraWide"
            />
          </div>

          <div className="space-y-1.5">
            <Label>SKU / Código *</Label>
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              required
              placeholder="MON-01"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Preço de Venda (R$) *</Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Custo Estimado (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Quantidade em Estoque *</Label>
            <Input
              type="number"
              value={stockQuantity}
              onChange={(e) => setStockQuantity(parseInt(e.target.value) || 0)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Estoque Mínimo para Alerta</Label>
            <Input
              type="number"
              value={minStock}
              onChange={(e) => setMinStock(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Descrição do Produto</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Especificações técnicas..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => navigate('/estoque')}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            {loading ? 'Salvando...' : 'Salvar Produto'}
          </Button>
        </div>
      </form>
    </div>
  )
}
