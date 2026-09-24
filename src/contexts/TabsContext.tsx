import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'

export interface TabItem {
  id: string // e.g. "dashboard", "funil", "orcamentos:list", "orcamentos:1023", "clientes:novo"
  routeKey: string // chave de unicidade (para sem param = rota base; para entidades = rota:id)
  path: string // URL completa com query strings se houver
  pathname: string
  title: string
  iconName?: string
  entityId?: string
  isForm?: boolean // se é rota /novo ou /editar
  state?: {
    search?: string
    filters?: Record<string, any>
    [key: string]: any
  }
}

interface StoredTabsData {
  version: 1
  activeTabId: string
  tabs: TabItem[]
}

interface TabsContextValue {
  tabs: TabItem[]
  activeTabId: string
  activeTab: TabItem | undefined
  openTab: (path: string, options?: { title?: string; iconName?: string; isForm?: boolean }) => void
  activateTab: (tabId: string) => void
  closeTab: (tabId: string, force?: boolean) => void
  updateTabTitle: (tabId: string, title: string) => void
  updateTabState: (tabId: string, state: Record<string, any>) => void
  setPendingCloseTabId: (tabId: string | null) => void
  pendingCloseTabId: string | null
  confirmCloseTab: () => void
  cancelCloseTab: () => void
  maxTabsReached: boolean
}

const TabsContext = createContext<TabsContextValue | null>(null)

export const MAX_TABS = 8
const STORAGE_PREFIX = 'crm_tabs_v1_'

export function getRouteKey(pathname: string): {
  routeKey: string
  entityId?: string
  isEntity: boolean
  isForm: boolean
} {
  const clean = pathname.replace(/\/+$/, '') || '/'

  // Rotas de formulário
  if (clean.endsWith('/novo') || clean.endsWith('/editar')) {
    return { routeKey: clean, isEntity: false, isForm: true }
  }

  // Rotas com entidade paramétrica: /orcamentos/:id, /clientes/:id, /produtos/:id, /pagamento/:id
  const quoteMatch = clean.match(/^\/orcamentos\/([a-zA-Z0-9_-]+)$/)
  if (quoteMatch) {
    return {
      routeKey: `orcamentos:${quoteMatch[1]}`,
      entityId: quoteMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  const customerMatch = clean.match(/^\/clientes\/([a-zA-Z0-9_-]+)$/)
  if (customerMatch) {
    return {
      routeKey: `clientes:${customerMatch[1]}`,
      entityId: customerMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  const productMatch = clean.match(/^\/produtos\/([a-zA-Z0-9_-]+)$/)
  if (productMatch) {
    return {
      routeKey: `produtos:${productMatch[1]}`,
      entityId: productMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  // Demais rotas sem parâmetros ou listas
  if (clean === '/' || clean === '/dashboard') {
    return { routeKey: 'dashboard', isEntity: false, isForm: false }
  }

  return { routeKey: clean, isEntity: false, isForm: false }
}

export function getDefaultTab(): TabItem {
  return {
    id: 'dashboard',
    routeKey: 'dashboard',
    path: '/dashboard',
    pathname: '/dashboard',
    title: 'Dashboard',
    iconName: 'LayoutDashboard',
    state: {},
  }
}

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const userId = user?.id || 'anonymous'
  const storageKey = `${STORAGE_PREFIX}${userId}`

  // Inicialização segura com degradação graciosa para Dashboard
  const [tabs, setTabs] = useState<TabItem[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as StoredTabsData
        if (
          parsed &&
          parsed.version === 1 &&
          Array.isArray(parsed.tabs) &&
          parsed.tabs.length > 0
        ) {
          // Validação básica dos itens
          const validTabs = parsed.tabs.filter(
            (t) => t && typeof t.id === 'string' && typeof t.path === 'string',
          )
          if (validTabs.length > 0) {
            return validTabs.slice(0, MAX_TABS)
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao restaurar abas do localStorage, restaurando padrão:', e)
    }
    return [getDefaultTab()]
  })

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as StoredTabsData
        if (parsed?.activeTabId && parsed.tabs?.some((t) => t.id === parsed.activeTabId)) {
          return parsed.activeTabId
        }
      }
    } catch {
      /* ignore */
    }
    return 'dashboard'
  })

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [maxTabsReached, setMaxTabsReached] = useState(false)

  // Referência para evitar loop entre sincronização de abas e URL
  const isNavigatingFromTabsRef = useRef(false)

  // Gravar persistência sempre que tabs ou activeTabId mudarem
  useEffect(() => {
    try {
      const data: StoredTabsData = {
        version: 1,
        activeTabId,
        tabs,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      console.warn('Erro ao salvar abas no localStorage:', e)
    }
  }, [tabs, activeTabId, storageKey])

  // Identificação do título padrão a partir do pathname
  const getDefaultTitleForPath = useCallback((pathname: string, entityId?: string) => {
    const clean = pathname.replace(/\/+$/, '') || '/'
    if (clean === '/' || clean === '/dashboard') return 'Dashboard'
    if (clean === '/funil') return 'Pipeline'
    if (clean === '/pipeline-compras') return 'Pipeline de Compras'
    if (clean === '/whatsapp') return 'Atendimento'
    if (clean === '/orcamentos') return 'Orçamentos'
    if (clean === '/orcamentos/novo') return 'Novo Orçamento'
    if (clean.startsWith('/orcamentos/') && clean.endsWith('/editar')) return 'Editar Orçamento'
    if (clean.startsWith('/orcamentos/'))
      return entityId ? `ORC-${entityId.slice(0, 5)}` : 'Orçamento'
    if (clean === '/pedidos') return 'Pedidos'
    if (clean === '/clientes') return 'Clientes'
    if (clean === '/clientes/novo') return 'Novo Cliente'
    if (clean.startsWith('/clientes/') && clean.endsWith('/editar')) return 'Editar Cliente'
    if (clean.startsWith('/clientes/')) return 'Cliente'
    if (clean === '/produtos') return 'Estoque'
    if (clean === '/produtos/novo') return 'Novo Produto'
    if (clean.startsWith('/produtos/') && clean.endsWith('/editar')) return 'Editar Produto'
    if (clean.startsWith('/produtos/')) return 'Produto'
    if (clean === '/familias') return 'Famílias'
    if (clean === '/ordens-producao') return 'Ordens PCP'
    if (clean === '/usuarios') return 'Usuários'
    if (clean === '/configuracoes') return 'Configurações'
    return 'Página'
  }, [])

  // Sincronizar URL ativa com abas quando o usuário navega externamente (botão voltar, deep link, link direto)
  useEffect(() => {
    if (isNavigatingFromTabsRef.current) {
      isNavigatingFromTabsRef.current = false
      return
    }

    const fullPath = location.pathname + location.search
    const { routeKey, entityId, isForm } = getRouteKey(location.pathname)

    setTabs((prevTabs) => {
      // 1. Procurar se já existe aba com esta routeKey
      const existingIndex = prevTabs.findIndex((t) => t.routeKey === routeKey)

      if (existingIndex !== -1) {
        // Já existe! Atualiza o path caso tenha query parameters diferentes e foca nela
        const updated = [...prevTabs]
        const existing = updated[existingIndex]
        updated[existingIndex] = {
          ...existing,
          path: fullPath,
          pathname: location.pathname,
        }
        setActiveTabId(existing.id)
        return updated
      }

      // 2. Não existe ainda. Checar se atingiu o limite de MAX_TABS
      if (prevTabs.length >= MAX_TABS) {
        setMaxTabsReached(true)
        // Não duplica nem abre além do limite; se já tem uma aba ativa, mantemos
        // Mas se a navegação direta ocorreu, substituímos a aba ativa atual se não for formulário ou WhatsApp
        const activeIdx = prevTabs.findIndex((t) => t.id === activeTabId)
        if (activeIdx !== -1 && prevTabs[activeIdx].routeKey !== 'whatsapp') {
          const updated = [...prevTabs]
          const tabId = `${routeKey}_${Date.now()}`
          updated[activeIdx] = {
            id: tabId,
            routeKey,
            path: fullPath,
            pathname: location.pathname,
            title: getDefaultTitleForPath(location.pathname, entityId),
            entityId,
            isForm,
            state: {},
          }
          setActiveTabId(tabId)
          return updated
        }
        return prevTabs
      }

      // 3. Cria nova aba
      setMaxTabsReached(false)
      const tabId = `${routeKey}_${Date.now()}`
      const newTab: TabItem = {
        id: tabId,
        routeKey,
        path: fullPath,
        pathname: location.pathname,
        title: getDefaultTitleForPath(location.pathname, entityId),
        entityId,
        isForm,
        state: {},
      }
      setActiveTabId(tabId)
      return [...prevTabs, newTab]
    })
  }, [location.pathname, location.search, getDefaultTitleForPath, activeTabId])

  // Ativar aba existente
  const activateTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId)
      if (!target) return

      setActiveTabId(tabId)
      isNavigatingFromTabsRef.current = true
      navigate(target.path)
    },
    [tabs, navigate],
  )

  // Abrir ou focar aba por path
  const openTab = useCallback(
    (path: string, options?: { title?: string; iconName?: string; isForm?: boolean }) => {
      const [pathname, search] = path.split('?')
      const fullPath = path
      const { routeKey, entityId, isForm: isFormAuto } = getRouteKey(pathname)
      const isForm = options?.isForm ?? isFormAuto

      setTabs((prevTabs) => {
        // 1. Já existe aba com a mesma routeKey?
        const existing = prevTabs.find((t) => t.routeKey === routeKey)
        if (existing) {
          // Foca a aba existente sem duplicar
          setActiveTabId(existing.id)
          isNavigatingFromTabsRef.current = true
          navigate(existing.path)
          return prevTabs
        }

        // 2. Limite de abas
        if (prevTabs.length >= MAX_TABS) {
          setMaxTabsReached(true)
          return prevTabs
        }

        // 3. Adiciona nova aba
        setMaxTabsReached(false)
        const newTabId = `${routeKey}_${Date.now()}`
        const newTab: TabItem = {
          id: newTabId,
          routeKey,
          path: fullPath,
          pathname,
          title: options?.title || getDefaultTitleForPath(pathname, entityId),
          iconName: options?.iconName,
          entityId,
          isForm,
          state: {},
        }
        setActiveTabId(newTabId)
        isNavigatingFromTabsRef.current = true
        navigate(fullPath)
        return [...prevTabs, newTab]
      })
    },
    [navigate, getDefaultTitleForPath],
  )

  // Fechar aba com suporte a confirmação em formulários
  const closeTab = useCallback(
    (tabId: string, force = false) => {
      const targetTab = tabs.find((t) => t.id === tabId)
      if (!targetTab) return

      // Se for formulário (/novo ou /editar) e não foi forçado, pedir confirmação
      if (targetTab.isForm && !force) {
        setPendingCloseTabId(tabId)
        return
      }

      setTabs((prevTabs) => {
        // Nunca deixar o app sem abas
        if (prevTabs.length <= 1) {
          // Se a única aba for fechada, restaura para o Dashboard
          const def = getDefaultTab()
          setActiveTabId(def.id)
          isNavigatingFromTabsRef.current = true
          navigate(def.path)
          return [def]
        }

        const closeIndex = prevTabs.findIndex((t) => t.id === tabId)
        const nextTabs = prevTabs.filter((t) => t.id !== tabId)

        // Se a aba fechada era a ativa, ativar a vizinha
        if (activeTabId === tabId) {
          // Preferência para a aba anterior ou a seguinte
          const nextActiveIndex = Math.max(0, closeIndex - 1)
          const nextActive = nextTabs[nextActiveIndex] || nextTabs[0]
          setActiveTabId(nextActive.id)
          isNavigatingFromTabsRef.current = true
          navigate(nextActive.path)
        }

        return nextTabs
      })

      setMaxTabsReached(false)
    },
    [tabs, activeTabId, navigate],
  )

  const confirmCloseTab = useCallback(() => {
    if (pendingCloseTabId) {
      const id = pendingCloseTabId
      setPendingCloseTabId(null)
      closeTab(id, true)
    }
  }, [pendingCloseTabId, closeTab])

  const cancelCloseTab = useCallback(() => {
    setPendingCloseTabId(null)
  }, [])

  // Atualizar título da aba dinamicamente (ex: "Estoque — BUCHA", "ORC-1023", "Clientes — João Silva")
  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((prevTabs) => prevTabs.map((t) => (t.id === tabId ? { ...t, title } : t)))
  }, [])

  // Atualizar estado salvo da aba (termo de busca, filtros)
  const updateTabState = useCallback((tabId: string, stateUpdate: Record<string, any>) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id === tabId) {
          return {
            ...t,
            state: {
              ...(t.state || {}),
              ...stateUpdate,
            },
          }
        }
        return t
      }),
    )
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  return (
    <TabsContext.Provider
      value={{
        tabs,
        activeTabId,
        activeTab,
        openTab,
        activateTab,
        closeTab,
        updateTabTitle,
        updateTabState,
        setPendingCloseTabId,
        pendingCloseTabId,
        confirmCloseTab,
        cancelCloseTab,
        maxTabsReached,
      }}
    >
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs() {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('useTabs deve ser utilizado dentro de um TabsProvider')
  }
  return context
}
