import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProduct, createProduct, updateProduct, getProducts } from '@/services/products'
import { getFamilies } from '@/services/families'
import { getCompositionsByProduct, saveProductCompositions } from '@/services/compositions'
import { ItemFamily, Product } from '@/types/crm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Layers, AlertCircle, ShoppingCart, Factory, Boxes } from 'lucide-react'

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
  const [supplier, setSupplier] = useState('')
  const [brand, setBrand] = useState('')
  const [barcode, setBarcode] = useState('')
  const [reducedCode, setReducedCode] = useState('')
  const [location1, setLocation1] = useState('')
  const [location2, setLocation2] = useState('')
  const [location3, setLocation3] = useState('')
  const [loading, setLoading] = useState(false)

  // Três flags independentes de comportamento do produto
  const [isPurchased, setIsPurchased] = useState(true)
  const [isProduced, setIsProduced] = useState(false)
  const [isComponent, setIsComponent] = useState(false)

  // Composição por Famílias (para produtos quando isProduced está marcada)
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
          setSupplier(p.supplier || '')
          setBrand(p.brand || '')
          setBarcode(p.barcode || '')
          setReducedCode(p.reduced_code || '')
          setLocation1(p.location_1 || '')
          setLocation2(p.location_2 || '')
          setLocation3(p.location_3 || '')

          // Inicializar flags booleanas (compatibilidade com registros antigos)
          const prodFlag =
            p.is_produced !== undefined ? Boolean(p.is_produced) : p.product_type === 'produzido'
          const purFlag =
            p.is_purchased !== undefined ? Boolean(p.is_purchased) : p.product_type !== 'produzido'
          const compFlag = p.is_component !== undefined ? Boolean(p.is_component) : false

          setIsProduced(prodFlag)
          setIsPurchased(purFlag)
          setIsComponent(compFlag)
        })
        .catch((e) => {
          console.error(e)
          toast({ title: 'Erro ao carregar produto', variant: 'destructive' })
        })
    }
  }, [id])

  // Quando allFamilies ou id mudar, estruturar o estado de composições
  // Regra do usuário: "Apenas produtos com a flag 'Composto (insumo)' aparecem como opções"
  useEffect(() => {
    if (allFamilies.length === 0) return

    const loadExistingCompositions = async () => {
      setLoadingCompositions(true)
      try {
        const existingComps = id ? await getCompositionsByProduct(id) : []

        const initialStates: FamilyCompositionState[] = allFamilies.map((fam) => {
          const comp = existingComps.find((c) => c.family === fam.id)
          const familyProductIds = Array.isArray(fam.products) ? fam.products : []

          // Filtra somente produtos da família que tenham a flag is_component marcada
          // e que não sejam o próprio produto que está sendo editado (evita autorreferência circular)
          const availableProducts = allStockProducts.filter((p) => {
            const matchesFamily = familyProductIds.includes(p.id)
            const isComp = Boolean(p.is_component)
            const notSelf = p.id !== id
            return matchesFamily && isComp && notSelf
          })

          const allowedFromComp = comp?.allowed_products || []
          // Se existia comp salva com IDs, mantemos os válidos que são insumos disponíveis
          const availableIds = availableProducts.map((p) => p.id)
          const allowedProductIds = comp
            ? allowedFromComp.filter((pId) => availableIds.includes(pId))
            : availableIds

          return {
            familyId: fam.id,
            familyName: fam.name,
            selected: Boolean(comp),
            required: comp ? (comp.required ?? true) : true,
            allowedProductIds,
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

    if (!isPurchased && !isProduced && !isComponent) {
      toast({
        title: 'Selecione ao menos uma natureza',
        description: 'Marque pelo menos uma das opções: Comprado, Produzido ou Composto (insumo).',
        variant: 'destructive',
      })
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
        supplier,
        brand,
        barcode,
        reduced_code: reducedCode,
        location_1: location1,
        location_2: location2,
        location_3: location3,
        is_purchased: isPurchased,
        is_produced: isProduced,
        is_component: isComponent,
        // Mantém product_type sincronizado para compatibilidade
        product_type: (isProduced ? 'produzido' : 'comprado') as 'comprado' | 'produzido',
      }

      if (isEditing && id) {
        await updateProduct(id, payload)
      } else {
        const created = await createProduct(payload)
        savedProductId = created.id
      }

      // Se for produzido, salvar a configuração de composição por famílias
      if (isProduced && savedProductId) {
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
      navigate('/produtos')
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

          {/* Três Flags Independentes de Natureza do Produto */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Naturezas do Produto (Comportamento no Sistema) *
            </Label>
            <p className="text-xs text-slate-500">
              Marque uma, duas ou as três opções simultaneamente para definir as permissões deste
              item:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {/* Flag 1: Comprado */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  isPurchased
                    ? 'border-emerald-500 bg-emerald-50/50 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <Checkbox
                  checked={isPurchased}
                  onCheckedChange={(checked) => setIsPurchased(Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                    <ShoppingCart className="h-4 w-4 text-emerald-600" />
                    <span>Comprado</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">
                    Pode gerar ordem de compra de fornecedores. Se desmarcado, não aparece em telas
                    de compra.
                  </p>
                </div>
              </label>

              {/* Flag 2: Produzido */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  isProduced
                    ? 'border-purple-500 bg-purple-50/50 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <Checkbox
                  checked={isProduced}
                  onCheckedChange={(checked) => setIsProduced(Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                    <Factory className="h-4 w-4 text-purple-600" />
                    <span>Produzido</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">
                    Fabricado internamente na empresa com composição por famílias. Gera Ordens de
                    Produção (OP).
                  </p>
                </div>
              </label>

              {/* Flag 3: Composto (insumo) */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  isComponent
                    ? 'border-blue-500 bg-blue-50/50 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <Checkbox
                  checked={isComponent}
                  onCheckedChange={(checked) => setIsComponent(Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                    <Boxes className="h-4 w-4 text-blue-600" />
                    <span>Composto (insumo)</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">
                    Pode ser insumo na composição de outros produtos. Aparece nas opções de famílias
                    de peças.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5 md:col-span-2">
              <Label>
                {isProduced && !isPurchased
                  ? 'Linha / Responsável pela Fabricação'
                  : 'Fornecedor Principal / Origem'}
              </Label>
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder={
                  isProduced && !isPurchased
                    ? 'Ex: PCP / Linha de Montagem Interna'
                    : 'Ex: Borrachas Brasil Ltda, Metalúrgica Central...'
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
                {isProduced ? 'Custo Real da Produção (R$)' : 'Custo de Aquisição (R$)'}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
              {isProduced && (
                <p className="text-[11px] text-slate-400">
                  Calculado pela soma dos insumos reais usados e atualizado ao concluir OPs.
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

        {/* Informações de Fabricante, Códigos e Localização (SOU.IS / Estoque) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide border-b pb-2">
            Códigos, Fabricante e Localização Física
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Marca do Fabricante</Label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Ex: JAHU, COFAP, NAKATA, RPA..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Código Reduzido</Label>
              <Input
                value={reducedCode}
                onChange={(e) => setReducedCode(e.target.value)}
                placeholder="Ex: 3148"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Código de Barras (EAN)</Label>
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Ex: 7893732134999"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <Label className="text-xs font-semibold text-slate-700">
              Localização Física no Estoque (Ex: Corredor / Prateleira / Gaveta)
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 font-normal">Local 1 (Corredor/Rua)</Label>
                <Input
                  value={location1}
                  onChange={(e) => setLocation1(e.target.value)}
                  placeholder="Ex: 6"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 font-normal">
                  Local 2 (Prateleira/Coluna)
                </Label>
                <Input
                  value={location2}
                  onChange={(e) => setLocation2(e.target.value)}
                  placeholder="Ex: B"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 font-normal">Local 3 (Nível/Gaveta)</Label>
                <Input
                  value={location3}
                  onChange={(e) => setLocation3(e.target.value)}
                  placeholder="Ex: 02"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Seção Condicional: Composição por Famílias (quando for Produzido) */}
        {isProduced && (
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
          <Button type="button" variant="outline" onClick={() => navigate('/produtos')}>
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
