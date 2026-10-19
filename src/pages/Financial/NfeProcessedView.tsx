import { useState, useEffect, useCallback } from 'react'
import {
  FileText,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Search,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { getNfeProcessedList, getNfePriceQueueList } from '@/services/financial'
import { NfeProcessed, NfePriceQueueItem } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'

export function NfeProcessedView() {
  const { toast } = useToast()
  const [nfeList, setNfeList] = useState<NfeProcessed[]>([])
  const [priceQueue, setPriceQueue] = useState<NfePriceQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSubTab, setActiveSubTab] = useState<'nfe' | 'fila'>('nfe')

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [nfeData, queueData] = await Promise.all([
        getNfeProcessedList(),
        getNfePriceQueueList(),
      ])
      setNfeList(nfeData)
      setPriceQueue(queueData)
    } catch (err: any) {
      console.error('Erro ao carregar NF-e processadas:', err)
      toast({
        title: 'Erro ao carregar dados',
        description: err?.message || 'Falha ao buscar notas do pipeline.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredNfe = nfeList.filter((n) => {
    if (!searchTerm.trim()) return true
    const s = searchTerm.toLowerCase()
    return (
      n.access_key?.toLowerCase().includes(s) ||
      n.supplier_name?.toLowerCase().includes(s) ||
      n.supplier_cnpj?.toLowerCase().includes(s) ||
      n.nfe_number?.toLowerCase().includes(s)
    )
  })

  const filteredQueue = priceQueue.filter((q) => {
    if (!searchTerm.trim()) return true
    const s = searchTerm.toLowerCase()
    return (
      q.description?.toLowerCase().includes(s) ||
      q.sku?.toLowerCase().includes(s) ||
      q.access_key?.toLowerCase().includes(s) ||
      q.supplier_code?.toLowerCase().includes(s)
    )
  })

  return (
    <div className="space-y-6">
      {/* Banner Informativo sobre a integração com o pipeline NF-e */}
      <div className="flex items-start gap-3 bg-blue-50/60 p-4 rounded-xl border border-blue-200">
        <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-900 leading-relaxed">
          <p className="font-bold">Integração com o Pipeline Fiscal e Estoque</p>
          <p className="text-blue-700 mt-0.5">
            O módulo Financeiro apenas <strong>consome</strong> os lançamentos gerados pelo pipeline
            de XMLs. Ao processar uma NF-e, as parcelas financeiras entram automaticamente em Contas
            a Pagar com badge de proteção e chave de acesso vinculada. Reenvio do mesmo XML nunca
            duplica.
          </p>
        </div>
      </div>

      {/* Navegação entre NF-e Processadas e Fila de Preços */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('nfe')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeSubTab === 'nfe'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Notas Processadas ({nfeList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('fila')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'fila'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>Fila de Preços e Exceções</span>
            {priceQueue.filter((q) => q.status === 'pendente').length > 0 && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {priceQueue.filter((q) => q.status === 'pendente').length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por chave, fornecedor, item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={loadData}
            disabled={loading}
            className="h-9 w-9 shrink-0"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Visualização de Notas Processadas */}
      {activeSubTab === 'nfe' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-4">Emissão</th>
                    <th className="py-3 px-4">Número / Chave de Acesso</th>
                    <th className="py-3 px-4">Fornecedor</th>
                    <th className="py-3 px-4 text-center">Itens Casados / Pendentes</th>
                    <th className="py-3 px-4 text-right">Valor Total</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Carregando notas fiscais...
                      </td>
                    </tr>
                  ) : filteredNfe.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-slate-500">
                          <FileText className="h-8 w-8 text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-700">
                            Nenhuma NF-e processada ainda
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Assim que os XMLs de compra forem enviados ao pipeline, as notas
                            processadas e suas duplicatas a pagar aparecerão listadas aqui
                            automaticamente.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredNfe.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                          {item.issue_date
                            ? new Date(item.issue_date).toLocaleDateString('pt-BR')
                            : new Date(item.created).toLocaleDateString('pt-BR')}
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {item.nfe_number ? `NF-e #${item.nfe_number}` : 'Nota Fiscal'}
                            {item.series ? ` (Série ${item.series})` : ''}
                          </div>
                          <div
                            className="text-[10px] font-mono text-slate-400 truncate max-w-[280px]"
                            title={item.access_key}
                          >
                            {item.access_key}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">
                            {item.supplier_name || item.expand?.supplier?.name || '-'}
                          </div>
                          {item.supplier_cnpj && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              CNPJ: {item.supplier_cnpj}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1 text-xs">
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                              {item.matched_items_count || 0} casados
                            </span>
                            {(item.pending_items_count || 0) > 0 && (
                              <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded">
                                {item.pending_items_count} pendentes
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-black text-slate-900 whitespace-nowrap">
                          {formatCurrency(item.total_amount || 0)}
                        </td>

                        <td className="py-3 px-4 text-center">
                          {item.status === 'processada' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              Processada
                            </Badge>
                          ) : item.status === 'pendente_reconciliacao' ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              Reconciliação
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-600 text-[10px]">
                              {item.status}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Visualização da Fila de Preços e Exceções */}
      {activeSubTab === 'fila' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-4">Data</th>
                    <th className="py-3 px-4">Item / Descrição</th>
                    <th className="py-3 px-4">Cód. Fornecedor / SKU</th>
                    <th className="py-3 px-4 text-right">Qtd</th>
                    <th className="py-3 px-4 text-right">Custo Unitário</th>
                    <th className="py-3 px-4 text-right">Preço Sugerido</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Carregando fila de exceções...
                      </td>
                    </tr>
                  ) : filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-slate-500">
                          <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
                          <p className="font-semibold text-slate-700">Fila de preços vazia</p>
                          <p className="text-xs text-slate-400 mt-1">
                            Nenhum item pendente de reconciliação de preço ou cadastro de novo
                            insumo.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredQueue.map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                          {new Date(q.created).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-semibold text-slate-900 truncate">
                            {q.description}
                          </div>
                          {q.ncm && <div className="text-[10px] text-slate-400">NCM: {q.ncm}</div>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {q.sku ? (
                            <span className="font-bold text-emerald-700">{q.sku}</span>
                          ) : (
                            <span className="text-slate-500 font-mono">
                              {q.supplier_code || 'Sem código'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-slate-700">
                          {q.quantity || 0}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">
                          {formatCurrency(q.unit_cost || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-emerald-700">
                          {formatCurrency(q.suggested_sell_price || 0)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {q.status === 'pendente' ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              Pendente
                            </Badge>
                          ) : q.status === 'aplicado' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              Aplicado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500 text-[10px]">
                              Ignorado
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
