import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProduct, createProduct, updateProduct, getProducts } from '@/services/products'
import { getFamilies } from '@/services/families'
import { getCompositionsByProduct, saveProductCompositions } from '@/services/compositions'
import { ItemFamily, Product, ProductType } from '@/types/crm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Layers, CheckCircle2, AlertCircle } from 'lucide-react'

interface FamilyCompositionState {
  familyId: string
  familyName: string
  selected: boolean
  required: boolean
  allowedProductIds: string[]
  availableProducts: Product[]
}

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
  const [productType, setProductType] = useState<ProductType>('comprado')
  const [supplier, setSupplier] = useState('')
  const [loading, setLoading] = useState(false)

  // Composição por Famílias (para produtos do tipo 'produzido')
  const [allFamilies, setAllFamilies] = useState<ItemFamily[]>([])
  const [allStockProducts, setAllStockProducts] = useState<Product[]>([])
  const [familyCompositions, setFamilyCompositions] = useState<FamilyCompositionState[]>([])
  const [loadingCompositions, setLoadingCompositions] = useState(false)

  const isEditing = Boolean(id)

  useEffect(() => {
    // Carregar todas as famílias e todos os produtos para a seleção de composição
    const initSupportData = async () => {
      try {
        const [fams, prods] = await Promise.all([getFamilies(), getProducts()])
        setAllFamilies(fams)
        setAllStockProducts(prods)
      } catch (err) {
        console.error('Erro ao carregar famílias ou produtos:', err)
      }
    }
    initSupportData()
  }, [])

  useEffect(() => {
    if (id) {
      getProduct(id)
        .then((p) => {
          setName(p.name)
          setSku(p.sku)
          setPrice(p.price)
          setCost(p.cost || 0)
          setStockQuantity(p.stock_quantity)
          setMinStock(p.min_stock || 0)
          setDescription(p.description || '')
          setProductType(p.product_type || 'comprado')
          setSupplier(p.supplier || '')
        })
        .catch((e) => {
          console.error(e)
          toast({ title: 'Erro ao carregar produto', variant: 'destructive' })
        })
    }
  }, [id])

  // Quando allFamilies ou id mudar, estruturar o estado de composições
  useEffect(() => {
    if (allFamilies.length === 0) return

    const loadExistingCompositions = async () => {
      setLoadingCompositions(true)
      try {
        const existingComps = id ? await getCompositionsByProduct(id) : []

        const initialStates: FamilyCompositionState[] = allFamilies.map((fam) => {
          const comp = existingComps.find((c) => c.family === fam.id)
          const familyProductIds = Array.isArray(fam.products) ? fam.products : []
          const availableProducts = allStockProducts.filter((p) => familyProductIds.includes(p.id))

          return {
            familyId: fam.id,
            familyName: fam.name,
            selected: Boolean(comp),
            required: comp ? (comp.required ?? true) : true,
            allowedProductIds: comp?.allowed_products || familyProductIds,
            availableProducts,
          }
        })

        setFamilyCompositions(initialStates)
      } catch (err) {
        console.error('Erro ao estruturar composições:', err)
      } finally {
        setLoadingCompositions(false)
      }
    }

    loadExistingCompositions()
  }, [allFamilies, allStockProducts, id])

  const toggleFamilySelection = (familyId: string) => {
    setFamilyCompositions((prev) =>
      prev.map((item) => {
        if (item.familyId === familyId) {
          const newSelected = !item.selected
          // Se for selecionada e não tiver itens permitidos definidos, seleciona todos os disponíveis por padrão
          const defaultAllowed =
            newSelected && item.allowedProductIds.length === 0
              ? item.availableProducts.map((p) => p.id)
              : item.allowedProductIds
          return {
            ...item,
            selected: newSelected,
            allowedProductIds: defaultAllowed,
          }
        }
        return item
      }),
    )
  }

  const toggleProductInFamily = (familyId: string, productId: string) => {
    setFamilyCompositions((prev) =>
      prev.map((item) => {
        if (item.familyId === familyId) {
          const exists = item.allowedProductIds.includes(productId)
          const updated = exists
            ? item.allowedProductIds.filter((pId) => pId !== productId)
            : [...item.allowedProductIds, productId]
          return { ...item, allowedProductIds: updated }
        }
        return item
      }),
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !sku) {
      toast({ title: 'Preencha nome e SKU', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      let savedProductId = id

      const payload = {
        name,
        sku,
        price,
        cost,
        stock_quantity: stockQuantity,
        min_stock: minStock,
        description,
        product_type: productType,
        supplier,
      }

      if (isEditing && id) {
        await updateProduct(id, payload)
      } else {
        const created = await createProduct(payload)
        savedProductId = created.id
      }

      // Se for produzido, salvar a configuração de composição por famílias
      if (productType === 'produzido' && savedProductId) {
        const selectedToSave = familyCompositions
          .filter((c) => c.selected)
          .map((c) => ({
            familyId: c.familyId,
            allowedProductIds: c.allowedProductIds,
            required: c.required,
          }))

        await saveProductCompositions(savedProductId, selectedToSave)
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
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isEditing ? 'Editar Produto' : 'Novo Produto'}
          </h1>
          <p className="text-xs text-slate-500">
            Configure dados gerais, tipo de item (comprado/produzido) e composições
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide border-b pb-2">
            Identificação e Classificação
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Nome do Produto *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Ex: Bucha de Vedação Especial"
              />
            </div>

            <div className="space-y-1.5">
              <Label>SKU / Código *</Label>
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
                placeholder="BUC-01"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo de Produto *</Label>
              <Select value={productType} onValueChange={(val: ProductType) => setProductType(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comprado">
                    <span className="font-semibold text-slate-800">Comprado</span> — Matéria-prima /
                    insumo de fornecedor
                  </SelectItem>
                  <SelectItem value="produzido">
                    <span className="font-semibold text-emerald-700">Produzido</span> — Fabricado
                    internamente via OP
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                {productType === 'produzido' ? 'Linha / Responsável' : 'Fornecedor Principal'}
              </Label>
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder={
                  productType === 'produzido'
                    ? 'Ex: PCP / Linha Montagem'
                    : 'Ex: Borrachas Brasil Ltda'
                }
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
              <Label>
                {productType === 'produzido'
                  ? 'Custo Real / Estimado da Produção (R$)'
                  : 'Custo de Compra (R$)'}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
              {productType === 'produzido' && (
                <p className="text-[11px] text-slate-400">
                  Calculado e atualizado automaticamente ao concluir Ordens de Produção.
                </p>
              )}
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
              placeholder="Especificações técnicas, aplicação automotiva..."
            />
          </div>
        </div>

        {/* Seção Condicional: Composição por Famílias (quando for Produzido) */}
        {productType === 'produzido' && (
          <Card className="border-emerald-200 bg-white shadow-sm overflow-hidden">
            <CardHeader className="bg-emerald-50/60 border-b border-emerald-100">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-emerald-700" />
                <CardTitle className="text-base font-bold text-emerald-950">
                  Composição por Famílias
                </CardTitle>
              </div>
              <CardDescription className="text-emerald-800 text-xs">
                Selecione quais famílias são obrigatórias para fabricar este produto. Para cada
                família selecionada, indique os itens específicos permitidos como insumo.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              {loadingCompositions ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Carregando famílias cadastradas...
                </p>
              ) : allFamilies.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    Nenhuma família de insumos encontrada. Cadastre famílias no menu{' '}
                    <strong>Famílias</strong> antes de montar a composição.
                  </span>
                </div>
              ) : (
                <div className="space-y-4">
                  {familyCompositions.map((fam) => (
                    <div
                      key={fam.familyId}
                      className={`p-4 rounded-xl border transition-colors ${
                        fam.selected
                          ? 'border-emerald-300 bg-emerald-50/20'
                          : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <Checkbox
                            checked={fam.selected}
                            onCheckedChange={() => toggleFamilySelection(fam.familyId)}
                          />
                          <span className="font-bold text-slate-900 text-sm">
                            Família: {fam.familyName}
                          </span>
                        </label>
                        {fam.selected && (
                          <Badge className="bg-emerald-600 text-white text-[10px]">
                            Obrigatória na Produção
                          </Badge>
                        )}
                      </div>

                      {fam.selected && (
                        <div className="mt-3 pt-3 border-t border-slate-200/80 pl-6 space-y-2">
                          <p className="text-xs font-semibold text-slate-600">
                            Itens específicos permitidos desta família para produzir este produto:
                          </p>

                          {fam.availableProducts.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">
                              Nenhum produto cadastrado dentro desta família. Adicione itens na tela
                              de Famílias.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                              {fam.availableProducts.map((prod) => {
                                const isAllowed = fam.allowedProductIds.includes(prod.id)
                                return (
                                  <label
                                    key={prod.id}
                                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                      isAllowed
                                        ? 'bg-white border-emerald-300 shadow-xs'
                                        : 'bg-slate-100/60 border-slate-200 text-slate-500'
                                    }`}
                                  >
                                    <Checkbox
                                      checked={isAllowed}
                                      onCheckedChange={() =>
                                        toggleProductInFamily(fam.familyId, prod.id)
                                      }
                                      className="mt-0.5"
                                    />
                                    <div className="min-w-0">
                                      <p className="font-semibold text-slate-900 truncate">
                                        {prod.name}
                                      </p>
                                      <p className="text-[10px] text-slate-500 font-mono">
                                        SKU: {prod.sku} • Estoque: {prod.stock_quantity} un.
                                      </p>
                                      <p className="text-[10px] text-emerald-700 font-semibold">
                                        Custo: R$ {(prod.cost || 0).toFixed(2)}
                                      </p>
                                    </div>
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-3 pt-2">
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
