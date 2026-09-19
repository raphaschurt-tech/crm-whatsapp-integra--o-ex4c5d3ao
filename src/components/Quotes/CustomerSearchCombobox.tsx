import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, ChevronsUpDown, Check, User as UserIcon } from 'lucide-react'
import { Customer } from '@/types/crm'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CustomerSearchComboboxProps {
  customers: Customer[]
  value: string
  onChange: (customerId: string) => void
  disabled?: boolean
  placeholder?: string
}

export function CustomerSearchCombobox({
  customers,
  value,
  onChange,
  disabled = false,
  placeholder = 'Buscar cliente por nome, telefone ou e-mail...',
}: CustomerSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedCustomer = useMemo(() => customers.find((c) => c.id === value), [customers, value])

  // Quando o menu fecha e tem cliente selecionado, mantemos searchTerm vazio para o input poder atuar como busca ou mostrar selecionado
  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return customers.slice(0, 50)

    return customers
      .filter((c) => {
        const name = (c.name || '').toLowerCase()
        const contact = (c.contact_name || '').toLowerCase()
        const phone = (c.phone || '').toLowerCase()
        const email = (c.email || '').toLowerCase()
        const company = (c.company || '').toLowerCase()
        const cpf = (c.cpf || '').toLowerCase()
        const cnpj = (c.cnpj || '').toLowerCase()

        return (
          name.includes(term) ||
          contact.includes(term) ||
          phone.includes(term) ||
          email.includes(term) ||
          company.includes(term) ||
          cpf.includes(term) ||
          cnpj.includes(term)
        )
      })
      .slice(0, 50)
  }, [customers, searchTerm])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (customer: Customer) => {
    onChange(customer.id)
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
          'relative flex items-center w-full rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />

        <Input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={
            selectedCustomer ? `${selectedCustomer.name} - ${selectedCustomer.phone}` : placeholder
          }
          value={
            isOpen
              ? searchTerm
              : selectedCustomer
                ? `${selectedCustomer.name}${selectedCustomer.company ? ` (${selectedCustomer.company})` : ''} - ${selectedCustomer.phone}`
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
          {filteredCustomers.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              Nenhum cliente encontrado com &quot;{searchTerm}&quot;
            </div>
          ) : (
            <div className="py-1 divide-y divide-slate-100">
              {filteredCustomers.map((c) => {
                const isSelected = c.id === value
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors cursor-pointer',
                      isSelected && 'bg-emerald-50 text-emerald-900',
                    )}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={cn(
                          'p-1.5 rounded-full mt-0.5 shrink-0',
                          isSelected
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        <UserIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-slate-900 truncate">
                            {c.name}
                          </span>
                          {c.company && (
                            <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded truncate">
                              {c.company}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap mt-0.5">
                          <span>{c.phone}</span>
                          {c.email && (
                            <>
                              <span>•</span>
                              <span className="truncate">{c.email}</span>
                            </>
                          )}
                          {(c.cpf || c.cnpj) && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{c.cpf || c.cnpj}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
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
