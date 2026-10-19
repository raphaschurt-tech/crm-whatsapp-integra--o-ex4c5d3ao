import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Wallet,
  FileCheck2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getFinancialDashboardKpis,
  getAccountsPayable,
  isOverdue,
  getBrasiliaMonthKey,
} from '@/services/financial'
import { AccountsPayable, FinancialDashboardKpis } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

interface FinancialDashboardProps {
  onNavigateTab: (tabKey: string) => void
}

export function FinancialDashboard({ onNavigateTab }: FinancialDashboardProps) {
  const { toast } = useToast()
  const [currentMonth, setCurrentMonth] = useState<string>(() => getBrasiliaMonthKey())
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<FinancialDashboardKpis>({
    pendingPayablesAmount: 0,
    overduePayablesAmount: 0,
    overduePayablesCount: 0,
    dueNext7DaysAmount: 0,
    dueNext7DaysCount: 0,
    pendingReceivablesAmount: 0,
    monthInflows: 0,
    monthOutflows: 0,
    monthBalance: 0,
  })
  const [overdueList, setOverdueList] = useState<AccountsPayable[]>([])

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [kpiData, allPayables] = await Promise.all([
        getFinancialDashboardKpis(currentMonth),
        getAccountsPayable({ status: 'pendente' }),
      ])
      setKpis(kpiData)

      // Filtrar os vencidos para o destaque rápido na tela inicial
      const overdues = allPayables
        .filter((p) => isOverdue(p.due_date, p.status))
        .sort((a, b) => (a.due_date > b.due_date ? 1 : -1))
      setOverdueList(overdues)
    } catch (err: any) {
      console.error('Erro ao carregar resumo financeiro:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar indicadores financeiros.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [currentMonth, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handlePrevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1)
    const prevY = prevDate.getFullYear()
    const prevM = String(prevDate.getMonth() + 1).padStart(2, '0')
    setCurrentMonth(`${prevY}-${prevM}`)
  }

  const handleNextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const nextDate = new Date(y, m, 1)
    const nextY = nextDate.getFullYear()
    const nextM = String(nextDate.getMonth() + 1).padStart(2, '0')
    setCurrentMonth(`${nextY}-${nextM}`)
  }

  const formatMonthTitle = (monthStr: string) => {
    const [y, m] = monthStr.split('-').map(Number)
    const date = new Date(y, m - 1, 15)
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="space-y-6">
      {/* Barra de Controle de Mês e Atualização */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-emerald-600" />
            Visão Geral Financeira
          </h2>
          <p className="text-xs text-slate-500">
            Fuso horário oficial: Brasília (UTC-3) • Indicadores consolidados do período
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrevMonth}
              className="h-8 w-8 text-slate-600 hover:text-slate-900"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm font-semibold text-slate-800 capitalize min-w-[140px] text-center">
              {formatMonthTitle(currentMonth)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextMonth}
              className="h-8 w-8 text-slate-600 hover:text-slate-900"
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Grid de Cards de KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: A Pagar Pendente (Mês) */}
        <Card className="border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              A Pagar (Mês)
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <TrendingDown className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(kpis.pendingPayablesAmount)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Lançamentos pendentes do mês</p>
          </CardContent>
        </Card>

        {/* Card 2: VENCIDOS (Destaque Vermelho) */}
        <Card
          onClick={() => onNavigateTab('pagar')}
          className={`cursor-pointer transition-all ${
            kpis.overduePayablesCount > 0
              ? 'border-red-400 bg-red-50/40 shadow-sm hover:shadow-md'
              : 'border-slate-200'
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-red-600 animate-pulse" />
              Vencidos (Total)
            </CardTitle>
            <Badge variant="destructive" className="font-bold text-xs px-2 py-0.5">
              {kpis.overduePayablesCount} conta{kpis.overduePayablesCount !== 1 ? 's' : ''}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-red-700">
              {formatCurrency(kpis.overduePayablesAmount)}
            </div>
            <p className="text-xs text-red-600 font-medium mt-1">
              {kpis.overduePayablesCount > 0
                ? 'Exigem liquidação prioritária'
                : 'Nenhuma conta vencida!'}
            </p>
          </CardContent>
        </Card>

        {/* Card 3: A Vencer nos Próximos 7 Dias */}
        <Card className="border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              A Vencer (7 Dias)
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(kpis.dueNext7DaysAmount)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {kpis.dueNext7DaysCount} conta{kpis.dueNext7DaysCount !== 1 ? 's' : ''} vencendo em
              breve
            </p>
          </CardContent>
        </Card>

        {/* Card 4: A Receber Pendente */}
        <Card className="border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              A Receber (Mês)
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(kpis.pendingReceivablesAmount)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Previsão a receber no mês</p>
          </CardContent>
        </Card>
      </div>

      {/* Linha de Balanço e Movimentação Realizada do Mês */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Entradas Realizadas */}
        <Card className="border-emerald-200 bg-emerald-50/20 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700 uppercase">
                  Entradas do Mês (Pagas)
                </p>
                <h3 className="text-2xl font-bold text-emerald-800 mt-1">
                  {formatCurrency(kpis.monthInflows)}
                </h3>
                <p className="text-xs text-emerald-600 mt-1">Recebimentos liquidados</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                <ArrowUpRight className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Saídas Realizadas */}
        <Card className="border-slate-200 bg-slate-50/40 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase">
                  Saídas do Mês (Pagas)
                </p>
                <h3 className="text-2xl font-bold text-slate-800 mt-1">
                  {formatCurrency(kpis.monthOutflows)}
                </h3>
                <p className="text-xs text-slate-500 mt-1">Pagamentos liquidados</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                <ArrowDownRight className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Saldo Líquido do Mês */}
        <Card
          className={`border shadow-sm ${
            kpis.monthBalance >= 0
              ? 'border-emerald-300 bg-emerald-50/40'
              : 'border-red-300 bg-red-50/40'
          }`}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p
                  className={`text-xs font-semibold uppercase ${
                    kpis.monthBalance >= 0 ? 'text-emerald-800' : 'text-red-800'
                  }`}
                >
                  Saldo Realizado (Entradas − Saídas)
                </p>
                <h3
                  className={`text-2xl font-black mt-1 ${
                    kpis.monthBalance >= 0 ? 'text-emerald-800' : 'text-red-700'
                  }`}
                >
                  {formatCurrency(kpis.monthBalance)}
                </h3>
                <p
                  className={`text-xs mt-1 ${
                    kpis.monthBalance >= 0 ? 'text-emerald-600' : 'text-red-600 font-medium'
                  }`}
                >
                  {kpis.monthBalance >= 0 ? 'Superávit no período' : 'Déficit no período'}
                </p>
              </div>
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  kpis.monthBalance >= 0
                    ? 'bg-emerald-200 text-emerald-800'
                    : 'bg-red-200 text-red-800'
                }`}
              >
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerta e Tabela de Vencidos (se houver) */}
      {overdueList.length > 0 && (
        <Card className="border-red-300 shadow-sm">
          <CardHeader className="bg-red-50/60 border-b border-red-200 py-3 px-4 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <CardTitle className="text-sm font-bold text-red-900">
                Atenção: {overdueList.length} conta{overdueList.length !== 1 ? 's' : ''} a pagar
                vencida{overdueList.length !== 1 ? 's' : ''}
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab('pagar')}
              className="h-8 text-xs border-red-300 text-red-700 hover:bg-red-100"
            >
              Ir para Contas a Pagar
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Vencimento</th>
                    <th className="py-2.5 px-4">Descrição</th>
                    <th className="py-2.5 px-4">Fornecedor</th>
                    <th className="py-2.5 px-4">Origem</th>
                    <th className="py-2.5 px-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overdueList.slice(0, 5).map((item) => (
                    <tr key={item.id} className="hover:bg-red-50/20">
                      <td className="py-2.5 px-4 font-bold text-red-600">
                        {item.due_date ? new Date(item.due_date).toLocaleDateString('pt-BR') : '-'}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{item.description}</td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {item.supplier_name || item.expand?.supplier?.name || '-'}
                      </td>
                      <td className="py-2.5 px-4">
                        {item.origin === 'nfe' ? (
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 text-blue-700 text-[10px]"
                          >
                            NF-e
                          </Badge>
                        ) : item.origin === 'recorrente' ? (
                          <Badge
                            variant="secondary"
                            className="bg-purple-100 text-purple-700 text-[10px]"
                          >
                            Recorrente
                          </Badge>
                        ) : (
                          <span className="text-slate-500">Manual</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-black text-red-700">
                        {formatCurrency(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {overdueList.length > 5 && (
              <div className="p-2.5 text-center bg-slate-50 border-t text-xs text-slate-500">
                Mostrando 5 de {overdueList.length} contas vencidas. Acesse a aba Contas a Pagar
                para ver todas.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Atalhos Rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Button
          variant="outline"
          onClick={() => onNavigateTab('pagar')}
          className="h-14 flex flex-col items-center justify-center border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-800 text-xs">Contas a Pagar</span>
          <span className="text-[10px] text-slate-500">Lançamentos e Baixas</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigateTab('receber')}
          className="h-14 flex flex-col items-center justify-center border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-800 text-xs">Contas a Receber</span>
          <span className="text-[10px] text-slate-500">Entradas e Cobranças</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigateTab('recorrentes')}
          className="h-14 flex flex-col items-center justify-center border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-800 text-xs">Despesas Recorrentes</span>
          <span className="text-[10px] text-slate-500">Modelos & Cron Diário</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigateTab('nfe')}
          className="h-14 flex flex-col items-center justify-center border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-800 text-xs">NF-e Processadas</span>
          <span className="text-[10px] text-slate-500">XMLs e Fila de Preços</span>
        </Button>
      </div>
    </div>
  )
}
