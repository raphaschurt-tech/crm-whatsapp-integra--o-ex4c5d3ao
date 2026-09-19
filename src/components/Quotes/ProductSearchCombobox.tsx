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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto animate-in fade-in-50 zoom-in-95">
          {filteredProducts.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              Nenhum produto encontrado com &quot;{searchTerm}&quot;
            </div>
          ) : (
            <div className="py-1 divide-y divide-slate-100">
              {filteredProducts.map((p) => {
                const isSelected = p.id === value
                const isOutOfStock = !p.stock_quantity || p.stock_quantity <= 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelect(p)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors cursor-pointer',
                      isSelected && 'bg-emerald-50 text-emerald-900',
                    )}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={cn(
                          'p-1.5 rounded-full mt-0.5 shrink-0',
                          isSelected
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        <Package className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-slate-900 truncate">
                            {p.name}
                          </span>
                          <span className="text-xs font-bold text-slate-900 shrink-0">
                            {isOutOfStock ? (
                              <span className="text-amber-700 font-medium">Sob consulta</span>
                            ) : (
                              formatCurrency(p.price)
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap mt-0.5">
                          <span className="font-mono text-slate-600 bg-slate-100 px-1 py-0.5 rounded text-[10px]">
                            SKU: {p.sku}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            Est: <strong>{p.stock_quantity || 0} un.</strong>
                            {isOutOfStock && (
                              <Badge
                                variant="outline"
                                className="text-[9px] py-0 px-1 bg-rose-50 text-rose-700 border-rose-200"
                              >
                                Sem estoque
                              </Badge>
                            )}
                          </span>
                          {p.description && (
                            <>
                              <span>•</span>
                              <span className="truncate max-w-xs text-slate-400">
                                {p.description}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-emerald-600 shrink-0 ml-1" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
