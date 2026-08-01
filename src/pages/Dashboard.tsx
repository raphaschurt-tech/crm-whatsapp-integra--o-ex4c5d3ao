import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FileText,
  CheckCircle2,
  Users,
  AlertTriangle,
  Plus,
  Package,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { getQuotes } from '@/services/quotes'
import { getCustomers } from '@/services/customers'
import { getProducts } from '@/services/products'
import { lookupStock } from '@/services/stock'
import { Quote, Customer, Product } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingSku, setCheckingSku] = useState<string | null>(null)

  const loadData = async () => {
    try {
      const [q, c, p] = await Promise.all([getQuotes(), getCustomers(), getProducts()])
      setQuotes(q)
      setCustomers(c)
      setProducts(p)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('quotes', () => {
    loadData()
  })
  useRealtime('products', () => {
    loadData()
  })
  useRealtime('customers', () => {
    loadData()
  })

  const totalQuotes = quotes.length
  const approvedQuotes = quotes.filter((q) => q.status === 'aprovado' || q.status === 'pago').length
  const totalCustomers = customers.length
  const outOfStockProducts = products.filter((p) => p.stock_quantity <= (p.min_stock || 0))

  const statusData = useMemo(() => {
    const counts = { rascunho: 0, enviado: 0, aprovado: 0, rejeitado: 0, pago: 0 }
    quotes.forEach((q) => {
      if (counts[q.status] !== undefined) counts[q.status]++
    })
    return [
      { name: 'Rascunho', value: counts.rascunho, color: '#9CA3AF' },
      { name: 'Enviado', value: counts.enviado, color: '#3B82F6' },
      { name: 'Aprovado', value: counts.aprovado, color: '#22C55E' },
      { name: 'Rejeitado', value: counts.rejeitado, color: '#EF4444' },
      { name: 'Pago', value: counts.pago, color: '#10B981' },
    ].filter((d) => d.value > 0)
  }, [quotes])

  const handleLookupStock = async (sku: string) => {
    setCheckingSku(sku)
    try {
      const res = await lookupStock(sku)
      toast({
        title: 'Estoque Atualizado',
        description: `SKU ${sku}: quantidade atual é ${res.quantity}`,
      })
      loadData()
    } catch (err) {
      toast({
        title: 'Erro de Consulta',
        description: 'Não foi possível consultar a API externa.',
        variant: 'destructive',
      })
    } finally {
      setCheckingSku(null)
    }
  }

  const getStatusBadge = (status: Quote['status']) => {
    const map = {
      rascunho: { label: 'Rascunho', class: 'bg-slate-100 text-slate-700' },
      enviado: { label: 'Enviado', class: 'bg-blue-100 text-blue-700' },
      aprovado: { label: 'Aprovado', class: 'bg-green-100 text-green-700' },
      rejeitado: { label: 'Rejeitado', class: 'bg-red-100 text-red-700' },
      pago: { label: 'Pago', class: 'bg-emerald-100 text-emerald-800' },
    }
    const item = map[status] || map.rascunho
    return (
      <Badge variant="secondary" className={item.class}>
        {item.label}
      </Badge>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">Carregando informações do sistema...</div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Olá, {user?.name || 'Colaborador'}!</h1>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString('pt-BR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => navigate('/orcamentos/novo')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Orçamento
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/estoque')}
            className="border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <Package className="mr-1.5 h-4 w-4" /> Consultar Estoque
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Orçamentos Totais
            </CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalQuotes}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Orçamentos Aprovados
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{approvedQuotes}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Clientes
            </CardTitle>
            <Users className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalCustomers}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase">
              Estoque Crítico
            </CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${outOfStockProducts.length > 0 ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${outOfStockProducts.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}
            >
              {outOfStockProducts.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-800">Últimos Orçamentos</CardTitle>
            <Link
              to="/orcamentos"
              className="text-xs text-emerald-600 font-semibold hover:underline flex items-center gap-1"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                Nenhum orçamento cadastrado ainda.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {quotes.slice(0, 5).map((q) => (
                  <div
                    key={q.id}
                    onClick={() => navigate(`/orcamentos/${q.id}`)}
                    className="py-3 flex items-center justify-between hover:bg-slate-50 px-2 rounded-lg cursor-pointer transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{q.number}</p>
                      <p className="text-xs text-slate-500">
                        {q.expand?.customer?.name || 'Cliente não identificado'}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {formatCurrency(q.total)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(q.created).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      {getStatusBadge(q.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-800">
              Distribuição por Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">Sem dados de orçamentos.</p>
            ) : (
              <div className="h-[220px] w-full flex flex-col items-center justify-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`${value} orçamentos`, 'Quantidade']} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {statusData.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-1.5 text-xs text-slate-600"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>
                        {item.name}: <strong>{item.value}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold text-slate-800">Estoque Crítico</CardTitle>
          <Link to="/estoque" className="text-xs text-emerald-600 font-semibold hover:underline">
            Gerenciar Estoque
          </Link>
        </CardHeader>
        <CardContent>
          {outOfStockProducts.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              Todos os produtos estão com níveis normais de estoque.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {outOfStockProducts.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  className="p-3 border rounded-xl flex items-center justify-between bg-amber-50/50 border-amber-200"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">SKU: {p.sku}</p>
                    <div className="mt-1 text-xs text-amber-700 font-medium">
                      Estoque: <strong>{p.stock_quantity}</strong> (mínimo: {p.min_stock})
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={checkingSku === p.sku}
                    onClick={() => handleLookupStock(p.sku)}
                    className="bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1 ${checkingSku === p.sku ? 'animate-spin' : ''}`}
                    />
                    Consultar API
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
