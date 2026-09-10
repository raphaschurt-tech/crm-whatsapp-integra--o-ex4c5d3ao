import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getCustomer,
  createCustomer,
  updateCustomer,
  checkDuplicateDocument,
  cleanDocument,
} from '@/services/customers'
import { CustomerType, LeadSource } from '@/types/crm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { User, Building2, AlertCircle } from 'lucide-react'
import { LEAD_SOURCE_OPTIONS, LEAD_SOURCE_CONFIG } from '@/components/LeadSourceBadge'

// Funções utilitárias de formatação
const maskCPF = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 11)
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}

const maskCNPJ = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [type, setType] = useState<CustomerType>('PF')
  const [cpf, setCpf] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [leadSource, setLeadSource] = useState<LeadSource>('other')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)

  const isEditing = Boolean(id)

  useEffect(() => {
    if (id) {
      getCustomer(id)
        .then((c) => {
          setName(c.name)
          setContactName(c.contact_name || '')
          setPhone(c.phone)
          setEmail(c.email || '')
          setCompany(c.company || '')
          setNotes(c.notes || '')
          if (c.lead_source) {
            setLeadSource(c.lead_source)
          } else {
            setLeadSource('other')
          }
          if (c.type) {
            setType(c.type)
          } else if (c.cnpj) {
            setType('PJ')
          } else {
            setType('PF')
          }
          setCpf(c.cpf ? maskCPF(c.cpf) : '')
          setCnpj(c.cnpj ? maskCNPJ(c.cnpj) : '')
        })
        .catch((e) => {
          console.error(e)
          toast({ title: 'Erro ao carregar cliente', variant: 'destructive' })
        })
    }
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !phone) {
      toast({ title: 'Preencha nome e telefone', variant: 'destructive' })
      return
    }

    const currentDoc = type === 'PF' ? cpf : cnpj
    const cleanDoc = cleanDocument(currentDoc)

    // Validação de documento duplicado
    if (cleanDoc) {
      const duplicate = await checkDuplicateDocument(cleanDoc, id)
      if (duplicate) {
        const docLabel = type === 'PF' ? 'CPF' : 'CNPJ'
        const errorMsg = `Este ${docLabel} já está cadastrado para o cliente "${duplicate.name}".`
        setDocumentError(errorMsg)
        toast({
          title: `${docLabel} já cadastrado`,
          description: errorMsg,
          variant: 'destructive',
        })
        return
      }
    }

    setDocumentError(null)
    setLoading(true)
    try {
      const payload = {
        name,
        contact_name: contactName.trim() || undefined,
        phone,
        email,
        company,
        notes,
        type,
        lead_source: leadSource,
        cpf: type === 'PF' ? cpf : '',
        cnpj: type === 'PJ' ? cnpj : '',
      }

      if (isEditing && id) {
        await updateCustomer(id, payload)
      } else {
        await createCustomer(payload)
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
        className="bg-white p-6 rounded-xl border border-slate-200 space-y-5"
      >
        {/* Seletor Tipo: PF ou PJ */}
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-slate-700">Tipo de Cliente *</Label>
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg max-w-sm">
            <button
              type="button"
              onClick={() => setType('PF')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-all ${
                type === 'PF'
                  ? 'bg-white text-emerald-700 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="h-4 w-4" />
              Pessoa Física (PF)
            </button>
            <button
              type="button"
              onClick={() => setType('PJ')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-all ${
                type === 'PJ'
                  ? 'bg-white text-emerald-700 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Pessoa Jurídica (PJ)
            </button>
          </div>
        </div>

        {/* Campos condicionais: CPF para PF, CNPJ para PJ */}
        {type === 'PF' ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cpf">CPF</Label>
            </div>
            <Input
              id="cpf"
              value={cpf}
              onChange={(e) => {
                setCpf(maskCPF(e.target.value))
                if (documentError) setDocumentError(null)
              }}
              placeholder="000.000.000-00"
              maxLength={14}
              className={documentError ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {documentError && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {documentError}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cnpj">CNPJ</Label>
            </div>
            <Input
              id="cnpj"
              value={cnpj}
              onChange={(e) => {
                setCnpj(maskCNPJ(e.target.value))
                if (documentError) setDocumentError(null)
              }}
              placeholder="00.000.000/0000-00"
              maxLength={18}
              className={documentError ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {documentError && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {documentError}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>{type === 'PF' ? 'Nome Completo *' : 'Razão Social / Nome Fantasia *'}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={type === 'PF' ? 'Ex: Carlos Silva' : 'Ex: Auto Peças Silva Ltda'}
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            Nome da Pessoa de Contato {type === 'PJ' ? '(Responsável / Comprador)' : '(opcional)'}
          </Label>
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Ex: Carlos Silva, Roberto, Maria..."
          />
          <p className="text-xs text-slate-500">
            Exibido nos cards do Pipeline de Vendas junto com a empresa.
          </p>
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

        {type === 'PJ' && (
          <div className="space-y-1.5">
            <Label>Nome Fantasia / Contato Comercial</Label>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ex: Filial Centro / Contato: Marcos"
            />
          </div>
        )}

        {type === 'PF' && (
          <div className="space-y-1.5">
            <Label>Empresa / Vínculo (opcional)</Label>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Empresa onde trabalha ou oficina parceira"
            />
          </div>
        )}

        {/* Origem do Lead */}
        <div className="space-y-1.5">
          <Label htmlFor="lead-source">Origem do Lead</Label>
          <div className="relative">
            <select
              id="lead-source"
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value as LeadSource)}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {LEAD_SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">
            Canal de aquisição pelo qual o cliente entrou em contato pela primeira vez.
          </p>
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
