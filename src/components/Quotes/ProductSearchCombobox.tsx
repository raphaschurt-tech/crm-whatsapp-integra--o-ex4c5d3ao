import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, ChevronsUpDown, Check, Package, AlertCircle } from 'lucide-react'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ProductSearchComboboxProps {
  products: Product[]
  value: string
  onChange: (productId: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ProductSearchCombobox({
  products,
  value,
  onChange,
  disabled = false,
  placeholder = 'Buscar por nome, descrição ou código/SKU...',
}: ProductSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const selectedProduct = useMemo(() => products.find((p) => p.id === value), [products, value])

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return products.slice(0, 50)

    return products
      .filter((p) => {
        const name = (p.name || '').toLowerCase()
        const sku = (p.sku || '').toLowerCase()
        const desc = (p.description || '').toLowerCase()
        const supp = (p.supplier || '').toLowerCase()

        return (
          name.includes(term) || sku.includes(term) || desc.includes(term) || supp.includes(term)
        )
      })
      .slice(0, 50)
  }, [products, searchTerm])

  // Atualiza posição e largura do painel suspenso para cobrir toda a largura da linha de itens
  useEffect(() => {
    if (!isOpen) return

    function updateDropdownPosition() {
      if (!containerRef.current) return

      // Busca o contêiner de linha do item (.p-4.border.rounded-xl ou similar) para ancorar largura
      const rowContainer =
        containerRef.current.closest<HTMLElement>('.border.rounded-xl') ||
        containerRef.current.closest<HTMLElement>('.grid') ||
        containerRef.current.parentElement

      const inputRect = containerRef.current.getBoundingClientRect()
      const rowRect = rowContainer ? rowContainer.getBoundingClientRect() : inputRect
      const viewportWidth = window.innerWidth
      const paddingMargin = 12

      // O dropdown alinha com o lado esquerdo do input e se estende até o lado direito da linha do item
      const left = inputRect.left
      // Largura da posição do input até a borda direita da linha do item
      let width = Math.max(inputRect.width, rowRect.right - inputRect.left)

      // Garante largura mínima generosa (ex: 550px ou 600px se houver espaço no viewport)
      const minDesiredWidth = Math.min(680, viewportWidth - 2 * paddingMargin)
      if (width < minDesiredWidth) {
        width = minDesiredWidth
      }

      // Evita estourar para fora da tela na direita
      let adjustedLeft = left
      if (adjustedLeft + width > viewportWidth - paddingMargin) {
        const overflow = adjustedLeft + width - (viewportWidth - paddingMargin)
        // Move para a esquerda se couber, mas sem passar da margem esquerda
        adjustedLeft = Math.max(paddingMargin, adjustedLeft - overflow)
        // Se ainda assim ultrapassar o viewport total
        if (adjustedLeft + width > viewportWidth - paddingMargin) {
          width = viewportWidth - adjustedLeft - paddingMargin
        }
      }

      const top = inputRect.bottom + 6

      setDropdownStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${adjustedLeft}px`,
        width: `${width}px`,
        maxWidth: `calc(100vw - 24px)`,
      })
    }

    updateDropdownPosition()
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)

    return () => {
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (product: Product) => {
    onChange(product.id)
    setSearchTerm('')
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSearchTerm('')
    setIsOpen(true)
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={cn(
          'relative flex items-center w-full rounded-md border border-input bg-white transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />

        <Input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={
            selectedProduct ? `${selectedProduct.name} (SKU: ${selectedProduct.sku})` : placeholder
          }
          value={
            isOpen
              ? searchTerm
              : selectedProduct
                ? `${selectedProduct.name} - SKU: ${selectedProduct.sku}`
                : searchTerm
          }
          onFocus={() => {
            setIsOpen(true)
            setSearchTerm('')
          }}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className="pl-9 pr-16 h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm font-normal text-slate-800 placeholder:text-slate-400"
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {(value || searchTerm) && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="h-7 w-7 text-slate-400 hover:text-slate-700"
              title="Limpar seleção"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => {
              setIsOpen((prev) => !prev)
              if (!isOpen) inputRef.current?.focus()
            }}
            className="h-7 w-7 text-slate-400 hover:text-slate-700"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="z-50 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-96 overflow-y-auto animate-in fade-in-50 zoom-in-95"
        >
          {filteredProducts.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500 space-y-1">
              <Package className="h-8 w-8 mx-auto text-slate-300 stroke-1" />
              <p className="font-medium">Nenhum produto encontrado</p>
              <p className="text-xs text-slate-400">
                Não localizamos produtos correspondentes a &quot;{searchTerm}&quot;
              </p>
            </div>
          ) : (
            <div>
              <div className="px-3.5 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>
                  Resultados ({filteredProducts.length}
                  {products.length > filteredProducts.length ? ` de ${products.length}` : ''})
                </span>
                <span className="text-[10px] text-slate-400">Selecione com um clique</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const isSelected = p.id === value
                  const isOutOfStock = !p.stock_quantity || p.stock_quantity <= 0
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p)}
                      className={cn(
                        'w-full px-4 py-3 text-left flex items-start justify-between gap-3 hover:bg-emerald-50/40 transition-colors cursor-pointer group',
                        isSelected && 'bg-emerald-50/80 text-emerald-950',
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={cn(
                            'p-2 rounded-lg mt-0.5 shrink-0 transition-colors',
                            isSelected
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-600 group-hover:bg-emerald-100/60 group-hover:text-emerald-700',
                          )}
                        >
                          <Package className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          {/* Linha 1: Nome do produto e Preço / Sob Consulta */}
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-semibold text-sm text-slate-900 leading-snug break-words">
                              {p.name}
                            </span>
                            <div className="text-right shrink-0">
                              {isOutOfStock ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200/80">
                                  Sob consulta
                                </span>
                              ) : (
                                <span className="text-sm font-bold text-slate-900">
                                  {formatCurrency(p.price)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Linha 2: Badges e metadados (SKU, Estoque, Fornecedor) */}
                          <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap pt-0.5">
                            <span className="font-mono text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[11px] font-medium">
                              SKU: {p.sku}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="flex items-center gap-1 text-[11px]">
                              Estoque:
                              <strong
                                className={cn(
                                  isOutOfStock ? 'text-rose-600 font-semibold' : 'text-slate-900',
                                )}
                              >
                                {p.stock_quantity || 0} un.
                              </strong>
                              {isOutOfStock ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] py-0 px-1.5 bg-rose-50 text-rose-700 border-rose-200 font-medium"
                                >
                                  Sem estoque
                                </Badge>
                              ) : p.min_stock && p.stock_quantity <= p.min_stock ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-200 font-medium"
                                >
                                  Estoque baixo
                                </Badge>
                              ) : null}
                            </span>

                            {p.supplier && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="text-[11px] text-slate-500">
                                  Fornecedor:{' '}
                                  <strong className="text-slate-700 font-medium">
                                    {p.supplier}
                                  </strong>
                                </span>
                              </>
                            )}
                          </div>

                          {/* Linha 3: Descrição completa e legível sem truncar */}
                          {p.description && (
                            <p className="text-xs text-slate-600 leading-relaxed pt-0.5 whitespace-normal break-words">
                              {p.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="shrink-0 ml-2 mt-1">
                          <div className="h-5 w-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
