import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard,
  ArrowDownCircle,
  ArrowUpCircle,
  Repeat,
  FileSpreadsheet,
  Tags,
  ShieldCheck,
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FinancialDashboard } from './FinancialDashboard'
import { AccountsPayableList } from './AccountsPayableList'
import { AccountsReceivableList } from './AccountsReceivableList'
import { RecurringTemplatesList } from './RecurringTemplatesList'
import { NfeProcessedView } from './NfeProcessedView'
import { FinancialCategoriesView } from './FinancialCategoriesView'
import { useAuth } from '@/hooks/use-auth'

export function FinancialPage() {
  const { isAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') || 'resumo'
  const [currentTab, setCurrentTab] = useState(initialTab)

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam && tabParam !== currentTab) {
      setCurrentTab(tabParam)
    }
  }, [searchParams, currentTab])

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab)
    setSearchParams({ tab })
  }

  // Se por ventura um não-admin chegar aqui
  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800">Acesso Restrito</h2>
        <p className="mt-2 text-slate-600 text-sm">
          O módulo financeiro é exclusivo para a administração.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Cabeçalho do Módulo */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            Módulo Financeiro
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão integrada de contas a pagar, contas a receber, despesas recorrentes, NF-e e plano
            de contas.
          </p>
        </div>
      </div>

      {/* Navegação por Sub-módulos */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="bg-slate-100/90 p-1 border border-slate-200 rounded-xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 h-auto gap-1">
          <TabsTrigger
            value="resumo"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
          >
            <LayoutDashboard className="h-4 w-4" />
            <span>Resumo</span>
          </TabsTrigger>

          <TabsTrigger
            value="pagar"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-xs"
          >
            <ArrowDownCircle className="h-4 w-4 text-red-600" />
            <span>A Pagar</span>
          </TabsTrigger>

          <TabsTrigger
            value="receber"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-xs"
          >
            <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
            <span>A Receber</span>
          </TabsTrigger>

          <TabsTrigger
            value="recorrentes"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-purple-700 data-[state=active]:shadow-xs"
          >
            <Repeat className="h-4 w-4 text-purple-600" />
            <span>Recorrentes</span>
          </TabsTrigger>

          <TabsTrigger
            value="nfe"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-xs"
          >
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            <span>NF-e / Notas</span>
          </TabsTrigger>

          <TabsTrigger
            value="categorias"
            className="flex items-center gap-2 py-2 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
          >
            <Tags className="h-4 w-4 text-slate-600" />
            <span>Categorias</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="outline-hidden m-0">
          <FinancialDashboard onNavigateTab={handleTabChange} />
        </TabsContent>

        <TabsContent value="pagar" className="outline-hidden m-0">
          <AccountsPayableList />
        </TabsContent>

        <TabsContent value="receber" className="outline-hidden m-0">
          <AccountsReceivableList />
        </TabsContent>

        <TabsContent value="recorrentes" className="outline-hidden m-0">
          <RecurringTemplatesList />
        </TabsContent>

        <TabsContent value="nfe" className="outline-hidden m-0">
          <NfeProcessedView />
        </TabsContent>

        <TabsContent value="categorias" className="outline-hidden m-0">
          <FinancialCategoriesView />
        </TabsContent>
      </Tabs>
    </div>
  )
}
export default FinancialPage
