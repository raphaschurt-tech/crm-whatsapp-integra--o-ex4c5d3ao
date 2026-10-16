import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Printer,
  X,
  Layers,
  Copy,
  RotateCcw,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  Sliders,
  ChevronDown,
  Info,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Product } from '@/types/crm'
import { ProductLabel, formatLocation } from '@/components/ProductLabel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
   * Lista de produtos selecionados inicialmente
   */
  initialProducts: Product[]
  /**
   * Catálogo completo de produtos (para permitir filtrar por família ou selecionar mais)
   */
  allProducts?: Product[]
}

export const PrintLabelsModal: React.FC<PrintLabelsModalProps> = ({
  open,
  onOpenChange,
  initialProducts,
  allProducts = [],
}) => {
  // Mapa de quantidades por produto (id -> número de vias)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // Lista de IDs dos produtos atualmente selecionados para etiquetar
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Filtro de família
  const [selectedFamily, setSelectedFamily] = useState<string>('all')
  // Busca por texto na lista de itens a imprimir
  const [searchFilter, setSearchFilter] = useState<string>('')
  // Quantidade padrão de vias para aplicar em massa
  const [bulkCopies, setBulkCopies] = useState<number>(1)
  // Índice do produto atualmente em foco na pré-visualização grande
  const [previewIndex, setPreviewIndex] = useState<number>(0)
  // Modo de rotação visual da pré-visualização (vertical / 90° vs horizontal normal)
  const [rotatedPreview, setRotatedPreview] = useState<boolean>(true)
  // Flag para controle do portal de impressão térmica ativo
  const [isPrinting, setIsPrinting] = useState<boolean>(false)

  // Extrai lista única de famílias do catálogo para o filtro
  const availableFamilies = useMemo(() => {
    const set = new Set<string>()
    const source = allProducts.length > 0 ? allProducts : initialProducts
    source.forEach((p) => {
      const fam = (p.sou_family || '').trim()
      if (fam) set.add(fam)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [allProducts, initialProducts])

  // Inicializa quando o modal abre ou initialProducts muda
  useEffect(() => {
    if (open) {
      const ids = initialProducts.map((p) => p.id)
      setSelectedIds(ids)
      const qMap: Record<string, number> = {}
      initialProducts.forEach((p) => {
        qMap[p.id] = 1
      })
      setQuantities(qMap)
      setPreviewIndex(0)
    }
  }, [open, initialProducts])

  // Catálogo unificado com busca rápida por ID
  const productMap = useMemo(() => {
    const map = new Map<string, Product>()
    allProducts.forEach((p) => map.set(p.id, p))
    initialProducts.forEach((p) => map.set(p.id, p))
    return map
  }, [allProducts, initialProducts])

  // Lista dos produtos atualmente ativos para impressão
  const activeProducts = useMemo(() => {
    return selectedIds.map((id) => productMap.get(id)).filter((p): p is Product => Boolean(p))
  }, [selectedIds, productMap])

  // Produtos filtrados na interface de gerenciamento de vias
  const filteredProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      if (selectedFamily !== 'all' && (p.sou_family || '').trim() !== selectedFamily) {
        return false
      }
      if (searchFilter.trim()) {
        const term = searchFilter.toLowerCase().trim()
        const matchName = (p.name || '').toLowerCase().includes(term)
        const matchSku = (p.sku || '').toLowerCase().includes(term)
        const matchLoc = formatLocation(p).toLowerCase().includes(term)
        return matchName || matchSku || matchLoc
      }
      return true
    })
  }, [activeProducts, selectedFamily, searchFilter])

  // Total de etiquetas / páginas que serão impressas (soma de todas as vias)
  const totalLabelsToPrint = useMemo(() => {
    return selectedIds.reduce((sum, id) => {
      const q = quantities[id] || 0
      return sum + (q > 0 ? q : 0)
    }, 0)
  }, [selectedIds, quantities])

  // Atualiza via de um produto específico
  const setProductCopies = (id: string, count: number) => {
    const valid = Math.max(1, Math.min(999, Math.floor(count) || 1))
    setQuantities((prev) => ({ ...prev, [id]: valid }))
  }

  // Remove um produto da fila
  const removeProductFromQueue = (id: string) => {
    setSelectedIds((prev) => prev.filter((i) => i !== id))
  }

  // Aplica quantidade de vias em lote para todos os selecionados
  const handleApplyBulkCopies = () => {
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
      description: `Definido ${val} via(s) para todos os ${selectedIds.length} produtos.`,
    })
  }

  // Adiciona produtos por família completa (se allProducts estiver disponível)
  const handleAddByFamily = (fam: string) => {
    if (!fam || fam === 'all') return
    const matching = allProducts.filter((p) => (p.sou_family || '').trim() === fam)
    if (matching.length === 0) {
      toast({ title: 'Nenhum produto nesta família', variant: 'destructive' })
      return
    }

    setSelectedIds((prev) => {
      const next = new Set(prev)
      matching.forEach((p) => next.add(p.id))
      return Array.from(next)
    })

    setQuantities((prev) => {
      const next = { ...prev }
      matching.forEach((p) => {
        if (!next[p.id]) next[p.id] = 1
      })
      return next
    })

    toast({
      title: `Família "${fam}" adicionada`,
      description: `${matching.length} produto(s) adicionados ao lote de impressão.`,
    })
  }

  // Lista expandida de etiquetas para a impressão física (1 item por página)
  const printQueuePages = useMemo(() => {
    const pages: Product[] = []
    selectedIds.forEach((id) => {
      const p = productMap.get(id)
      if (p) {
        const count = quantities[id] || 1
        for (let i = 0; i < count; i++) {
          pages.push(p)
        }
      }
    })
    return pages
  }, [selectedIds, quantities, productMap])

  // Aciona impressão via Ctrl+P do navegador
  const handleTriggerPrint = () => {
    if (printQueuePages.length === 0) {
      toast({
        title: 'Nenhuma etiqueta para imprimir',
        description: 'Selecione pelo menos um produto com quantidade maior que zero.',
        variant: 'destructive',
      })
      return
    }

    setIsPrinting(true)
    document.body.classList.add('printing-labels')

    // Breve pausa para garantir a renderização no portal antes de abrir a janela do print
    setTimeout(() => {
      window.print()

      // Restaura o layout normal após fechar o diálogo de impressão
      setTimeout(() => {
        document.body.classList.remove('printing-labels')
        setIsPrinting(false)
      }, 500)
    }, 150)
  }

  const currentPreviewProduct = activeProducts[previewIndex] || activeProducts[0]

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
                    Código de barras Code 128 com SKU, código grande, descrição e localização física
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

          {/* CORPO DO MODAL (DUAS COLUNAS: PREVIEW + CONFIGURAÇÃO DO LOTE) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUNA ESQUERDA: PRÉ-VISUALIZAÇÃO EM TAMANHO REAL */}
            <div className="lg:col-span-5 flex flex-col items-center justify-start space-y-4">
              <div className="w-full bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center">
                <div className="w-full flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Pré-Visualização Real
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRotatedPreview(!rotatedPreview)}
                      className="text-xs font-semibold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors"
                      title={
                        rotatedPreview
                          ? 'Ver na horizontal normal'
                          : 'Ver na vertical/90° do modelo real'
                      }
                    >
                      <RotateCcw className="h-3 w-3" />
                      {rotatedPreview ? '90° Vertical' : 'Horizontal'}
                    </button>
                  </div>
                </div>

                {/* ÁREA DA ETIQUETA COM ROTAÇÃO 90° REAL DA FOTO OU HORIZONTAL */}
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
                      Nenhum produto selecionado
                    </div>
                  )}
                </div>

                {/* INFORMAÇÕES DA ETIQUETA ATUAL */}
                {currentPreviewProduct && (
                  <div className="w-full mt-3 pt-3 border-t border-slate-100 text-xs space-y-1">
                    <div className="flex justify-between text-slate-500">
                      <span>Dimensões:</span>
                      <strong className="text-slate-800">70 mm × 30 mm</strong>
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
                        {quantities[currentPreviewProduct.id] || 1} cópia(s)
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
                    <strong>100% (Padrão)</strong>. Cada via é impressa em uma página exata.
                  </p>
                </div>
              </div>
            </div>

            {/* COLUNA DIREITA: GESTÃO DO LOTE, FAMÍLIAS E VIAS */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              {/* BARRA DE FERRAMENTAS: FILTRO POR FAMÍLIA E VIAS EM MASSA */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* FILTRAR OU ADICIONAR POR FAMÍLIA */}
                  {availableFamilies.length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                        Filtrar por Família:
                      </Label>
                      <Select
                        value={selectedFamily}
                        onValueChange={(val) => setSelectedFamily(val)}
                      >
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
                  )}

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

                {/* BOTÃO PARA ADICIONAR FAMÍLIA INTEIRA SE SELECIONADA */}
                {selectedFamily !== 'all' && (
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-600">
                      Deseja adicionar todos os produtos de <strong>{selectedFamily}</strong>?
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      onClick={() => handleAddByFamily(selectedFamily)}
                    >
                      + Incluir família no lote
                    </Button>
                  </div>
                )}
              </div>

              {/* LISTA DE PRODUTOS DO LOTE COM CONTROLE INDIVIDUAL DE CÓPIAS */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden flex-1 min-h-[300px]">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Buscar produto ou SKU na fila..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-7 pl-8 text-xs bg-white"
                    />
                  </div>
                  <span className="text-xs text-slate-500 shrink-0 font-medium">
                    {filteredProducts.length} de {activeProducts.length} produtos
                  </span>
                </div>

                <div className="divide-y divide-slate-100 overflow-y-auto max-h-[320px]">
                  {filteredProducts.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      Nenhum produto encontrado com os filtros atuais.
                    </div>
                  ) : (
                    filteredProducts.map((prod, idx) => {
                      const copies = quantities[prod.id] || 1
                      const isInspecting = currentPreviewProduct?.id === prod.id
                      const loc = formatLocation(prod)

                      return (
                        <div
                          key={prod.id}
                          className={`p-3 flex items-center justify-between gap-3 transition-colors ${
                            isInspecting ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => {
                              const foundIdx = activeProducts.findIndex((p) => p.id === prod.id)
                              if (foundIdx !== -1) setPreviewIndex(foundIdx)
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {prod.sku}
                              </span>
                              <span
                                className="font-semibold text-xs text-slate-800 truncate"
                                title={prod.name}
                              >
                                {prod.name}
                              </span>
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

                          {/* CONTROLE DE CÓPIAS / VIAS */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center border border-slate-200 rounded-md bg-white shadow-sm overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setProductCopies(prod.id, copies - 1)}
                                className="px-2 py-1 text-slate-600 hover:bg-slate-100 text-xs font-bold"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value={copies}
                                onChange={(e) =>
                                  setProductCopies(prod.id, parseInt(e.target.value, 10) || 1)
                                }
                                className="w-12 text-center text-xs font-bold text-slate-800 border-x border-slate-200 py-1 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => setProductCopies(prod.id, copies + 1)}
                                className="px-2 py-1 text-slate-600 hover:bg-slate-100 text-xs font-bold"
                              >
                                +
                              </button>
                            </div>

                            <span className="text-[11px] text-slate-400 font-medium">via(s)</span>

                            <button
                              type="button"
                              onClick={() => removeProductFromQueue(prod.id)}
                              className="text-slate-400 hover:text-red-500 p-1"
                              title="Remover produto da impressão"
                            >
                              <X className="h-4 w-4" />
                            </button>
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
                onClick={handleTriggerPrint}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow flex items-center gap-2 px-5"
              >
                <Printer className="h-4 w-4" />
                Imprimir {totalLabelsToPrint} {totalLabelsToPrint === 1 ? 'Etiqueta' : 'Etiquetas'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PORTAL DE IMPRESSÃO FÍSICA PARA O CTRL+P (RENDERIZA TODAS AS VIAS EM PÁGINAS 70x30mm) */}
      {createPortal(
        <div id="thermal-print-portal" style={{ display: isPrinting ? 'block' : 'none' }}>
          {printQueuePages.map((prod, pageIdx) => (
            <div key={`${prod.id}-page-${pageIdx}`} className="product-label-print-page">
              <ProductLabel product={prod} mode="print" showBorder={false} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export default PrintLabelsModal
