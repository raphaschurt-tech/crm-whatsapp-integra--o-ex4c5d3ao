import { useState, useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Filter,
  ShoppingBag,
  MessageCircle,
  FileText,
  Users,
  Package,
  Layers,
  Factory,
  Settings,
  LogOut,
  Menu,
  X,
  Search,
  DollarSign,
  Plus,
  Minus,
  ChevronRight,
  TrendingUp,
  Inbox,
  ShieldAlert,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react'
import logoImg from '@/assets/logo-rpa-auto-parts-01-definitivo-correto-1d75c.png'
import { useAuth } from '@/hooks/use-auth'
import { useTabs } from '@/contexts/TabsContext'
import { TabsBar } from '@/components/TabsBar'
import Atendimento from '@/pages/WhatsApp/Atendimento'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface NavChildItem {
  id: string
  label: string
  path: string
  icon?: React.ComponentType<{ className?: string }>
}

interface NavGroupItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  path?: string // Se o item for direto sem filhos (ex: Dashboard)
  adminOnly?: boolean
  children?: NavChildItem[]
}

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth()
  const { tabs, openTab } = useTabs()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Estado dos grupos expandidos no menu lateral em árvore
  // Padrão: TODOS os grupos fechados ao iniciar a sessão (sessionStorage; fechou o navegador -> volta tudo fechado)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem('crm_sidebar_expanded_groups')
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    return {}
  })

  const toggleGroup = (groupId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] }
      try {
        sessionStorage.setItem('crm_sidebar_expanded_groups', JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const hasWhatsAppTab = tabs.some((t) => t.routeKey === 'whatsapp' || t.routeKey === '/whatsapp')
  const isAtendimentoRoute =
    location.pathname.startsWith('/whatsapp') || location.pathname.startsWith('/atendimento')

  // Estrutura reagrupada oficial inspirada no ERP SOU.IS
  // Todos os itens foram auditados: existem páginas e rotas dedicadas no sistema
  const navStructure: NavGroupItem[] = useMemo(() => {
    return [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        path: '/dashboard',
      },
      {
        id: 'atendimento',
        label: 'Atendimento',
        icon: MessageCircle,
        children: [
          { id: 'whatsapp', label: 'Conversas', path: '/whatsapp', icon: MessageCircle },
          { id: 'clientes', label: 'Contatos', path: '/clientes', icon: Users },
        ],
      },
      {
        id: 'vendas',
        label: 'Vendas',
        icon: TrendingUp,
        children: [
          { id: 'orcamentos', label: 'Orçamentos', path: '/orcamentos', icon: FileText },
          { id: 'funil', label: 'Funil de Vendas', path: '/funil', icon: Filter },
        ],
      },
      {
        id: 'estoque',
        label: 'Estoque & Produção',
        icon: Package,
        children: [
          { id: 'produtos', label: 'Produtos', path: '/produtos', icon: Package },
          { id: 'familias', label: 'Famílias', path: '/familias', icon: Layers },
          {
            id: 'ordens-producao',
            label: 'Ordens de Produção',
            path: '/ordens-producao',
            icon: Factory,
          },
        ],
      },
      {
        id: 'compras',
        label: 'Compras',
        icon: ShoppingBag,
        children: [
          {
            id: 'pipeline-compras',
            label: 'Pipeline de Compras',
            path: '/pipeline-compras',
            icon: ShoppingBag,
          },
        ],
      },
      ...(isAdmin
        ? [
            {
              id: 'financeiro',
              label: 'Financeiro',
              icon: DollarSign,
              adminOnly: true,
              children: [
                {
                  id: 'financeiro-pagar',
                  label: 'A Pagar',
                  path: '/financeiro/pagar',
                  icon: ArrowDownCircle,
                },
                {
                  id: 'financeiro-receber',
                  label: 'A Receber',
                  path: '/financeiro/receber',
                  icon: ArrowUpCircle,
                },
              ],
            },
            {
              id: 'nfe',
              label: 'NF-e',
              icon: FileText,
              adminOnly: true,
              children: [
                {
                  id: 'nfe-fila-revisao',
                  label: 'Fila de Revisão',
                  path: '/nfe/fila-revisao',
                  icon: ShieldAlert,
                },
                { id: 'nfe-notas', label: 'Notas Processadas', path: '/nfe/notas', icon: Inbox },
              ],
            },
            {
              id: 'configuracoes',
              label: 'Configurações',
              icon: Settings,
              adminOnly: true,
              children: [
                {
                  id: 'config-integracoes',
                  label: 'Integrações',
                  path: '/configuracoes',
                  icon: Settings,
                },
                { id: 'config-usuarios', label: 'Usuários', path: '/usuarios', icon: Users },
              ],
            },
          ]
        : []),
    ]
  }, [isAdmin])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchTerm.trim()) return
    openTab(`/orcamentos?search=${encodeURIComponent(searchTerm)}`, { title: 'Orçamentos' })
  }

  const handleSignOut = () => {
    signOut()
    navigate('/login')
  }

  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/' || path === '/dashboard') return 'Dashboard'
    if (path.startsWith('/pipeline-compras')) return 'Pipeline de Compras'
    if (path.startsWith('/funil')) return 'Funil de Vendas'
    if (path.startsWith('/atendimento') || path.startsWith('/whatsapp'))
      return 'Atendimento WhatsApp'
    if (path.startsWith('/orcamentos/novo')) return 'Novo Orçamento'
    if (path.startsWith('/orcamentos') && path.includes('/editar')) return 'Editar Orçamento'
    if (path.startsWith('/orcamentos/')) return 'Detalhes do Orçamento'
    if (path.startsWith('/orcamentos')) return 'Orçamentos'
    if (path.startsWith('/pedidos')) return 'Pedidos de Venda'
    if (path.startsWith('/clientes/novo')) return 'Novo Contato'
    if (path.startsWith('/clientes') && path.includes('/editar')) return 'Editar Contato'
    if (path.startsWith('/clientes/')) return 'Detalhes do Contato'
    if (path.startsWith('/clientes')) return 'Contatos'
    if (path.startsWith('/usuarios')) return 'Usuários'
    if (path.startsWith('/produtos/novo')) return 'Novo Produto'
    if (path.startsWith('/produtos') && path.includes('/editar')) return 'Editar Produto'
    if (path.startsWith('/produtos/')) return 'Detalhes do Produto'
    if (path.startsWith('/produtos')) return 'Produtos'
    if (path.startsWith('/familias')) return 'Famílias'
    if (path.startsWith('/ordens-producao')) return 'Ordens de Produção'
    if (path.startsWith('/financeiro/pagar')) return 'Contas a Pagar'
    if (path.startsWith('/financeiro/receber')) return 'Contas a Receber'
    if (path.startsWith('/financeiro')) return 'Financeiro'
    if (path.startsWith('/nfe/fila-revisao')) return 'NF-e — Fila de Revisão'
    if (path.startsWith('/nfe/notas')) return 'NF-e — Notas Processadas'
    if (path.startsWith('/nfe')) return 'NF-e'
    if (path.startsWith('/configuracoes')) return 'Integrações'
    return 'RPA Auto Parts'
  }

  const renderNavContent = (isMobile = false) => {
    return (
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navStructure.map((group) => {
          const hasChildren = Boolean(group.children && group.children.length > 0)
          const isExpanded = hasChildren ? !!expandedGroups[group.id] : false

          // Se for item direto (sem filhos, ex: Dashboard)
          if (!hasChildren && group.path) {
            const Icon = group.icon
            const active =
              location.pathname === group.path ||
              (group.path === '/dashboard' && location.pathname === '/')
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  if (isMobile) setMobileOpen(false)
                  openTab(group.path!, {
                    title: group.label,
                    iconName: group.id,
                  })
                }}
                className={cn(
                  'w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative whitespace-nowrap',
                  active
                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                )}
                title={group.label}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-emerald-500 rounded-r" />
                )}
                <Icon
                  className={cn('h-4 w-4 shrink-0', active ? 'text-emerald-600' : 'text-slate-500')}
                />
                <span className="whitespace-nowrap select-none">{group.label}</span>
              </button>
            )
          }

          // Se for grupo de navegação em árvore
          const GroupIcon = group.icon
          const isChildActive = (group.children || []).some(
            (c) => location.pathname === c.path || location.pathname.startsWith(`${c.path}/`),
          )

          return (
            <div key={group.id} className="space-y-0.5 pt-1">
              {/* Cabeçalho do Grupo: Botão de Expansão com "+" / "-" */}
              <button
                type="button"
                onClick={(e) => toggleGroup(group.id, e)}
                className={cn(
                  'w-full text-left flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors select-none group',
                  isChildActive
                    ? 'text-emerald-800 bg-emerald-50/50'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
                )}
                title={group.label}
              >
                <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
                  <GroupIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isChildActive ? 'text-emerald-600' : 'text-slate-500',
                    )}
                  />
                  <span className="whitespace-nowrap">{group.label}</span>
                </div>
                {/* Botão '+' APENAS em grupos que têm filhos */}
                {hasChildren && (
                  <span
                    className={cn(
                      'h-4 w-4 rounded flex items-center justify-center shrink-0 text-slate-500 transition-colors',
                      isExpanded
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-slate-100 group-hover:bg-slate-200 text-slate-600',
                    )}
                    aria-label={isExpanded ? 'Recolher grupo' : 'Expandir grupo'}
                  >
                    {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  </span>
                )}
              </button>

              {/* Filhos do Grupo (Árvore) */}
              {hasChildren && isExpanded && (
                <div className="pl-4 pr-1 space-y-0.5 border-l-2 border-slate-100 ml-3.5 mt-0.5 mb-1.5">
                  {group.children!.map((child) => {
                    const ChildIcon = child.icon || ChevronRight
                    const active =
                      location.pathname === child.path ||
                      location.pathname.startsWith(`${child.path}/`)

                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => {
                          if (isMobile) setMobileOpen(false)
                          openTab(child.path, {
                            title: child.label,
                            iconName: child.id,
                          })
                        }}
                        className={cn(
                          'w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors relative whitespace-nowrap',
                          active
                            ? 'bg-emerald-100/70 text-emerald-800 font-bold shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        )}
                        title={child.label}
                      >
                        {active && (
                          <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-emerald-600 rounded-r" />
                        )}
                        <ChildIcon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            active ? 'text-emerald-700' : 'text-slate-400',
                          )}
                        />
                        <span className="whitespace-nowrap">{child.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      <aside className="hidden md:flex w-[230px] flex-col bg-white border-r border-slate-200 fixed inset-y-0 z-30">
        <div className="p-3.5 flex flex-col items-center justify-center border-b border-slate-100 bg-white">
          <button
            type="button"
            onClick={() => openTab('/dashboard', { title: 'Dashboard', iconName: 'dashboard' })}
            className="flex flex-col items-center justify-center w-full group py-1 cursor-pointer"
          >
            <img
              src="/visual-edits/logo-preto-rpa-dfa45fe5.png"
              alt="RPA Auto Parts"
              className="w-full h-auto max-h-20 object-contain transition-transform group-hover:scale-[1.02]"
            />
          </button>
        </div>

        {renderNavContent(false)}

        <div className="p-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
              <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                {user?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="truncate min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {user?.name || user?.email}
                </p>
                <span className="inline-block px-1.5 py-0.5 text-[9px] uppercase font-bold text-emerald-700 bg-emerald-100 rounded">
                  {user?.role || 'Colaborador'}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              className="h-8 w-8 text-slate-400 hover:text-red-600 shrink-0"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-4/5 max-w-xs bg-white h-full flex flex-col z-10 shadow-2xl">
            <div className="p-4 flex items-center justify-between border-b bg-white">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false)
                  openTab('/dashboard', { title: 'Dashboard', iconName: 'dashboard' })
                }}
                className="flex items-center"
              >
                <img
                  src={logoImg}
                  alt="RPA Auto Parts"
                  className="h-11 w-auto max-w-[170px] object-contain"
                />
              </button>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {renderNavContent(true)}

            <div className="p-4 border-t flex items-center justify-between">
              <div className="text-xs">
                <p className="font-bold text-slate-800">{user?.name || user?.email}</p>
                <p className="text-slate-500">{user?.role}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut} className="text-red-600">
                Sair
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 md:pl-[230px] flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-slate-600"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h2 className="text-lg font-bold text-slate-800 truncate">{getPageTitle()}</h2>
          </div>

          <div className="flex items-center gap-3">
            <form onSubmit={handleSearchSubmit} className="hidden sm:flex relative w-48 lg:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                type="search"
                placeholder="Buscar orçamentos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs bg-slate-50 border-slate-200"
              />
            </form>

            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>WhatsApp Ativo</span>
            </div>
          </div>
        </header>

        {/* Barra de Abas Fixa no Topo (Desktop) */}
        <div className="sticky top-[57px] z-10 bg-slate-100 border-b border-slate-200 shadow-2xs">
          <TabsBar />
        </div>

        <main className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto relative">
          {/* Keep-Alive para WhatsApp Atendimento enquanto a aba existir */}
          {hasWhatsAppTab && (
            <div className={cn('w-full h-full', isAtendimentoRoute ? 'block' : 'hidden')}>
              <Atendimento />
            </div>
          )}

          {/* Demais rotas renderizam normalmente via Outlet */}
          <div className={cn('w-full h-full', isAtendimentoRoute ? 'hidden' : 'block')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
