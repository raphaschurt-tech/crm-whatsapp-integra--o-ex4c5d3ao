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
import { LeadSourceBadge } from '@/components/LeadSourceBadge'

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const c = await getCustomer(id)
      setCustomer(c)
      const qList = await getQuotes()
      setQuotes(qList.filter((q) => q.customer === id))
    } catch (e: any) {
      console.error(e)
      setLoadError(e?.message || 'Falha ao carregar detalhes do cliente.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Carregando cliente...</div>
  }

  if (loadError) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3 bg-white border border-red-200 rounded-xl">
        <p className="text-sm text-slate-700 font-medium">Erro ao carregar cliente.</p>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Button onClick={loadData} variant="outline" size="sm">
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!customer) {
    return <div className="p-8 text-center text-slate-500">Cliente não encontrado.</div>
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/clientes')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{customer.name}</h1>
              {(() => {
                const raw = (customer.customer_type || '').toLowerCase()
                if (raw === 'ambos') {
                  return (
                    <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-none font-bold">
                      Ambos
                    </Badge>
                  )
                }
                if (raw === 'fornecedor') {
                  return (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none font-bold">
                      Fornecedor
                    </Badge>
                  )
                }
                return (
                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-none font-bold">
                    Cliente
                  </Badge>
                )
              })()}
              <Badge
                className={
                  (customer.type || (customer.cnpj ? 'PJ' : 'PF')) === 'PJ'
                    ? 'bg-blue-100 text-blue-800 hover:bg-blue-100 border-none'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none'
                }
              >
                {customer.type || (customer.cnpj ? 'PJ' : 'PF')}
              </Badge>
              {customer.source === 'erp' && (
                <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 border border-purple-200 font-bold">
                  ERP SOU.IS
                </Badge>
              )}
              <LeadSourceBadge source={customer.lead_source} size="md" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(`/clientes/${customer.id}/editar`)}
            className="border-slate-300"
          >
            Editar Cadastro
          </Button>
          <Button
            onClick={() => navigate(`/orcamentos/novo?customerId=${customer.id}`)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Orçamento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold">Perfil do Contato</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-400 uppercase font-semibold">Tipo (Classificação)</p>
              <p className="font-semibold text-slate-800">{customer.customer_type || 'Cliente'}</p>
            </div>
            {customer.expand?.item_families && customer.expand.item_families.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold mb-1">
                  Famílias que Fornece
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {customer.expand.item_families.map((fam) => (
                    <span
                      key={fam.id}
                      className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold"
                    >
                      {fam.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 uppercase font-semibold">Tipo (Documento)</p>
              <p className="font-semibold text-slate-800">
                {(customer.type || (customer.cnpj ? 'PJ' : 'PF')) === 'PJ'
                  ? 'Pessoa Jurídica (PJ)'
                  : 'Pessoa Física (PF)'}
              </p>
            </div>
            {customer.contact_name && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">Pessoa de Contato</p>
                <p className="font-semibold text-slate-800">{customer.contact_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 uppercase font-semibold">Origem do Lead</p>
              <div className="mt-1">
                <LeadSourceBadge source={customer.lead_source} size="sm" />
              </div>
            </div>
            {customer.cpf && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">CPF</p>
                <p className="font-mono text-slate-800 font-semibold">{customer.cpf}</p>
              </div>
            )}
            {customer.cnpj && (
              <div>
                <p className="text-xs text-slate-400 uppercase font-semibold">CNPJ</p>
                <p className="font-mono text-slate-800 font-semibold">{customer.cnpj}</p>
              </div>
            )}
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
