import React, { useRef, useEffect } from 'react'
import {
  X,
  LayoutDashboard,
  Filter,
  ShoppingBag,
  ShoppingCart,
  MessageCircle,
  FileText,
  Users,
  Package,
  Layers,
  Factory,
  Settings,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
} from 'lucide-react'
import { useTabs, MAX_TABS, TabItem } from '@/contexts/TabsContext'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  LayoutDashboard,
  funil: Filter,
  Filter,
  'pipeline-compras': ShoppingBag,
  ShoppingBag,
  whatsapp: MessageCircle,
  MessageCircle,
  orcamentos: FileText,
  FileText,
  pedidos: ShoppingCart,
  ShoppingCart,
  clientes: Users,
  Users,
  usuarios: Users,
  produtos: Package,
  Package,
  familias: Layers,
  Layers,
  'ordens-producao': Factory,
  Factory,
  configuracoes: Settings,
  Settings,
}

function getTabIcon(tab: TabItem) {
  if (tab.iconName && ICON_MAP[tab.iconName]) {
    return ICON_MAP[tab.iconName]
  }

  const clean = tab.pathname.replace(/^\//, '').split('/')[0] || 'dashboard'
  return ICON_MAP[clean] || FileText
}

export function TabsBar() {
  const {
    tabs,
    activeTabId,
    activateTab,
    closeTab,
    pendingCloseTabId,
    confirmCloseTab,
    cancelCloseTab,
    maxTabsReached,
  } = useTabs()

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const activeTabRef = useRef<HTMLDivElement | null>(null)

  // Scroll automático para manter a aba ativa visível
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [activeTabId])

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' })
    }
  }

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' })
    }
  }

  return (
    <div className="hidden md:flex flex-col bg-slate-100/80 border-b border-slate-200 select-none">
      {/* Alerta discreto de limite atingido */}
      {maxTabsReached && (
        <div className="bg-amber-50 text-amber-900 border-b border-amber-200 px-3 py-1 text-xs flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span>
              Limite de {MAX_TABS} abas simultâneas atingido. Feche alguma aba anterior para abrir
              mais tarefas.
            </span>
          </div>
        </div>
      )}

      {/* Barra de abas com scroll horizontal */}
      <div className="flex items-center justify-between px-2 pt-1.5 pb-0 gap-1 overflow-hidden relative">
        <div
          ref={scrollContainerRef}
          className="flex-1 flex items-end gap-1 overflow-x-auto no-scrollbar scroll-smooth pr-6"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            const Icon = getTabIcon(tab)
            const isWhatsApp = tab.routeKey === 'whatsapp' || tab.routeKey === '/whatsapp'

            return (
              <div
                key={tab.id}
                ref={isActive ? activeTabRef : null}
                onClick={() => activateTab(tab.id)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t border-x cursor-pointer transition-all max-w-[200px] shrink-0 text-xs font-medium relative',
                  isActive
                    ? 'bg-white text-slate-900 border-slate-200 shadow-sm z-10 -mb-[1px] font-semibold border-b-transparent'
                    : 'bg-slate-200/60 text-slate-600 border-slate-300/60 hover:bg-slate-200 hover:text-slate-800',
                )}
                title={tab.title}
              >
                {/* Linha indicadora no topo para aba ativa */}
                {isActive && (
                  <span className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-500 rounded-t" />
                )}

                <div className="flex items-center gap-1.5 truncate">
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600',
                    )}
                  />
                  <span className="truncate">{tab.title}</span>
                </div>

                {/* Ponto indicador de formulário com alterações não salvas (dirty) */}
                {tab.isDirty && (
                  <span
                    className="h-2 w-2 rounded-full bg-amber-500 shrink-0"
                    title="Alterações não salvas"
                  />
                )}

                {/* Badge para atendimento ou WhatsApp */}
                {isWhatsApp && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                    title="Conexão ativa"
                  />
                )}

                {/* Botão Fechar (X) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className={cn(
                    'p-0.5 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors ml-auto shrink-0',
                    isActive ? 'hover:bg-slate-100' : 'hover:bg-slate-300',
                  )}
                  title="Fechar aba"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Controles de scroll se houver muitas abas */}
        {tabs.length > 4 && (
          <div className="flex items-center gap-0.5 shrink-0 mb-1">
            <button
              type="button"
              onClick={scrollLeft}
              className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors"
              title="Rolar para esquerda"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={scrollRight}
              className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors"
              title="Rolar para direita"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Modal de confirmação ao fechar formulários (/novo, /editar) */}
      <Dialog open={Boolean(pendingCloseTabId)} onOpenChange={(open) => !open && cancelCloseTab()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900 text-base">
              <HelpCircle className="h-5 w-5 text-amber-500" />
              Descartar alterações?
            </DialogTitle>
            <DialogDescription className="pt-2 text-xs text-slate-600">
              Você está fechando um formulário em andamento. Qualquer alteração não salva nesta aba
              será perdida.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={cancelCloseTab}>
              Continuar editando
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={confirmCloseTab}>
              Descartar e Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
