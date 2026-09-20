import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  X,
  MessageCircle,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Users,
  CheckCircle2,
} from 'lucide-react'
import {
  getCustomers,
  deleteCustomer,
  syncWhatsAppContacts,
  SyncContactsResult,
} from '@/services/customers'
import { Customer } from '@/types/crm'
import { matchCustomerSearch } from '@/lib/fuzzySearch'
import { openWhatsApp } from '@/lib/whatsapp'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { LeadSourceBadge } from '@/components/LeadSourceBadge'

export default function CustomerList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PF' | 'PJ'>('ALL')
  const [entityFilter, setEntityFilter] = useState<'ALL' | 'cliente' | 'fornecedor'>('ALL')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncSummary, setSyncSummary] = useState<SyncContactsResult | null>(null)

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getCustomers()
      setCustomers(data)
    } catch (e: any) {
      console.error('Erro ao carregar clientes:', e)
      setLoadError(e?.message || 'Falha ao comunicar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('customers', () => {
    loadData()
  })

  const filtered = customers.filter((c) => {
    // Filtro por entidade: cliente ou fornecedor
    const isSupplier = c.customer_type === 'fornecedor'
    if (entityFilter === 'cliente' && isSupplier) return false
    if (entityFilter === 'fornecedor' && !isSupplier) return false

    // Filtro por tipo: Se o registro não tiver type explicito, deduz por cnpj ou assume PF
    const cType = c.type || (c.cnpj ? 'PJ' : 'PF')
    if (typeFilter !== 'ALL' && cType !== typeFilter) {
      return false
    }

    const term = search.trim()
    const matchSearch = !term || matchCustomerSearch(c, term)

    return matchSearch
  })

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja excluir o cliente ${name}?`)) return
    try {
      await deleteCustomer(id)
      toast({ title: 'Cliente excluído com sucesso' })
      loadData()
    } catch (err: any) {
      const errorMsg =
        err?.status === 403 || err?.data?.message?.includes('administradores')
          ? 'Apenas administradores têm permissão para excluir clientes.'
          : 'Erro ao excluir'
      toast({ title: errorMsg, variant: 'destructive' })
    }
  }

  const handleSyncContacts = async () => {
    setIsSyncing(true)
    setSyncSummary(null)
    try {
      const res = await syncWhatsAppContacts()
      setSyncSummary(res)
      toast({
        title: 'Sincronização concluída!',
        description: `${res.imported} importados, ${res.updated} atualizados, ${res.ignored} ignorados.`,
      })
      await loadData()
    } catch (err: any) {
      console.error('Erro ao sincronizar contatos:', err)
      const errorMsg =
        err?.data?.error || err?.message || 'Falha ao sincronizar contatos do WhatsApp.'
      toast({
        title: 'Erro na sincronização',
        description: errorMsg,
        variant: 'destructive',
      })
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Base de contatos para envio de propostas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSyncContacts}
            disabled={isSyncing}
            className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-medium"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="mr-1.5 h-4 w-4 animate-spin text-emerald-600" />
                Sincronizando contatos...
              </>
            ) : (
              <>
                <Users className="mr-1.5 h-4 w-4 text-emerald-600" />
                Sincronizar contatos
              </>
            )}
          </Button>
          <Button
            onClick={() => navigate('/clientes/novo')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo Cliente
          </Button>
        </div>
      </div>

      {syncSummary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-950">
                Sincronização do WhatsApp concluída
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                Resumo: <span className="font-bold">{syncSummary.imported} importados</span>,{' '}
                <span className="font-bold">{syncSummary.updated} atualizados</span> e{' '}
                <span className="font-bold">{syncSummary.ignored} ignorados</span>
                {syncSummary.totalFetched
                  ? ` (${syncSummary.totalFetched} contatos lidos da Z-API)`
                  : ''}
                .
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSyncSummary(null)}
            className="text-xs text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 self-end sm:self-auto"
          >
            Fechar resumo
          </Button>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, telefone, e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filtros de Entidade (Cliente/Fornecedor) e Tipo (PF/PJ) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setEntityFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                entityFilter === 'ALL'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setEntityFilter('cliente')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                entityFilter === 'cliente'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Clientes
            </button>
            <button
              type="button"
              onClick={() => setEntityFilter('fornecedor')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                entityFilter === 'fornecedor'
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Fornecedores
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setTypeFilter('ALL')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                typeFilter === 'ALL'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('PF')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                typeFilter === 'PF'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              PF
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('PJ')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                typeFilter === 'PJ'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              PJ
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
          <p>Carregando clientes...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white p-8 rounded-xl border border-red-200 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-700 font-medium">Não foi possível carregar os clientes.</p>
          <p className="text-xs text-slate-500">O servidor pode estar inicializando.</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
          Nenhum cliente encontrado.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b">
                  <th className="p-4">Tipo</th>
                  <th className="p-4">Nome</th>
                  <th className="p-4">Origem</th>
                  <th className="p-4">Documento</th>
                  <th className="p-4">Telefone</th>
                  <th className="p-4">E-mail</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => {
                  const resolvedType = c.type || (c.cnpj ? 'PJ' : 'PF')
                  const isSupplier = c.customer_type === 'fornecedor'
                  const doc = resolvedType === 'PF' ? c.cpf : c.cnpj
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isSupplier ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                              Fornecedor
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700">
                              Cliente
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${
                              resolvedType === 'PJ'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {resolvedType}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 font-bold text-slate-900">
                        <div>{c.name}</div>
                        {c.contact_name && c.contact_name !== c.name && (
                          <div className="text-xs font-normal text-slate-500">
                            Contato: {c.contact_name}
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <LeadSourceBadge source={c.lead_source} />
                      </td>
                      <td className="p-4 text-slate-600 font-mono text-xs">{doc || '-'}</td>
                      <td className="p-4 text-slate-700">{c.phone}</td>
                      <td className="p-4 text-slate-500">{c.email || '-'}</td>
                      <td className="p-4 text-slate-700">{c.company || '-'}</td>
                      <td className="p-4 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/clientes/${c.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openWhatsApp(c.phone, `Olá, ${c.name}!`)}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/clientes/${c.id}/editar`)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(c.id, c.name)}
                            className="text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y">
            {filtered.map((c) => {
              const resolvedType = c.type || (c.cnpj ? 'PJ' : 'PF')
              const isSupplier = c.customer_type === 'fornecedor'
              const doc = resolvedType === 'PF' ? c.cpf : c.cnpj
              return (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isSupplier ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                            Fornecedor
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            Cliente
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            resolvedType === 'PJ'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {resolvedType}
                        </span>
                        <LeadSourceBadge source={c.lead_source} />
                        <p className="font-bold text-slate-900">{c.name}</p>
                      </div>
                      {c.contact_name && c.contact_name !== c.name && (
                        <p className="text-xs text-slate-500">Contato: {c.contact_name}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">{c.phone}</p>
                      {doc && <p className="text-xs text-slate-400 font-mono">{doc}</p>}
                    </div>
                    {c.company && (
                      <span className="text-xs bg-slate-100 px-2 py-0.5 rounded font-semibold">
                        {c.company}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/clientes/${c.id}`)}
                    >
                      Ver
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openWhatsApp(c.phone, `Olá, ${c.name}!`)}
                      className="bg-emerald-500 text-white"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
