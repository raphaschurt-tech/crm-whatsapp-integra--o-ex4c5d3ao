import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Plus, FileText } from 'lucide-react'
import { getCustomer } from '@/services/customers'
import { getQuotes } from '@/services/quotes'
import { Customer, Quote } from '@/types/crm'
import { formatCurrency, openWhatsApp } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!id) return
      try {
        const c = await getCustomer(id)
        setCustomer(c)
        const qList = await getQuotes()
        setQuotes(qList.filter((q) => q.customer === id))
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando cliente...</div>
  if (!customer)
    return <div className="p-8 text-center text-slate-500">Cliente não encontrado.</div>

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/clientes')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-slate-900">{customer.name}</h1>
        </div>
        <Button
          onClick={() => navigate(`/orcamentos/novo?customerId=${customer.id}`)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo Orçamento para Cliente
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Perfil do Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-400 uppercase font-semibold">Telefone / WhatsApp</p>
              <p className="font-semibold text-slate-800">{customer.phone}</p>
            </div>
            {customer.email && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">E-mail</p>
                <p className="text-slate-800">{customer.email}</p>
              </div>
            )}
            {customer.company && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">Empresa</p>
                <p className="text-slate-800 font-semibold">{customer.company}</p>
              </div>
            )}
            {customer.notes && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">Observações</p>
                <p className="text-slate-600 bg-slate-50 p-2 rounded border text-xs">
                  {customer.notes}
                </p>
              </div>
            )}

            <Button
              onClick={() => openWhatsApp(customer.phone, `Olá, ${customer.name}!`)}
              className="w-full bg-emerald-500 text-white mt-2"
            >
              <MessageCircle className="h-4 w-4 mr-2" /> Abrir no WhatsApp
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Histórico de Orçamentos</CardTitle>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                Nenhum orçamento para este cliente ainda.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {quotes.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => navigate(`/orcamentos/${q.id}`)}
                    className="py-3 flex items-center justify-between hover:bg-slate-50 p-2 rounded cursor-pointer"
                  >
                    <div>
                      <p className="font-bold text-slate-900 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-emerald-600" /> {q.number}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(q.created).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{formatCurrency(q.total)}</p>
                      <Badge variant="outline" className="text-xs uppercase">
                        {q.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
