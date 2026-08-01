import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCustomer, createCustomer, updateCustomer } from '@/services/customers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const isEditing = Boolean(id)

  useEffect(() => {
    if (id) {
      getCustomer(id).then((c) => {
        setName(c.name)
        setPhone(c.phone)
        setEmail(c.email || '')
        setCompany(c.company || '')
        setNotes(c.notes || '')
      })
    }
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !phone) {
      toast({ title: 'Preencha nome e telefone', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      if (isEditing && id) {
        await updateCustomer(id, { name, phone, email, company, notes })
      } else {
        await createCustomer({ name, phone, email, company, notes })
      }
      toast({ title: 'Cliente salvo com sucesso!' })
      navigate('/clientes')
    } catch (_) {
      toast({ title: 'Erro ao salvar cliente', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {isEditing ? 'Editar Cliente' : 'Novo Cliente'}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 rounded-xl border border-slate-200 space-y-4"
      >
        <div className="space-y-1.5">
          <Label>Nome Completo *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Ex: Carlos Silva"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Telefone / WhatsApp *</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="(11) 98765-4321"
            />
          </div>

          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="carlos@empresa.com"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Empresa</Label>
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Empresa S.A."
          />
        </div>

        <div className="space-y-1.5">
          <Label>Observações</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Preferências do cliente..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => navigate('/clientes')}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            {loading ? 'Salvando...' : 'Salvar Cliente'}
          </Button>
        </div>
      </form>
    </div>
  )
}
