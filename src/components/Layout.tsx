import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Filter,
  MessageCircle,
  FileText,
  Users,
  Package,
  Settings,
  LogOut,
  Menu,
  X,
  Search,
} from 'lucide-react'
import logoImg from '@/assets/logo-rpa-auto-parts-01-definitivo-correto-1d75c.png'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Pipeline', path: '/pipeline', icon: Filter },
    { label: 'Atendimento', path: '/atendimento', icon: MessageCircle },
    { label: 'Orçamentos', path: '/orcamentos', icon: FileText },
    { label: 'Clientes', path: '/clientes', icon: Users },
    ...(isAdmin ? [{ label: 'Usuários', path: '/usuarios', icon: Users }] : []),
    { label: 'Estoque', path: '/estoque', icon: Package },
    ...(isAdmin ? [{ label: 'Configurações', path: '/configuracoes', icon: Settings }] : []),
  ]

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchTerm.trim()) return
    navigate(`/orcamentos?search=${encodeURIComponent(searchTerm)}`)
  }

  const handleSignOut = () => {
    signOut()
    navigate('/login')
  }

  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/') return 'Dashboard'
    if (path.startsWith('/pipeline')) return 'Pipeline de Vendas'
    if (path.startsWith('/atendimento')) return 'Atendimento WhatsApp'
    if (path.startsWith('/orcamentos/novo')) return 'Novo Orçamento'
    if (path.startsWith('/orcamentos') && path.includes('/editar')) return 'Editar Orçamento'
    if (path.startsWith('/orcamentos/')) return 'Detalhes do Orçamento'
    if (path.startsWith('/orcamentos')) return 'Orçamentos'
    if (path.startsWith('/clientes/novo')) return 'Novo Cliente'
    if (path.startsWith('/clientes') && path.includes('/editar')) return 'Editar Cliente'
    if (path.startsWith('/clientes/')) return 'Detalhes do Cliente'
    if (path.startsWith('/clientes')) return 'Clientes'
    if (path.startsWith('/usuarios')) return 'Usuários'
    if (path.startsWith('/estoque/novo')) return 'Novo Produto'
    if (path.startsWith('/estoque') && path.includes('/editar')) return 'Editar Produto'
    if (path.startsWith('/estoque')) return 'Estoque'
    if (path.startsWith('/configuracoes')) return 'Configurações'
    return 'RPA Auto Parts'
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      <aside className="hidden md:flex w-[200px] flex-col bg-white border-r border-slate-200 fixed inset-y-0 z-30">
        <div className="p-3.5 flex flex-col items-center justify-center border-b border-slate-100 bg-white">
          <Link to="/" className="flex flex-col items-center justify-center w-full group py-1">
            <img
              src="/visual-edits/logo-preto-rpa-dfa45fe5.png"
              alt="RPA Auto Parts"
              className="w-full h-auto max-h-20 object-contain transition-transform group-hover:scale-[1.02]"
            />
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const active =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative',
                  active
                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-emerald-500 rounded-r" />
                )}
                <Icon
                  className={cn('h-4 w-4 shrink-0', active ? 'text-emerald-600' : 'text-slate-400')}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>

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
              <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center">
                <img
                  src={logoImg}
                  alt="RPA Auto Parts"
                  className="h-11 w-auto max-w-[170px] object-contain"
                />
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                      active ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600',
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>

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

      <div className="flex-1 md:pl-[200px] flex flex-col min-w-0">
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

        <main className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
