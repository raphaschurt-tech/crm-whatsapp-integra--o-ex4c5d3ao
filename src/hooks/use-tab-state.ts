import { useTabs, TabItem } from '@/contexts/TabsContext'
import { useCallback } from 'react'

/**
 * Hook para páginas registrarem e restaurarem termo de busca e filtros de sua aba ativa.
 */
export function useTabState<T extends Record<string, any>>(initialDefault?: Partial<T>) {
  const { activeTab, updateTabState, updateTabTitle } = useTabs()

  const tabState = (activeTab?.state || {}) as Partial<T>

  const setTabState = useCallback(
    (newState: Partial<T>) => {
      if (!activeTab) return
      updateTabState(activeTab.id, newState)
    },
    [activeTab, updateTabState],
  )

  const setTitle = useCallback(
    (title: string) => {
      if (!activeTab) return
      updateTabTitle(activeTab.id, title)
    },
    [activeTab, updateTabTitle],
  )

  return {
    activeTab,
    tabState: { ...initialDefault, ...tabState } as T,
    setTabState,
    setTitle,
  }
}
