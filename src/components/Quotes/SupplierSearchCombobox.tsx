import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, ChevronsUpDown, Check, Truck, Sparkles } from 'lucide-react'
import { Customer } from '@/types/crm'
import { matchCustomerSearch } from '@/lib/fuzzySearch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SupplierSearchComboboxProps {
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
                      isSelected && 'bg-amber-50/80 text-amber-950 font-medium',
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
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {s.phone ? s.phone : 'sem telefone cadastrado'}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-amber-600 shrink-0" />}
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

export interface SupplierMultiSelectComboboxProps {
  suppliers: Customer[]
  values: string[]
  onChange: (supplierIds: string[]) => void
  suggestedSupplierIds?: string[]
  maxSelections?: number
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function SupplierMultiSelectCombobox({
  suppliers,
  values = [],
  onChange,
  suggestedSupplierIds = [],
  maxSelections = 10,
  disabled = false,
  placeholder = 'Selecionar fornecedores (até 10)...',
  className,
}: SupplierMultiSelectComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedSet = useMemo(() => new Set(values), [values])
  const suggestedSet = useMemo(() => new Set(suggestedSupplierIds), [suggestedSupplierIds])

  const selectedSuppliers = useMemo(() => {
    return values
      .map((id) => suppliers.find((s) => s.id === id))
      .filter((s): s is Customer => Boolean(s))
  }, [suppliers, values])

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

  const handleToggle = (supplierId: string) => {
    if (selectedSet.has(supplierId)) {
      onChange(values.filter((id) => id !== supplierId))
    } else {
      if (values.length >= maxSelections) {
        return
      }
      onChange([...values, supplierId])
    }
  }

  const handleRemove = (e: React.MouseEvent, supplierId: string) => {
    e.stopPropagation()
    onChange(values.filter((id) => id !== supplierId))
  }

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
    setSearchTerm('')
  }

  return (
    <div ref={containerRef} className={cn('relative w-full space-y-1.5', className)}>
      {/* Box com chips dos selecionados e input */}
      <div
        onClick={() => {
          if (!disabled) {
            setIsOpen(true)
            inputRef.current?.focus()
          }
        }}
        className={cn(
          'min-h-9 flex flex-wrap items-center gap-1 p-1 rounded-md border border-slate-200 bg-white transition-colors focus-within:ring-2 focus-within:ring-amber-500 focus-within:border-amber-500 cursor-text',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-1.5 pointer-events-none" />

        {/* Chips dos fornecedores selecionados */}
        {selectedSuppliers.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 bg-amber-100/80 text-amber-900 border border-amber-200/90 rounded-md px-1.5 py-0.5 text-[11px] font-semibold max-w-[180px]"
            title={`${s.name}${s.phone ? ` • ${s.phone}` : ''}`}
          >
            <span className="truncate">{s.name}</span>
            {!disabled && (
              <button
                type="button"
                onClick={(e) => handleRemove(e, s.id)}
                className="hover:bg-amber-200/80 rounded p-0.5 text-amber-800 shrink-0 transition-colors"
                aria-label={`Remover ${s.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={
            values.length === 0
              ? placeholder
              : values.length >= maxSelections
                ? `Limite atingido (${maxSelections})`
                : 'Adicionar mais...'
          }
          value={searchTerm}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className="flex-1 min-w-[110px] h-6 px-1.5 bg-transparent border-0 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />

        <div className="flex items-center gap-0.5 ml-auto pr-1 shrink-0">
          {values.length > 0 && !disabled && (
            <button
              type="button"
              onClick={handleClearAll}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              title="Limpar todos os fornecedores deste item"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen((prev) => !prev)
              if (!isOpen) inputRef.current?.focus()
            }}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <ChevronsUpDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Contagem / limite */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
        <span>
          {values.length === 0
            ? 'Nenhum selecionado'
            : `${values.length} de ${maxSelections} fornecedores`}
        </span>
        {values.length >= maxSelections && (
          <span className="text-amber-600 font-medium">Limite de {maxSelections} atingido</span>
        )}
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in-50 zoom-in-95">
          <div className="py-1 divide-y divide-slate-100">
            {filteredSuppliers.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                Nenhum fornecedor encontrado com &quot;{searchTerm}&quot;
              </div>
            ) : (
              filteredSuppliers.map((s) => {
                const isSelected = selectedSet.has(s.id)
                const isSuggested = suggestedSet.has(s.id)
                const isAtLimit = !isSelected && values.length >= maxSelections

                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isAtLimit}
                    onClick={() => handleToggle(s.id)}
                    className={cn(
                      'w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors cursor-pointer',
                      isSelected && 'bg-amber-50/80 text-amber-950 font-medium',
                      isAtLimit && 'opacity-50 cursor-not-allowed hover:bg-transparent',
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
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {s.phone ? s.phone : 'sem telefone cadastrado'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          <Check className="h-3 w-3" /> Selecionado
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">Selecionar</span>
                      )}
                    </div>
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
