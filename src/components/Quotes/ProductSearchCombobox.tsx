import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, ChevronsUpDown, Check, Package, AlertCircle } from 'lucide-react'
import { Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { matchProductSearch } from '@/lib/fuzzySearch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ProductSearchComboboxProps {
  products: Product[]
  value: string
  onChange: (productId: string) => void
  onSelectProduct?: (product: Product | null) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  inputClassName?: string
  /** Texto legado ou texto atual para exibir caso o valor não bata com nenhum produto por ID */
  displayValue?: string
}

export function ProductSearchCombobox({
  products,
  value,
  onChange,
  onSelectProduct,
  disabled = false,
  placeholder = 'Buscar por nome, descrição ou código/SKU...',
  className,
  inputClassName,
  displayValue,
}: ProductSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Encontra produto por id ou por nome exato (caso value seja o nome da peça)
  const selectedProduct = useMemo(() => {
    if (!value) return undefined
    return (
      products.find((p) => p.id === value) ||
      products.find((p) => p.name.trim().toLowerCase() === value.trim().toLowerCase())
    )
  }, [products, value])

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim()
    if (!term) return products.slice(0, 50)

    return products.filter((p) => matchProductSearch(p, term)).slice(0, 50)
  }, [products, searchTerm])

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
    onSelectProduct?.(product)
    setSearchTerm('')
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    onSelectProduct?.(null)
    setSearchTerm('')
    setIsOpen(true)
    inputRef.current?.focus()
  }

  // Texto formatado de exibição quando o dropdown está fechado
  const resolvedDisplayText = useMemo(() => {
    if (selectedProduct) {
      return `${selectedProduct.name}${selectedProduct.sku ? ` - SKU: ${selectedProduct.sku}` : ''}`
    }
    if (displayValue && displayValue.trim()) {
      return displayValue.trim()
    }
    if (value && value.trim()) {
      return value.trim()
    }
    return ''
  }, [selectedProduct, displayValue, value])

  const hasSelectionOrText = Boolean(value || displayValue || searchTerm)

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'relative flex items-center w-full rounded-md border border-input bg-white transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />

        <Input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={
            selectedProduct
              ? `${selectedProduct.name} (SKU: ${selectedProduct.sku})`
              : displayValue || placeholder
          }
          value={isOpen ? searchTerm : resolvedDisplayText}
          onFocus={() => {
            setIsOpen(true)
            setSearchTerm('')
          }}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className={cn(
            'pl-8 pr-16 h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm font-normal text-slate-800 placeholder:text-slate-400',
            inputClassName,
          )}
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {hasSelectionOrText && !disabled && (
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
          className="absolute left-0 top-full mt-1.5 w-full z-50 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-96 overflow-y-auto animate-in fade-in-50 zoom-in-95"
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
                  const isSelected =
                    p.id === value || p.name.trim().toLowerCase() === value.trim().toLowerCase()
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
                            <span className="font-semibold text-sm text-slate-900 leading-snug whitespace-normal break-words">
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

                          {/* Linha 3: Descrição específica (remover texto genérico SOU.IS) em até 2 linhas */}
                          {p.description &&
                            !p.description
                              .toLowerCase()
                              .includes(
                                'produto sou.is sincronizado via view vw_produto_preco_estoque',
                              ) && (
                              <p className="text-xs text-slate-600 leading-relaxed pt-0.5 whitespace-normal break-words line-clamp-2">
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
