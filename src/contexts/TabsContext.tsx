import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'

export interface TabItem {
  id: string // e.g. "dashboard", "funil", "orcamentos:list", "orcamentos:1023", "clientes:novo"
  routeKey: string // chave canônica de unicidade (para sem param = rota base; para entidades = rota:id)
  path: string // URL completa com query strings se houver
  pathname: string
  title: string
  iconName?: string
  entityId?: string
  isForm?: boolean // se é rota /novo ou /editar
  isDirty?: boolean // se há alterações não salvas no formulário
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
  setTabDirty: (dirty: boolean, tabId?: string) => void
  setPendingCloseTabId: (tabId: string | null) => void
  pendingCloseTabId: string | null
  confirmCloseTab: () => void
  cancelCloseTab: () => void
  maxTabsReached: boolean
}

const TabsContext = createContext<TabsContextValue | null>(null)

export const MAX_TABS = 8
const STORAGE_PREFIX = 'crm_tabs_v1_'

/**
 * Normaliza qualquer chave de rota para a forma canônica:
 * - Rotas estáticas: sem barra inicial ('whatsapp', 'pipeline-compras', 'dashboard', etc.)
 * - Chave vazia ou '/' vira 'dashboard'
 * - Rotas de entidade mantêm o prefixo canonicalizado ('orcamentos:123', 'clientes:abc')
 * - Formulários (/novo, /editar): chave sem barra inicial, ex: 'clientes/novo'
 */
export function normalizeCanonicalRouteKey(rawKey: string): string {
  if (!rawKey) return 'dashboard'
  let key = rawKey.trim()

  // Se já for dashboard ou raiz
  if (key === '/' || key === '/dashboard' || key === 'dashboard') {
    return 'dashboard'
  }

  // Se vier com prefixo de barra, remove
  key = key.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!key) return 'dashboard'

  return key
}

export function getRouteKey(pathname: string): {
  routeKey: string
  entityId?: string
  isEntity: boolean
  isForm: boolean
} {
  // Garantir que tiramos query strings se acidentalmente passadas aqui
  const cleanPath = (pathname.split('?')[0] || '').replace(/\/+$/, '') || '/'

  // Rotas com entidade paramétrica: /orcamentos/:id, /clientes/:id, /produtos/:id, /pagamento/:id
  const quoteMatch = cleanPath.match(/^\/?orcamentos\/([a-zA-Z0-9_-]+)$/)
  if (quoteMatch && quoteMatch[1] !== 'novo') {
    return {
      routeKey: `orcamentos:${quoteMatch[1]}`,
      entityId: quoteMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  const customerMatch = cleanPath.match(/^\/?clientes\/([a-zA-Z0-9_-]+)$/)
  if (customerMatch && customerMatch[1] !== 'novo') {
    return {
      routeKey: `clientes:${customerMatch[1]}`,
      entityId: customerMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  const productMatch = cleanPath.match(/^\/?produtos\/([a-zA-Z0-9_-]+)$/)
  if (productMatch && productMatch[1] !== 'novo') {
    return {
      routeKey: `produtos:${productMatch[1]}`,
      entityId: productMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  const paymentMatch = cleanPath.match(/^\/?pagamento\/([a-zA-Z0-9_-]+)$/)
  if (paymentMatch) {
    return {
      routeKey: `pagamento:${paymentMatch[1]}`,
      entityId: paymentMatch[1],
      isEntity: true,
      isForm: false,
    }
  }

  // Rotas de formulário (/novo ou /editar) - chave canônica sem barra inicial
  if (cleanPath.endsWith('/novo') || cleanPath.endsWith('/editar')) {
    const formCanonical = cleanPath.replace(/^\/+/, '')
    return { routeKey: formCanonical, isEntity: false, isForm: true }
  }

  // Demais rotas sem parâmetros ou listas
  if (cleanPath === '/' || cleanPath === '/dashboard' || cleanPath === 'dashboard') {
    return { routeKey: 'dashboard', isEntity: false, isForm: false }
  }

  // Rota estática canônica sem barra inicial (ex: 'whatsapp', 'pipeline-compras', 'orcamentos', etc.)
  const canonicalKey = cleanPath.replace(/^\/+/, '')
  return { routeKey: canonicalKey, isEntity: false, isForm: false }
}

/**
 * Deduplica e sanitiza uma lista de abas (migração defensiva e anti-duplicata):
 * - Converte cada tab para a routeKey canônica
 * - Para abas com a MESMA routeKey, mantém apenas a primeira (ou a ativa se estiver no grupo)
 * - Garante que se houver uma aba ativa no grupo duplicado, a aba mantida herda a ativação
 */
function deduplicateAndSanitizeTabs(
  rawTabs: TabItem[],
  targetActiveTabId?: string,
): {
  cleanedTabs: TabItem[]
  resolvedActiveTabId: string
} {
  const seenRouteKeys = new Map<string, TabItem>()
  let resolvedActiveId = targetActiveTabId || ''

  for (const tab of rawTabs) {
    if (!tab || typeof tab.id !== 'string' || !tab.path) continue

    // Determinar a chave canônica a partir do routeKey existente ou do pathname/path
    const rawPath = tab.pathname || tab.path || ''
    const calculatedKey = getRouteKey(rawPath.split('?')[0]).routeKey
    const canonicalKey = normalizeCanonicalRouteKey(tab.routeKey || calculatedKey)

    const normalizedTab: TabItem = {
      ...tab,
      routeKey: canonicalKey,
      pathname: tab.pathname || tab.path.split('?')[0] || `/${canonicalKey}`,
    }

    if (!seenRouteKeys.has(canonicalKey)) {
      seenRouteKeys.set(canonicalKey, normalizedTab)
    } else {
      // Aba duplicada encontrada!
      const existing = seenRouteKeys.get(canonicalKey)!
      // Se a duplicada era a aba ativa, repassar a ativação para a aba sobrevivente
      if (tab.id === targetActiveTabId) {
        resolvedActiveId = existing.id
      }
    }
  }

  const cleanedTabs = Array.from(seenRouteKeys.values()).slice(0, MAX_TABS)

  if (cleanedTabs.length === 0) {
    const def = getDefaultTab()
    return { cleanedTabs: [def], resolvedActiveTabId: def.id }
  }

  if (!cleanedTabs.some((t) => t.id === resolvedActiveId)) {
    resolvedActiveId = cleanedTabs[0].id
  }

  return { cleanedTabs, resolvedActiveTabId: resolvedActiveId }
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

  // Inicialização segura com migração defensiva e deduplicação automática
  const [tabsState, setTabsState] = useState<{ tabs: TabItem[]; activeTabId: string }>(() => {
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
          const validTabs = parsed.tabs.filter(
            (t) => t && typeof t.id === 'string' && typeof t.path === 'string',
          )
          if (validTabs.length > 0) {
            const { cleanedTabs, resolvedActiveTabId } = deduplicateAndSanitizeTabs(
              validTabs,
              parsed.activeTabId,
            )
            // Se houve deduplicação imediata, regravar storage limpo
            if (cleanedTabs.length !== parsed.tabs.length) {
              try {
                localStorage.setItem(
                  storageKey,
                  JSON.stringify({
                    version: 1,
                    activeTabId: resolvedActiveTabId,
                    tabs: cleanedTabs,
                  }),
                )
              } catch {
                /* ignore */
              }
            }
            return { tabs: cleanedTabs, activeTabId: resolvedActiveTabId }
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao restaurar abas do localStorage, restaurando padrão:', e)
    }
    const def = getDefaultTab()
    return { tabs: [def], activeTabId: def.id }
  })

  const tabs = tabsState.tabs
  const activeTabId = tabsState.activeTabId

  const setActiveTabId = useCallback((id: string) => {
    setTabsState((prev) => (prev.activeTabId === id ? prev : { ...prev, activeTabId: id }))
  }, [])

  const setTabs = useCallback((updater: (prevTabs: TabItem[]) => TabItem[]) => {
    setTabsState((prev) => {
      const nextTabs = updater(prev.tabs)
      // Garantir deduplicação defensiva contínua
      const { cleanedTabs, resolvedActiveTabId } = deduplicateAndSanitizeTabs(
        nextTabs,
        prev.activeTabId,
      )
      return {
        tabs: cleanedTabs,
        activeTabId: resolvedActiveTabId,
      }
    })
  }, [])

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [maxTabsReached, setMaxTabsReached] = useState(false)

  // Referência para evitar loop entre sincronização de abas e URL
  const isNavigatingFromTabsRef = useRef(false)

  // Gravar persistência sempre que tabs ou activeTabId mudarem (já deduplicados)
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

    setTabsState((prevState) => {
      const prevTabs = prevState.tabs
      // 1. Procurar se já existe aba com esta routeKey canônica (ou sua variação com '/')
      const existingIndex = prevTabs.findIndex(
        (t) => normalizeCanonicalRouteKey(t.routeKey) === routeKey,
      )

      if (existingIndex !== -1) {
        // Já existe! Atualiza o path caso tenha query parameters diferentes e foca nela
        const updated = [...prevTabs]
        const existing = updated[existingIndex]
        updated[existingIndex] = {
          ...existing,
          routeKey,
          path: fullPath,
          pathname: location.pathname,
        }
        return {
          tabs: updated,
          activeTabId: existing.id,
        }
      }

      // 2. Não existe ainda. Checar se atingiu o limite de MAX_TABS
      if (prevTabs.length >= MAX_TABS) {
        setMaxTabsReached(true)
        // Não duplica nem abre além do limite; se já tem uma aba ativa, mantemos
        // Mas se a navegação direta ocorreu, substituímos a aba ativa atual se não for formulário ou WhatsApp
        const activeIdx = prevTabs.findIndex((t) => t.id === prevState.activeTabId)
        const activeRouteKey = normalizeCanonicalRouteKey(prevTabs[activeIdx]?.routeKey || '')
        const isActiveWhatsApp = activeRouteKey === 'whatsapp'
        if (activeIdx !== -1 && !isActiveWhatsApp) {
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
          return {
            tabs: updated,
            activeTabId: tabId,
          }
        }
        return prevState
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
      return {
        tabs: [...prevTabs, newTab],
        activeTabId: tabId,
      }
    })
  }, [location.pathname, location.search, getDefaultTitleForPath])

  // Ativar aba existente
  const activateTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId)
      if (!target) return

      setActiveTabId(tabId)
      isNavigatingFromTabsRef.current = true
      navigate(target.path)
    },
    [tabs, navigate, setActiveTabId],
  )

  // Abrir ou focar aba por path
  const openTab = useCallback(
    (path: string, options?: { title?: string; iconName?: string; isForm?: boolean }) => {
      const [pathname] = path.split('?')
      const fullPath = path
      const { routeKey, entityId, isForm: isFormAuto } = getRouteKey(pathname)
      const isForm = options?.isForm ?? isFormAuto

      setTabsState((prevState) => {
        const prevTabs = prevState.tabs
        // 1. Já existe aba com a mesma routeKey canônica (resiliente contra forma legada com '/')?
        const existing = prevTabs.find((t) => normalizeCanonicalRouteKey(t.routeKey) === routeKey)
        if (existing) {
          // Foca a aba existente sem duplicar
          isNavigatingFromTabsRef.current = true
          navigate(existing.path)
          return {
            ...prevState,
            activeTabId: existing.id,
          }
        }

        // 2. Limite de abas
        if (prevTabs.length >= MAX_TABS) {
          setMaxTabsReached(true)
          return prevState
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
        isNavigatingFromTabsRef.current = true
        navigate(fullPath)
        return {
          tabs: [...prevTabs, newTab],
          activeTabId: newTabId,
        }
      })
    },
    [navigate, getDefaultTitleForPath],
  )

  // Marcar aba como dirty (com alterações não salvas)
  const setTabDirty = useCallback(
    (dirty: boolean, tabId?: string) => {
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          const targetId = tabId || activeTabId
          if (t.id === targetId) {
            if (t.isDirty === dirty) return t
            return { ...t, isDirty: dirty }
          }
          return t
        }),
      )
    },
    [activeTabId, setTabs],
  )

  // Fechar aba com suporte a confirmação quando formulário estiver sujo (dirty)
  const closeTab = useCallback(
    (tabId: string, force = false) => {
      const targetTab = tabs.find((t) => t.id === tabId)
      if (!targetTab) return

      // Guard real: pedir confirmação apenas se o formulário estiver com alterações não salvas (isDirty === true)
      if (targetTab.isForm && targetTab.isDirty && !force) {
        setPendingCloseTabId(tabId)
        return
      }

      setTabsState((prevState) => {
        const prevTabs = prevState.tabs
        // Nunca deixar o app sem abas
        if (prevTabs.length <= 1) {
          // Se a única aba for fechada, restaura para o Dashboard
          const def = getDefaultTab()
          isNavigatingFromTabsRef.current = true
          navigate(def.path)
          return {
            tabs: [def],
            activeTabId: def.id,
          }
        }

        const closeIndex = prevTabs.findIndex((t) => t.id === tabId)
        const nextTabs = prevTabs.filter((t) => t.id !== tabId)

        // Se a aba fechada era a ativa, ativar a vizinha
        let nextActiveId = prevState.activeTabId
        if (prevState.activeTabId === tabId) {
          const nextActiveIndex = Math.max(0, closeIndex - 1)
          const nextActive = nextTabs[nextActiveIndex] || nextTabs[0]
          nextActiveId = nextActive.id
          isNavigatingFromTabsRef.current = true
          navigate(nextActive.path)
        }

        return {
          tabs: nextTabs,
          activeTabId: nextActiveId,
        }
      })

      setMaxTabsReached(false)
    },
    [tabs, navigate],
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
  const updateTabTitle = useCallback(
    (tabId: string, title: string) => {
      setTabs((prevTabs) => prevTabs.map((t) => (t.id === tabId ? { ...t, title } : t)))
    },
    [setTabs],
  )

  // Atualizar estado salvo da aba (termo de busca, filtros)
  const updateTabState = useCallback(
    (tabId: string, stateUpdate: Record<string, any>) => {
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
    },
    [setTabs],
  )

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
        setTabDirty,
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
