import React, { useEffect, useState, useMemo } from 'react'
import {
  Clock,
  Bot,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  BarChart2,
  Calendar,
  Layers,
  Info,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getAtendimentoMetrics,
  AtendimentoMetricsData,
  formatBrasiliaDateTime,
} from '@/services/atendimentoMetrics'

export default function AtendimentoMetricasPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<AtendimentoMetricsData | null>(null)
  const [lastUpdatedIso, setLastUpdatedIso] = useState<string>('')

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getAtendimentoMetrics(30)
      setMetrics(data)
      setLastUpdatedIso(new Date().toISOString())
    } catch (err: any) {
      console.error('Erro ao carregar métricas de atendimento:', err)
      setError(err?.message || 'Falha ao carregar métricas de atendimento')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Encontrar o pico diário para dimensionar visualmente as barrinhas
  const maxDailyCount = useMemo(() => {
    if (!metrics?.dailyVolume || metrics.dailyVolume.length === 0) return 1
    return Math.max(...metrics.dailyVolume.map((d) => d.count), 1)
  }, [metrics])

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Métricas do Atendimento & IA
            </h1>
            <Badge
              variant="outline"
              className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
            >
              Janela 30 Dias (Brasília UTC-3)
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Indicadores de performance operacional do WhatsApp, automação via IA e ciclo de
            aprendizado de escaladas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-[11px] text-slate-400">Última atualização</p>
            <p className="text-xs font-medium text-slate-700">
              {lastUpdatedIso ? formatBrasiliaDateTime(lastUpdatedIso) : '—'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-9 gap-1.5 text-xs text-slate-700"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 border border-red-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-red-900">Erro ao carregar dados</h4>
            <p className="text-xs text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* 3 CARDS DE KPI NO TOPO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Tempo Médio de 1ª Resposta */}
        <Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Tempo Médio 1ª Resposta
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">
                {metrics?.averageFirstResponseFormatted || '0s'}
              </span>
              <span className="text-xs text-slate-500 font-medium">resposta IA</span>
            </div>
            <p className="text-xs text-slate-600 leading-snug">
              {metrics?.kpiResponseTimeNotes ||
                'Calculando tempo entre chegada e envio da mensagem...'}
            </p>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span>Amostras computadas:</span>
              <span className="font-semibold text-slate-700">
                {metrics?.totalResponsesEvaluated ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: % Resolvida pela IA vs. Escalada */}
        <Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Resolução IA vs. Escalada
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Bot className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-3xl font-extrabold text-emerald-700">
                  {metrics?.aiResolvedPercent ?? 0}%
                </span>
                <span className="text-xs text-slate-500 font-medium ml-1.5">IA autônoma</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-amber-700">
                  {metrics?.humanEscalatedPercent ?? 0}%
                </span>
                <span className="text-xs text-slate-400 block font-normal">humano</span>
              </div>
            </div>

            {/* Barra de Proporção */}
            <div className="w-full bg-amber-100 h-2.5 rounded-full overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, metrics?.aiResolvedPercent ?? 0))}%` }}
                title={`IA: ${metrics?.aiResolvedPercent ?? 0}%`}
              />
            </div>

            <p className="text-xs text-slate-600 leading-snug">
              {metrics?.kpiResolutionNotes || 'Calculando proporção de conversas sob human_mode...'}
            </p>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span>Conversas avaliadas:</span>
              <span className="font-semibold text-slate-700">
                {metrics?.totalConversationsInWindow ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Volume / Dia (Últimos 30 Dias) */}
        <Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Volume / Dia (30 Dias)
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">
                {metrics?.averageConversationsPerDay ?? 0}
              </span>
              <span className="text-xs text-slate-500 font-medium">conversas/dia (média)</span>
            </div>
            <p className="text-xs text-slate-600 leading-snug">
              Total de <strong>{metrics?.totalVolume30Days ?? 0}</strong> interações registradas no
              intervalo de {metrics?.periodStartBrasilia} a {metrics?.periodEndBrasilia}.
            </p>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span>Período da janela:</span>
              <span className="font-semibold text-slate-700">{metrics?.windowDays ?? 30} dias</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SEÇÃO 2: GRÁFICO HISTÓRICO DE VOLUME DIÁRIO (30 DIAS) */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-slate-600" />
                Histórico Diário de Conversas (Horário de Brasília)
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Distribuição das conversas atendidas dia a dia nos últimos 30 dias.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="text-slate-600 border-slate-200 self-start sm:self-auto"
            >
              Total: {metrics?.totalVolume30Days ?? 0} conversas
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {metrics?.dailyVolume && metrics.dailyVolume.length > 0 ? (
            <div>
              {/* Gráfico de barras verticais responsivo */}
              <div className="h-44 flex items-end gap-1.5 sm:gap-2 pb-2 border-b border-slate-200 overflow-x-auto">
                {metrics.dailyVolume.map((item) => {
                  const heightPercent =
                    maxDailyCount > 0 ? Math.round((item.count / maxDailyCount) * 100) : 0
                  return (
                    <div
                      key={item.dateKey}
                      className="flex-1 min-w-[20px] max-w-[42px] flex flex-col items-center gap-1 group relative h-full justify-end"
                    >
                      {/* Tooltip simples no hover */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-slate-900 text-white text-[10px] rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap z-20 shadow-md">
                        {item.dateKey}: <strong>{item.count}</strong> conv.
                      </div>

                      <span className="text-[10px] font-bold text-slate-600 group-hover:text-emerald-700">
                        {item.count > 0 ? item.count : ''}
                      </span>
                      <div
                        className={`w-full rounded-t transition-all duration-300 ${
                          item.count > 0
                            ? 'bg-emerald-500 group-hover:bg-emerald-600'
                            : 'bg-slate-100 min-h-[4px]'
                        }`}
                        style={{
                          height: item.count > 0 ? `${Math.max(12, heightPercent)}%` : '4px',
                        }}
                      />
                      <span className="text-[9px] text-slate-400 group-hover:text-slate-700 group-hover:font-semibold truncate max-w-full">
                        {item.label}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-3">
                <span>Início: {metrics.dailyVolume[0]?.dateKey}</span>
                <span className="text-[11px] text-slate-500 italic">
                  Dias sem movimentação aparecem com barra mínima (zero).
                </span>
                <span>Hoje: {metrics.dailyVolume[metrics.dailyVolume.length - 1]?.dateKey}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-slate-400">
              Nenhum dado diário disponível para o período.
            </div>
          )}
        </CardContent>
      </Card>

      {/* SEÇÃO 3: MOTIVOS DE ESCALADA — CICLO DE APRENDIZADO SEMANAL */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Layers className="h-4 w-4 text-slate-600" />
                Motivos de Escalada Humana (Ciclo de Aprendizado)
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Contagem agregada por{' '}
                <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                  chat_control.paused_reason
                </code>
                . Insumo para alimentar semanalmente novas respostas e catalogar o que a IA não
                fecha sozinha.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-800 border-amber-200 self-start sm:self-auto"
            >
              Total de Controles Humanos: {metrics?.totalEscalationsRecorded ?? 0}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {metrics?.escalationReasons && metrics.escalationReasons.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {metrics.escalationReasons.map((item) => (
                  <div
                    key={item.reason}
                    className="p-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/50 transition-colors flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {item.label}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          reason: {item.reason}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs font-bold shrink-0">
                        {item.count} {item.count === 1 ? 'caso' : 'casos'} ({item.percent}%)
                      </Badge>
                    </div>

                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-3">
                      <div
                        className="bg-amber-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-md bg-blue-50/60 p-3 border border-blue-100 flex items-start gap-2.5 mt-4 text-xs text-blue-900">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="leading-relaxed">
                  <strong>Como usar no Ciclo de Aprendizado:</strong> Motivos como{' '}
                  <code className="text-[11px] bg-blue-100 px-1 rounded">reclamacao</code> ou{' '}
                  <code className="text-[11px] bg-blue-100 px-1 rounded">cobranca</code> exigem
                  intervenção humana obrigatória. Motivos com alta incidência de{' '}
                  <code className="text-[11px] bg-blue-100 px-1 rounded">nota</code> ou{' '}
                  <code className="text-[11px] bg-blue-100 px-1 rounded">interesse_compra</code>{' '}
                  indicam oportunidade de expansão do catálogo ou novas tools.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <UserCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">
                Nenhuma escalada humana com motivo gravada
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Conforme novas mensagens forem transferidas no WhatsApp (via comando /atendente ou
                gatilhos da Camada 3), os motivos preencherão esta seção automaticamente.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
