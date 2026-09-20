import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, ChevronsUpDown, Check, Truck, Sparkles } from 'lucide-react'
import { Customer } from '@/types/crm'
import { matchCustomerSearch } from '@/lib/fuzzySearch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SupplierSearchComboboxProps {
  suppliers: Customer[]
  value?: string
  onChange: (supplierId: string) => void
  suggestedSupplierIds?: string[]
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function SupplierSearchCombobox({
  suppliers,
  value,
  onChange,
  suggestedSupplierIds = [],
  disabled = false,
  placeholder = 'Buscar fornecedor...',
  className,
}: SupplierSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedSupplier = useMemo(() => suppliers.find((s) => s.id === value), [suppliers, value])

  const suggestedSet = useMemo(() => new Set(suggestedSupplierIds), [suggestedSupplierIds])

  // Ordena sugeridos primeiro, depois os demais
  const sortedSuppliers = useMemo(() => {
    return [...suppliers].sort((a, b) => {
      const aSuggested = suggestedSet.has(a.id)
      const bSuggested = suggestedSet.has(b.id)
      if (aSuggested && !bSuggested) return -1
      if (!aSuggested && bSuggested) return 1
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [suppliers, suggestedSet])

  // Filtra usando o utilitário matchCustomerSearch (fuzzy / multi-termo tolerante)
  const filteredSuppliers = useMemo(() => {
    const term = searchTerm.trim()
    if (!term) return sortedSuppliers.slice(0, 50)

    return sortedSuppliers.filter((s) => matchCustomerSearch(s, term)).slice(0, 50)
  }, [sortedSuppliers, searchTerm])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (supplierId: string) => {
    onChange(supplierId)
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

  const displayText = selectedSupplier
    ? `${selectedSupplier.name}${selectedSupplier.company ? ` (${selectedSupplier.company})` : ''}`
    : ''

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'relative flex items-center w-full rounded-md border border-slate-200 bg-white transition-colors focus-within:ring-2 focus-within:ring-amber-500 focus-within:border-amber-500',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />

        <Input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={selectedSupplier ? displayText : placeholder}
          value={isOpen ? searchTerm : displayText}
          onFocus={() => {
            setIsOpen(true)
            setSearchTerm('')
          }}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className="pl-8 pr-14 h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 text-xs font-normal text-slate-800 placeholder:text-slate-400"
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {(value || searchTerm) && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="h-6 w-6 text-slate-400 hover:text-slate-700"
              title="Limpar fornecedor"
            >
              <X className="h-3 w-3" />
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
            className="h-6 w-6 text-slate-400 hover:text-slate-700"
          >
            <ChevronsUpDown className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in-50 zoom-in-95">
          <div className="py-1 divide-y divide-slate-100">
            {/* Opção para desvincular */}
            <button
              type="button"
              onClick={() => handleSelect('')}
              className={cn(
                'w-full px-3 py-1.5 text-left flex items-center justify-between text-xs text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer italic',
                !value && 'bg-amber-50/60 font-semibold text-amber-900',
              )}
            >
              <span>Nenhum fornecedor</span>
              {!value && <Check className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
            </button>

            {filteredSuppliers.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                Nenhum fornecedor encontrado com &quot;{searchTerm}&quot;
              </div>
            ) : (
              filteredSuppliers.map((s) => {
                const isSelected = s.id === value
                const isSuggested = suggestedSet.has(s.id)

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelect(s.id)}
                    className={cn(
                      'w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors cursor-pointer',
                      isSelected && 'bg-amber-50 text-amber-950 font-medium',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={cn(
                          'p-1 rounded-full shrink-0',
                          isSelected
                            ? 'bg-amber-100 text-amber-700'
                            : isSuggested
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {isSuggested ? (
                          <Sparkles className="h-3 w-3" />
                        ) : (
                          <Truck className="h-3 w-3" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-slate-900 truncate">
                            {s.name}
                          </span>
                          {s.company && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded truncate">
                              {s.company}
                            </span>
                          )}
                          {isSuggested && (
                            <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                              Sugerido da família
                            </span>
                          )}
                        </div>
                        {s.phone && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{s.phone}</div>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
