import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Printer,
  Copy,
  RotateCcw,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  Info,
  Loader2,
  AlertTriangle,
  X,
  Package,
} from 'lucide-react'
import { Product } from '@/types/crm'
import { ProductLabel, formatLocation } from '@/components/ProductLabel'
import { searchRawProducts, getAllRawFilteredProducts } from '@/services/products'
import { getLightFamilyNames } from '@/services/families'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { toast } from '@/hooks/use-toast'

export interface PrintLabelItem {
  product: Product
  copies: number
}

export interface PrintLabelsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Lista de produtos pré-selecionados inicialmente (ex: linha clicada ou checkboxes marcados na tabela).
   */
  initialProducts?: Product[]
  /**
   * @deprecated Não mais utilizado para evitar varredura global na abertura. Mantido por retrocompatibilidade de tipagem.
   */
  allProducts?: Product[]
}

export const PrintLabelsModal: React.FC<PrintLabelsModalProps> = ({
  open,
  onOpenChange,
  initialProducts = [],
}) => {
  // -------------------------------------------------------------
  // ESTADOS DA SELEÇÃO CONSOLIDADA (POOL ÚNICO POR ID COM VIAS)
  // -------------------------------------------------------------
  // Mapa de quantidades por produto (id -> número de vias) - Guard M4
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // Dicionário dos produtos selecionados (id -> Product) para manter dados disponíveis mesmo se sumirem da busca atual
  const [selectedPool, setSelectedPool] = useState<Map<string, Product>>(() => new Map())
  // Lista ordenada de IDs dos produtos atualmente selecionados
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // -------------------------------------------------------------
  // ESTADOS DE BUSCA SOB DEMANDA (M1, M2, M3, M7, M8)
  // -------------------------------------------------------------
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [selectedFamily, setSelectedFamily] = useState<string>('all')
  const [availableFamilies, setAvailableFamilies] = useState<string[]>([])

  // Resultados retornados pela busca atual
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [totalMatchingResults, setTotalMatchingResults] = useState<number>(0)
  const [isSearching, setIsSearching] = useState<boolean>(false)
  const [isLoadingAllFiltered, setIsLoadingAllFiltered] = useState<boolean>(false)

  // -------------------------------------------------------------
  // ESTADOS DE PRÉVIA E IMPRESSÃO (M5, M9)
  // -------------------------------------------------------------
  const [bulkCopies, setBulkCopies] = useState<number>(1)
  const [previewProductId, setPreviewProductId] = useState<string | null>(null)
  const [rotatedPreview, setRotatedPreview] = useState<boolean>(true)
  const [isPrinting, setIsPrinting] = useState<boolean>(false)
  const [showLargeBatchConfirm, setShowLargeBatchConfirm] = useState<boolean>(false)

  // Ref para o input de busca (Guard M1: foco imediato na abertura)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------
  // M1: ABERTURA SEM VARREDURA DO CATÁLOGO
  // -------------------------------------------------------------
  useEffect(() => {
    if (open) {
      // 1. Inicializa o pool com os produtos pré-selecionados (se houver)
      const nextMap = new Map<string, Product>()
      const nextQuantities: Record<string, number> = {}
      const nextIds: string[] = []

      initialProducts.forEach((p) => {
        if (p && p.id) {
          nextMap.set(p.id, p)
          nextQuantities[p.id] = 1
          nextIds.push(p.id)
        }
      })

      setSelectedPool(nextMap)
      setQuantities(nextQuantities)
      setSelectedIds(nextIds)
      setPreviewProductId(nextIds[0] || null)

      // 2. Limpa busca e resultados (área de seleção vazia na abertura)
      setSearchFilter('')
      setDebouncedSearch('')
      setSelectedFamily('all')
      setSearchResults([])
      setTotalMatchingResults(0)
      setIsSearching(false)
      setShowLargeBatchConfirm(false)

      // 3. Foco no campo de busca (M1)
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 80)

      // 4. Carrega famílias conhecidas via endpoint leve (sem produtos)
      getLightFamilyNames().then((names) => {
        // Se houver famílias em produtos pré-selecionados, mescla também
        const set = new Set<string>(names)
        initialProducts.forEach((p) => {
          if (p.sou_family && p.sou_family.trim()) set.add(p.sou_family.trim())
        })
        setAvailableFamilies(Array.from(set).sort((a, b) => a.localeCompare(b)))
      })
    }
  }, [open, initialProducts])

  // -------------------------------------------------------------
  // M7: DEBOUNCE ~300ms + MÍNIMO 2 CARACTERES
  // -------------------------------------------------------------
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchFilter.trim())
    }, 300)
    return () => clearTimeout(handler)
  }, [searchFilter])

  // -------------------------------------------------------------
  // M1 + M2 + M3 + M8: CONSULTA SOB DEMANDA NO BACKEND
  // -------------------------------------------------------------
  const executeSearch = useCallback(async (term: string, family: string) => {
    const hasTerm = term.length >= 2
    const hasFamily = family !== 'all' && Boolean(family)

    // Se não digitou ao menos 2 caracteres e não escolheu família, mantém área de busca vazia (M1)
    if (!hasTerm && !hasFamily) {
      setSearchResults([])
      setTotalMatchingResults(0)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      const res = await searchRawProducts({
        term: hasTerm ? term : '',
        family: hasFamily ? family : '',
        page: 1,
        perPage: 50,
      })
      setSearchResults(res.items)
      setTotalMatchingResults(res.totalItems)
    } catch (err) {
      console.warn('Falha na busca sob demanda do modal de etiquetas:', err)
      setSearchResults([])
      setTotalMatchingResults(0)
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    executeSearch(debouncedSearch, selectedFamily)
  }, [debouncedSearch, selectedFamily, open, executeSearch])

  // -------------------------------------------------------------
  // PRODUTOS ATIVOS E PRÉ-VISUALIZAÇÃO
  // -------------------------------------------------------------
  const activeProducts = useMemo(() => {
    return selectedIds.map((id) => selectedPool.get(id)).filter((p): p is Product => Boolean(p))
  }, [selectedIds, selectedPool])

  const currentPreviewProduct = useMemo(() => {
    if (previewProductId && selectedPool.has(previewProductId)) {
      return selectedPool.get(previewProductId)!
    }
    return activeProducts[0] || null
  }, [previewProductId, selectedPool, activeProducts])

  // Total de etiquetas físicas (soma das vias)
  const totalLabelsToPrint = useMemo(() => {
    return selectedIds.reduce((sum, id) => {
      const q = quantities[id] !== undefined ? quantities[id] : 1
      return sum + (q > 0 ? q : 0)
    }, 0)
  }, [selectedIds, quantities])

  // -------------------------------------------------------------
  // M4: DEDUPE E CONSOLIDAÇÃO DA SELEÇÃO POR ID
  // -------------------------------------------------------------
  const handleToggleProduct = (product: Product) => {
    if (!product || !product.id) return
    const id = product.id

    setSelectedIds((prev) => {
      const exists = prev.includes(id)
      if (exists) {
        // Desmarca: remove de selectedIds mas mantém quantidade salva se o usuário remarcar depois
        return prev.filter((item) => item !== id)
      } else {
        // Marca: adiciona ao pool sem perder vias existentes
        setSelectedPool((pool) => {
          const updated = new Map(pool)
          updated.set(id, product)
          return updated
        })
        setQuantities((qPrev) => ({
          ...qPrev,
          [id]: qPrev[id] || 1,
        }))
        return [...prev, id]
      }
    })

    // Coloca em foco no preview ao selecionar
    setPreviewProductId(id)
  }

  // Atualização de vias com preservação
  const setProductCopies = (id: string, count: number) => {
    const valid = Math.max(1, Math.min(999, Math.floor(count) || 1))
    setQuantities((prev) => ({ ...prev, [id]: valid }))
  }

  // Aplicação em massa de vias para os selecionados
  const handleApplyBulkCopies = () => {
    if (selectedIds.length === 0) {
      toast({
        title: 'Nenhum produto selecionado',
        description: 'Selecione ao menos um produto para aplicar vias em massa.',
        variant: 'destructive',
      })
      return
    }
    const val = Math.max(1, Math.min(999, bulkCopies))
    setQuantities((prev) => {
      const next = { ...prev }
      selectedIds.forEach((id) => {
        next[id] = val
      })
      return next
    })
    toast({
      title: 'Vias atualizadas',
      description: `Definido ${val} via(s) para os ${selectedIds.length} produto(s) selecionado(s).`,
    })
  }

  // -------------------------------------------------------------
  // M6: SELECIONAR TODOS FILTRADOS (CONJUNTO COMPLETO DA CONSULTA)
  // -------------------------------------------------------------
  // Quantos itens do resultado da busca atual estão selecionados
  const filteredSelectedCount = useMemo(() => {
    if (searchResults.length === 0) return 0
    return searchResults.filter((p) => selectedIds.includes(p.id)).length
  }, [searchResults, selectedIds])

  const isAllCurrentResultsSelected = useMemo(() => {
    if (searchResults.length === 0) return false
    return searchResults.every((p) => selectedIds.includes(p.id))
  }, [searchResults, selectedIds])

  const handleToggleSelectAllFiltered = async () => {
    if (searchResults.length === 0 && totalMatchingResults === 0) return

    // Se todos da busca visível já estão selecionados, desmarca apenas eles
    if (isAllCurrentResultsSelected) {
      const currentIdsSet = new Set(searchResults.map((p) => p.id))
      setSelectedIds((prev) => prev.filter((id) => !currentIdsSet.has(id)))
      return
    }

    // Se há mais resultados do que a página de 50 retornou, busca todos os resultados deste filtro (M6)
    setIsLoadingAllFiltered(true)
    try {
      let fullItemsToSelect: Product[] = searchResults
      if (totalMatchingResults > searchResults.length) {
        fullItemsToSelect = await getAllRawFilteredProducts({
          term: debouncedSearch.length >= 2 ? debouncedSearch : '',
          family: selectedFamily !== 'all' ? selectedFamily : '',
        })
      }

      // Adiciona todos ao pool consolidado preservando seleções anteriores e vias existentes (M4)
      setSelectedPool((prevPool) => {
        const nextPool = new Map(prevPool)
        fullItemsToSelect.forEach((p) => nextPool.set(p.id, p))
        return nextPool
      })

      setQuantities((prevQ) => {
        const nextQ = { ...prevQ }
        fullItemsToSelect.forEach((p) => {
          if (!nextQ[p.id]) nextQ[p.id] = 1
        })
        return nextQ
      })

      const newIds = fullItemsToSelect.map((p) => p.id)
      setSelectedIds((prev) => Array.from(new Set([...prev, ...newIds])))

      toast({
        title: 'Produtos marcados',
        description: `${fullItemsToSelect.length} produto(s) do filtro selecionados.`,
      })
    } catch (err) {
      console.warn('Erro ao marcar todos os filtrados:', err)
      toast({
        title: 'Erro ao selecionar todos',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingAllFiltered(false)
    }
  }

  // -------------------------------------------------------------
  // M9: CONFIRMAÇÃO DE LOTE GRANDE (> 50 ETIQUETAS)
  // -------------------------------------------------------------
  const handlePrintClick = () => {
    if (totalLabelsToPrint === 0) {
      toast({
        title: 'Nenhuma etiqueta para imprimir',
        description: 'Selecione ao menos um produto com quantidade maior que zero.',
        variant: 'destructive',
      })
      return
    }

    if (totalLabelsToPrint > 50) {
      setShowLargeBatchConfirm(true)
    } else {
      executePrint()
    }
  }

  // Fila física desdobrada (uma etiqueta por página)
  const printQueuePages = useMemo(() => {
    const pages: Product[] = []
    selectedIds.forEach((id) => {
      const p = selectedPool.get(id)
      if (p) {
        const count = quantities[id] !== undefined ? quantities[id] : 1
        for (let i = 0; i < count; i++) {
          pages.push(p)
        }
      }
    })
    return pages
  }, [selectedIds, quantities, selectedPool])

  // Disparo da impressão via diálogo nativo
  const executePrint = () => {
    setShowLargeBatchConfirm(false)
    setIsPrinting(true)
    document.body.classList.add('printing-labels')

    setTimeout(() => {
      window.print()

      setTimeout(() => {
        document.body.classList.remove('printing-labels')
        setIsPrinting(false)
      }, 500)
    }, 150)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-50">
          {/* HEADER DO MODAL */}
          <DialogHeader className="p-4 sm:p-5 bg-white border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-slate-900">
                    Impressão de Etiquetas de Produto (70 × 30 mm)
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    Busca sob demanda de inventário • Borda de 2 mm • Code 128 com SKU, código e
                    localização
                  </DialogDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-800 border-emerald-300 font-mono text-xs px-2.5 py-1"
                >
                  {totalLabelsToPrint} {totalLabelsToPrint === 1 ? 'etiqueta' : 'etiquetas'} /{' '}
                  {activeProducts.length} itens
                </Badge>
              </div>
            </div>
          </DialogHeader>

          {/* CORPO DO MODAL (DUAS COLUNAS: PREVIEW WYSIWYG + GESTÃO DO LOTE COM BUSCA) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUNA ESQUERDA: PRÉ-VISUALIZAÇÃO WYSIWYG (M5) */}
            <div className="lg:col-span-5 flex flex-col items-center justify-start space-y-4">
              <div className="w-full bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center">
                <div className="w-full flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Pré-Visualização Real (WYSIWYG)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRotatedPreview(!rotatedPreview)}
                      className="text-xs font-semibold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                      title={
                        rotatedPreview
                          ? 'Ver na horizontal normal'
                          : 'Ver na vertical/90° do modelo real'
                      }
                    >
                      <RotateCcw className="h-3 w-3" />
                      {rotatedPreview ? '90° Vertical (Em pé)' : 'Horizontal'}
                    </button>
                  </div>
                </div>

                {/* ÁREA DA ETIQUETA COM BORDA DE 2mm E ROTAÇÃO 90° REAL */}
                <div className="p-3 bg-slate-100 rounded-lg border border-slate-300 flex items-center justify-center min-h-[170px] w-full overflow-hidden">
                  {currentPreviewProduct ? (
                    <div
                      className={`transition-transform duration-200 flex items-center justify-center ${
                        rotatedPreview ? 'rotate-90 my-8' : ''
                      }`}
                      style={{
                        transformOrigin: 'center center',
                      }}
                    >
                      <ProductLabel
                        product={currentPreviewProduct}
                        mode="preview"
                        showBorder={true}
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic text-center py-6">
                      Nenhum produto selecionado para prévia
                    </div>
                  )}
                </div>

                {/* INFORMAÇÕES DA ETIQUETA ATUAL */}
                {currentPreviewProduct && (
                  <div className="w-full mt-3 pt-3 border-t border-slate-100 text-xs space-y-1">
                    <div className="flex justify-between text-slate-500">
                      <span>Dimensões:</span>
                      <strong className="text-slate-800">70 mm × 30 mm (Útil: 66×26 mm)</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Borda de tolerância:</span>
                      <strong className="text-emerald-700 font-bold">2 mm nos 4 lados</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Código de barras:</span>
                      <strong className="text-slate-800 font-mono">
                        Code 128 ({currentPreviewProduct.sku})
                      </strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Localização:</span>
                      <strong className="text-slate-800">
                        {formatLocation(currentPreviewProduct) || 'Sem localização'}
                      </strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Vias deste item:</span>
                      <strong className="text-emerald-700 font-bold">
                        {quantities[currentPreviewProduct.id] !== undefined
                          ? quantities[currentPreviewProduct.id]
                          : 1}{' '}
                        cópia(s)
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              {/* DICA DE IMPRESSÃO TÉRMICA */}
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Dica para Zebra/Argox (Tear-off):</p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    No diálogo de impressão do navegador, selecione a impressora térmica, papel{' '}
                    <strong>70×30 mm</strong>, margens <strong>Nenhuma</strong> e escala{' '}
                    <strong>100%</strong>. A etiqueta sai EM PÉ com 2mm de recuo de segurança.
                  </p>
                </div>
              </div>
            </div>

            {/* COLUNA DIREITA: GESTÃO DO LOTE, BUSCA SOB DEMANDA E FAMÍLIAS */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              {/* BARRA DE FERRAMENTAS: FILTRO POR FAMÍLIA E VIAS EM MASSA */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* FILTRAR POR FAMÍLIA (M3: QUERY FILTRADA SEM CARGA GLOBAL) */}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      Filtrar por Família:
                    </Label>
                    <Select value={selectedFamily} onValueChange={(val) => setSelectedFamily(val)}>
                      <SelectTrigger className="h-8 text-xs bg-slate-50">
                        <SelectValue placeholder="Todas as famílias" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as famílias</SelectItem>
                        {availableFamilies.map((fam) => (
                          <SelectItem key={fam} value={fam}>
                            {fam}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* APLICAÇÃO DE VIAS EM MASSA */}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      Vias para todos os itens:
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min="1"
                        max="999"
                        value={bulkCopies}
                        onChange={(e) => setBulkCopies(parseInt(e.target.value, 10) || 1)}
                        className="h-8 text-xs w-20 text-center font-bold"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleApplyBulkCopies}
                        className="h-8 text-xs flex-1"
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Aplicar a Todos
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* LISTA DE PRODUTOS / BUSCA SOB DEMANDA COM SELEÇÃO CONSOLIDADA */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden flex-1 min-h-[340px]">
                {/* BARRA DE PESQUISA COM FOCO (M1, M7) */}
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      ref={searchInputRef}
                      placeholder="Buscar por SKU, nome ou localização (min. 2 caracteres)..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-8 pl-8 pr-8 text-xs bg-white"
                    />
                    {searchFilter && (
                      <button
                        type="button"
                        onClick={() => setSearchFilter('')}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                        title="Limpar busca"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    {/* Botão Selecionar Todos / Desmarcar Todos (M6: todo o conjunto da query) */}
                    <button
                      type="button"
                      onClick={handleToggleSelectAllFiltered}
                      disabled={
                        isLoadingAllFiltered ||
                        (searchResults.length === 0 && totalMatchingResults === 0)
                      }
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:text-slate-400 flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Selecionar ou desmarcar todos os resultados desta busca"
                    >
                      {isLoadingAllFiltered ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                          <span>Marcando todos...</span>
                        </>
                      ) : isAllCurrentResultsSelected ? (
                        <>
                          <CheckSquare className="h-4 w-4 text-emerald-600" />
                          <span>Desmarcar filtrados</span>
                        </>
                      ) : (
                        <>
                          <Square className="h-4 w-4 text-slate-400" />
                          <span>Selecionar todos filtrados</span>
                        </>
                      )}
                    </button>

                    <span className="text-xs text-slate-500 font-medium">
                      {filteredSelectedCount > 0 && (
                        <strong className="text-emerald-700 font-bold mr-1">
                          {filteredSelectedCount} de{' '}
                          {totalMatchingResults > searchResults.length
                            ? totalMatchingResults
                            : searchResults.length}{' '}
                          marcados ·
                        </strong>
                      )}
                      {totalMatchingResults}{' '}
                      {totalMatchingResults === 1 ? 'encontrado' : 'encontrados'}
                    </span>
                  </div>
                </div>

                {/* INDICADOR DE BUSCA (M7) */}
                {isSearching && (
                  <div className="p-3 bg-emerald-50/60 border-b border-emerald-100 flex items-center justify-center gap-2 text-xs text-emerald-800 font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                    <span>Buscando produtos no catálogo...</span>
                  </div>
                )}

                {/* CORPO DA LISTA (ÁREA VAZIA NA ABERTURA SE NÃO HOUVER BUSCA OU ITENS PRÉ-SELECIONADOS) */}
                <div className="divide-y divide-slate-100 overflow-y-auto max-h-[320px]">
                  {/* Se o usuário ainda não digitou busca e não filtrou família */}
                  {searchFilter.trim().length < 2 &&
                  selectedFamily === 'all' &&
                  searchResults.length === 0 ? (
                    <div className="p-6 text-center space-y-3">
                      {activeProducts.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-slate-700">
                            Itens pré-selecionados para impressão ({activeProducts.length}):
                          </p>
                          <div className="text-left divide-y divide-slate-100 border rounded-lg bg-slate-50/50">
                            {activeProducts.map((prod) => {
                              const isSelected = selectedIds.includes(prod.id)
                              const copies =
                                quantities[prod.id] !== undefined ? quantities[prod.id] : 1
                              const isInspecting =
                                (currentPreviewProduct?.id || previewProductId) === prod.id
                              const loc = formatLocation(prod)
                              const isInactive = prod.is_active === false

                              return (
                                <div
                                  key={prod.id}
                                  className={`p-2.5 flex items-center justify-between gap-3 ${
                                    isInspecting ? 'bg-emerald-50' : 'bg-white'
                                  }`}
                                >
                                  <div className="flex items-center shrink-0">
                                    <input
                                      type="checkbox"
                                      aria-label={`Selecionar ${prod.name}`}
                                      checked={isSelected}
                                      onChange={() => handleToggleProduct(prod)}
                                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer h-4 w-4"
                                    />
                                  </div>

                                  <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => setPreviewProductId(prod.id)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                        {prod.sku}
                                      </span>
                                      <span className="font-semibold text-xs text-slate-900 truncate">
                                        {prod.name}
                                      </span>
                                      {isInactive && (
                                        <Badge
                                          variant="outline"
                                          className="text-[10px] bg-rose-50 text-rose-700 border-rose-300 py-0 px-1 font-semibold"
                                        >
                                          Inativo
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                                      {loc ? (
                                        <span className="font-medium text-emerald-800">
                                          📍 {loc}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 italic">
                                          Sem localização
                                        </span>
                                      )}
                                      {prod.sou_family && (
                                        <span className="text-slate-400 truncate">
                                          · {prod.sou_family}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <div className="flex items-center border rounded-md bg-white shadow-xs">
                                      <button
                                        type="button"
                                        onClick={() => setProductCopies(prod.id, copies - 1)}
                                        className="px-2 py-0.5 text-slate-600 hover:bg-slate-100 text-xs font-bold"
                                      >
                                        -
                                      </button>
                                      <input
                                        type="number"
                                        min="1"
                                        max="999"
                                        value={copies}
                                        onChange={(e) =>
                                          setProductCopies(
                                            prod.id,
                                            parseInt(e.target.value, 10) || 1,
                                          )
                                        }
                                        className="w-10 text-center text-xs font-bold text-slate-800 border-x border-slate-200 py-0.5 focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setProductCopies(prod.id, copies + 1)}
                                        className="px-2 py-0.5 text-slate-600 hover:bg-slate-100 text-xs font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                    <span className="text-[11px] text-slate-600 font-medium">
                                      via(s)
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <p className="text-[11px] text-slate-400 pt-2">
                            Digite no campo acima para pesquisar outros produtos por SKU, nome ou
                            localização.
                          </p>
                        </div>
                      ) : (
                        <div className="py-8 space-y-2">
                          <Package className="h-8 w-8 text-slate-300 mx-auto" />
                          <p className="text-xs font-medium text-slate-600">
                            Área de seleção pronta para pesquisa.
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Digite ao menos 2 caracteres (SKU, nome ou localização) ou escolha uma
                            família acima.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : searchResults.length === 0 && !isSearching ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      Nenhum produto encontrado com os filtros atuais.
                    </div>
                  ) : (
                    searchResults.map((prod) => {
                      const isSelected = selectedIds.includes(prod.id)
                      const copies = quantities[prod.id] !== undefined ? quantities[prod.id] : 1
                      const isInspecting =
                        (currentPreviewProduct?.id || previewProductId) === prod.id
                      const loc = formatLocation(prod)
                      const isInactive = prod.is_active === false

                      return (
                        <div
                          key={prod.id}
                          className={`p-3 flex items-center justify-between gap-3 transition-colors ${
                            isInspecting
                              ? 'bg-emerald-50/70'
                              : isSelected
                                ? 'bg-emerald-50/30 hover:bg-emerald-50/50'
                                : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* CHECKBOX INDIVIDUAL DE SELEÇÃO */}
                          <div className="flex items-center shrink-0">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar produto ${prod.name}`}
                              checked={isSelected}
                              onChange={() => handleToggleProduct(prod)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer h-4 w-4"
                            />
                          </div>

                          {/* IDENTIFICAÇÃO DO PRODUTO (CLIQUE COLOCA EM FOCO NO PREVIEW) */}
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => {
                              if (!selectedIds.includes(prod.id)) {
                                handleToggleProduct(prod)
                              } else {
                                setPreviewProductId(prod.id)
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {prod.sku}
                              </span>
                              <span
                                className={`font-semibold text-xs truncate ${
                                  isSelected ? 'text-slate-900 font-bold' : 'text-slate-700'
                                }`}
                                title={prod.name}
                              >
                                {prod.name}
                              </span>
                              {/* BADGE INATIVO (GUARD M8) */}
                              {isInactive && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-rose-50 text-rose-700 border-rose-300 py-0 px-1 font-semibold"
                                >
                                  Inativo
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                              {loc ? (
                                <span className="font-medium text-emerald-800">📍 {loc}</span>
                              ) : (
                                <span className="text-slate-400 italic">Sem localização</span>
                              )}
                              {prod.sou_family && (
                                <span className="text-slate-400 truncate">· {prod.sou_family}</span>
                              )}
                            </div>
                          </div>

                          {/* CONTROLE DE CÓPIAS / VIAS INDIVIDUAL POR PRODUTO (M4) */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div
                              className={`flex items-center border rounded-md bg-white shadow-xs overflow-hidden ${
                                isSelected ? 'border-slate-300' : 'border-slate-200 opacity-60'
                              }`}
                            >
                              <button
                                type="button"
                                disabled={!isSelected}
                                onClick={() => setProductCopies(prod.id, copies - 1)}
                                className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent text-xs font-bold disabled:opacity-40"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                max="999"
                                disabled={!isSelected}
                                value={copies}
                                onChange={(e) =>
                                  setProductCopies(prod.id, parseInt(e.target.value, 10) || 1)
                                }
                                className="w-12 text-center text-xs font-bold text-slate-800 border-x border-slate-200 py-1 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                              />
                              <button
                                type="button"
                                disabled={!isSelected}
                                onClick={() => setProductCopies(prod.id, copies + 1)}
                                className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent text-xs font-bold disabled:opacity-40"
                              >
                                +
                              </button>
                            </div>

                            <span
                              className={`text-[11px] font-medium ${
                                isSelected ? 'text-slate-600' : 'text-slate-400'
                              }`}
                            >
                              via(s)
                            </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* FOOTER COM AÇÕES */}
          <DialogFooter className="p-4 bg-white border-t border-slate-200 flex sm:justify-between items-center gap-3">
            <div className="text-xs text-slate-600">
              Total a imprimir:{' '}
              <strong className="text-slate-900 font-bold">{totalLabelsToPrint} etiquetas</strong> (
              {activeProducts.length} itens distintos)
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button
                type="button"
                disabled={totalLabelsToPrint === 0}
                onClick={handlePrintClick}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow flex items-center gap-2 px-5"
              >
                <Printer className="h-4 w-4" />
                Imprimir {totalLabelsToPrint} {totalLabelsToPrint === 1 ? 'Etiqueta' : 'Etiquetas'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE CONFIRMAÇÃO DE LOTE GRANDE (>50 ETIQUETAS) - GUARD M9 */}
      <Dialog open={showLargeBatchConfirm} onOpenChange={setShowLargeBatchConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Confirmar Impressão de Lote Grande
            </DialogTitle>
            <DialogDescription className="pt-2 text-xs text-slate-600 leading-relaxed">
              Você está prestes a enviar{' '}
              <strong className="text-slate-900 font-bold">
                {totalLabelsToPrint} etiquetas
              </strong> (
              {activeProducts.length} itens distintos) para a impressora térmica.
              <br />
              <br />
              Deseja realmente imprimir esse lote agora?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-3">
            <Button type="button" variant="outline" onClick={() => setShowLargeBatchConfirm(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={executePrint}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              Confirmar e Imprimir {totalLabelsToPrint} Etiquetas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PORTAL DE IMPRESSÃO FÍSICA PARA O CTRL+P (RENDERIZA CADA VIA EM UMA PÁGINA 70x30mm) */}
      {createPortal(
        <div id="thermal-print-portal" style={{ display: isPrinting ? 'block' : 'none' }}>
          {printQueuePages.map((prod, pageIdx) => (
            <div key={`${prod.id}-page-${pageIdx}`} className="product-label-print-page">
              <div
                className="rotate-90"
                style={{
                  transformOrigin: 'center center',
                }}
              >
                <ProductLabel product={prod} mode="print" showBorder={false} />
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export default PrintLabelsModal
