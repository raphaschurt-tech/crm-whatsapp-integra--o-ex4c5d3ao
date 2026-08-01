import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MessageCircle, Eye, Edit, Trash2 } from 'lucide-react'
import { getCustomers, deleteCustomer } from '@/services/customers'
import { Customer } from '@/types/crm'
import { openWhatsApp } from '@/lib/whatsapp'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

export default function CustomerList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const data = await getCustomers()
      setCustomers(data)
    } catch (e) {
      console.error(e)
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

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.company || '').toLowerCase().includes(search.toLowerCase()),
  )

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir o cliente ${name}?`)) return
    try {
      await deleteCustomer(id)
      toast({ title: 'Cliente excluído' })
      loadData()
    } catch (_) {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Base de contatos para envio de propostas</p>
        </div>
        <Button
          onClick={() => navigate('/clientes/novo')}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo Cliente
        </Button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, telefone ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Carregando clientes...</div>
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
                  <th className="p-4">Nome</th>
                  <th className="p-4">Telefone</th>
                  <th className="p-4">E-mail</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{c.name}</td>
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
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y">
            {filtered.map((c) => (
              <div key={c.id} className="p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.phone}</p>
                  </div>
                  {c.company && (
                    <span className="text-xs bg-slate-100 px-2 py-0.5 rounded font-semibold">
                      {c.company}
                    </span>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/clientes/${c.id}`)}>
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
