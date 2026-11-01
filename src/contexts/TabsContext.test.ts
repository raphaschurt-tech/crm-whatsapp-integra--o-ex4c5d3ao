import { describe, it, expect, beforeEach } from 'vitest'
import {
  isIgnoredRoute,
  isGhostTab,
  getRouteKey,
  normalizeCanonicalRouteKey,
  getDefaultTab,
  TabItem,
} from './TabsContext'

describe('TabsContext - Correção de aba fantasma', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  describe('isIgnoredRoute', () => {
    it('deve identificar /login e login como rota ignorada', () => {
      expect(isIgnoredRoute('/login')).toBe(true)
      expect(isIgnoredRoute('/login/')).toBe(true)
      expect(isIgnoredRoute('login')).toBe(true)
      expect(isIgnoredRoute('/login?redirect=/dashboard')).toBe(true)
    })

    it('deve identificar /pagamento/:id como rota ignorada', () => {
      expect(isIgnoredRoute('/pagamento/123')).toBe(true)
      expect(isIgnoredRoute('/pagamento/abc_xyz')).toBe(true)
      expect(isIgnoredRoute('/pagamento')).toBe(true)
      expect(isIgnoredRoute('/pagamento/123?status=success')).toBe(true)
    })

    it('NÃO deve ignorar rotas internas protegidas', () => {
      expect(isIgnoredRoute('/dashboard')).toBe(false)
      expect(isIgnoredRoute('/clientes')).toBe(false)
      expect(isIgnoredRoute('/orcamentos')).toBe(false)
      expect(isIgnoredRoute('/orcamentos/novo')).toBe(false)
      expect(isIgnoredRoute('/produtos')).toBe(false)
      expect(isIgnoredRoute('/whatsapp')).toBe(false)
      expect(isIgnoredRoute('/financeiro/pagar')).toBe(false)
    })
  })

  describe('isGhostTab', () => {
    it('deve identificar aba de login como fantasma', () => {
      const loginTab: Partial<TabItem> = {
        id: 'login_123',
        routeKey: 'login',
        path: '/login',
        pathname: '/login',
        title: 'Página',
      }
      expect(isGhostTab(loginTab)).toBe(true)
    })

    it('deve identificar aba de pagamento como fantasma', () => {
      const paymentTab: Partial<TabItem> = {
        id: 'pagamento:123',
        routeKey: 'pagamento:123',
        path: '/pagamento/123',
        pathname: '/pagamento/123',
        title: 'Página',
      }
      expect(isGhostTab(paymentTab)).toBe(true)
    })

    it('deve identificar aba com title Página apontando para /login como fantasma', () => {
      const ghost: Partial<TabItem> = {
        id: 'ghost_tab',
        routeKey: 'login',
        path: '/login',
        pathname: '/login',
        title: 'Página',
      }
      expect(isGhostTab(ghost)).toBe(true)
    })

    it('NÃO deve identificar abas legítimas internas como fantasma', () => {
      const dashboardTab: Partial<TabItem> = {
        id: 'dashboard',
        routeKey: 'dashboard',
        path: '/dashboard',
        pathname: '/dashboard',
        title: 'Dashboard',
      }
      expect(isGhostTab(dashboardTab)).toBe(false)

      const productTab: Partial<TabItem> = {
        id: 'produtos',
        routeKey: 'produtos',
        path: '/produtos',
        pathname: '/produtos',
        title: 'Estoque',
      }
      expect(isGhostTab(productTab)).toBe(false)

      const quoteTab: Partial<TabItem> = {
        id: 'orcamentos:abc',
        routeKey: 'orcamentos:abc',
        path: '/orcamentos/abc',
        pathname: '/orcamentos/abc',
        title: 'ORC-abc',
      }
      expect(isGhostTab(quoteTab)).toBe(false)

      const atendimentoTab: Partial<TabItem> = {
        id: 'whatsapp',
        routeKey: 'whatsapp',
        path: '/whatsapp',
        pathname: '/whatsapp',
        title: 'Atendimento',
      }
      expect(isGhostTab(atendimentoTab)).toBe(false)
    })
  })

  describe('getDefaultTab', () => {
    it('retorna a aba padrão do Dashboard', () => {
      const def = getDefaultTab()
      expect(def.id).toBe('dashboard')
      expect(def.routeKey).toBe('dashboard')
      expect(def.path).toBe('/dashboard')
      expect(def.title).toBe('Dashboard')
    })
  })

  describe('normalizeCanonicalRouteKey', () => {
    it('normaliza chaves de rota', () => {
      expect(normalizeCanonicalRouteKey('')).toBe('dashboard')
      expect(normalizeCanonicalRouteKey('/')).toBe('dashboard')
      expect(normalizeCanonicalRouteKey('/dashboard')).toBe('dashboard')
      expect(normalizeCanonicalRouteKey('dashboard')).toBe('dashboard')
      expect(normalizeCanonicalRouteKey('/whatsapp')).toBe('whatsapp')
      expect(normalizeCanonicalRouteKey('orcamentos:123')).toBe('orcamentos:123')
    })
  })

  describe('getRouteKey', () => {
    it('retorna chave para rotas internas', () => {
      expect(getRouteKey('/dashboard').routeKey).toBe('dashboard')
      expect(getRouteKey('/clientes').routeKey).toBe('clientes')
      expect(getRouteKey('/clientes/123').routeKey).toBe('clientes:123')
      expect(getRouteKey('/orcamentos/novo').routeKey).toBe('orcamentos/novo')
      expect(getRouteKey('/produtos/456/editar').routeKey).toBe('produtos:456:editar')
    })
  })
})
