import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  getCustomer,
  createCustomer,
  updateCustomer,
  getCustomers,
  getCustomerDocuments,
  addCustomerDocument,
  DuplicateConflictInfo,
  extractDuplicateErrorInfo,
} from '@/services/customers'
import { getFamilies } from '@/services/families'
import { CustomerType, LeadSource, ItemFamily } from '@/types/crm'
import { useToast } from '@/hooks/use-toast'
import { useTabState } from '@/hooks/use-tab-state'
import {
  AlertCircle,
  Building2,
  User,
  Users,
  Truck,
  Check,
  Layers,
  ExternalLink,
  FileText,
  Plus,
} from 'lucide-react'
import { LEAD_SOURCE_OPTIONS } from '@/components/LeadSourceBadge'
import {
  parseAndNormalizeDocument,
  findDuplicateContact,
  cleanDigits,
  formatDocumentDisplay,
} from '@/services/contactDedupeEngine'

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { markDirty, closeTab } = useTabState()
  const { toast } = useToast()

  const [customerType, setCustomerType] = useState<'Cliente' | 'Fornecedor' | 'Ambos'>('Cliente')
  const [type, setType] = useState<CustomerType>('PF')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [documentInput, setDocumentInput] = useState('')
  const [detectedDocType, setDetectedDocType] = useState<'CPF' | 'CNPJ' | 'UNKNOWN'>('UNKNOWN')
  const [leadSource, setLeadSource] = useState<LeadSource>('other')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [documentWarning, setDocumentWarning] = useState<string | null>(null)
  const [allFamilies, setAllFamilies] = useState<ItemFamily[]>([])
  const [selectedFamilyIds, setSelectedFamilyIds] = useState<string[]>([])
  const [familiesError, setFamiliesError] = useState<string | null>(null)
  const [duplicateBanner, setDuplicateBanner] = useState<DuplicateConflictInfo | null>(null)
  const [existingDocuments, setExistingDocuments] = useState<any[]>([])
  const [showAddBranchDoc, setShowAddBranchDoc] = useState(false)
  const [newBranchDoc, setNewBranchDoc] = useState('')
  const [newBranchLabel, setNewBranchLabel] = useState('')

  const isEditing = Boolean(id)

  useEffect(() => {
    getFamilies()
      .then((fams) => setAllFamilies(fams))
      .catch(console.error)
  }, [])

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

          const rawType = (c.customer_type || '').toLowerCase()
          if (rawType === 'fornecedor') {
            setCustomerType('Fornecedor')
          } else if (rawType === 'ambos') {
            setCustomerType('Ambos')
          } else {
            setCustomerType('Cliente')
          }

          if (c.item_families && Array.isArray(c.item_families)) {
            setSelectedFamilyIds(c.item_families)
          }

          if (c.lead_source) {
            setLeadSource(c.lead_source)
          } else {
            setLeadSource('other')
          }

          if (c.cnpj) {
            setType('PJ')
            setDocumentInput(formatDocumentDisplay(c.cnpj))
            setDetectedDocType('CNPJ')
          } else if (c.cpf) {
            setType('PF')
            setDocumentInput(formatDocumentDisplay(c.cpf))
            setDetectedDocType('CPF')
          } else {
            setType(c.type || 'PF')
            setDocumentInput('')
            setDetectedDocType('UNKNOWN')
          }
        })
        .catch((e) => {
          console.error(e)
          toast({ title: 'Erro ao carregar cliente', variant: 'destructive' })
        })

      getCustomerDocuments(id)
        .then((docs) => setExistingDocuments(docs))
        .catch(console.error)
    }
  }, [id])

  const handleDocumentChange = (raw: string) => {
    const digits = cleanDigits(raw).slice(0, 14)
    markDirty(true)
    setDocumentWarning(null)

    if (digits.length <= 11) {
      // Formata como CPF enquanto até 11 dígitos
      const parsed = parseAndNormalizeDocument(digits)
      setDocumentInput(parsed.formatted)
      if (digits.length === 11) {
        setDetectedDocType('CPF')
        setType('PF')
      } else {
        setDetectedDocType('UNKNOWN')
      }
    } else {
      // 12 a 14 dígitos formata como CNPJ
      const parsed = parseAndNormalizeDocument(digits)
      setDocumentInput(parsed.formatted)
      if (digits.length === 14) {
        setDetectedDocType('CNPJ')
        setType('PJ')
      } else {
        setDetectedDocType('UNKNOWN')
      }
    }
  }

  const toggleFamilySelection = (familyId: string) => {
    markDirty(true)
    setSelectedFamilyIds((prev) => {
      const next = prev.includes(familyId)
        ? prev.filter((fid) => fid !== familyId)
        : [...prev, familyId]
      if (next.length > 0) setFamiliesError(null)
      return next
    })
  }

  const handleAddBranchDocument = async () => {
    if (!id) return
    const parsed = parseAndNormalizeDocument(newBranchDoc)
    if (!parsed.isValidLength) {
      toast({
        title: 'Documento inválido',
        description: 'Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.',
        variant: 'destructive',
      })
      return
    }

    try {
      await addCustomerDocument({
        customer: id,
        document_type: parsed.type as 'CPF' | 'CNPJ',
        document_number: parsed.cleanDigits,
        root_cnpj: parsed.rootCnpj,
        label: newBranchLabel.trim() || 'Filial/Unidade Adicional',
        is_primary: false,
      })
      toast({ title: 'Documento vinculado com sucesso!' })
      setNewBranchDoc('')
      setNewBranchLabel('')
      setShowAddBranchDoc(false)
      const updated = await getCustomerDocuments(id)
      setExistingDocuments(updated)
    } catch (err: any) {
      toast({
        title: 'Erro ao vincular documento',
        description: err?.message || 'Falha ao salvar documento',
        variant: 'destructive',
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !phone) {
      toast({ title: 'Preencha nome e telefone', variant: 'destructive' })
      return
    }

    // Regra: ao salvar com Tipo = Fornecedor ou Ambos, exigir pelo menos 1 família selecionada
    if (
      (customerType === 'Fornecedor' || customerType === 'Ambos') &&
      selectedFamilyIds.length === 0
    ) {
      const errMsg = 'Selecione ao menos uma família que este fornecedor fornece'
      setFamiliesError(errMsg)
      toast({
        title: 'Família obrigatória',
        description: errMsg,
        variant: 'destructive',
      })
      return
    }
    setFamiliesError(null)

    // Validação de deduplicação preventiva via motor unificado
    const parsedDoc = parseAndNormalizeDocument(documentInput)
    try {
      const allCusts = await getCustomers(false)
      const dedupeResult = findDuplicateContact(
        {
          document: parsedDoc.cleanDigits,
          phone,
          name,
          customerType,
          excludeCustomerId: id,
        },
        allCusts as any,
      )

      if (dedupeResult.action === 'match_found' && dedupeResult.existingCustomer) {
        const errorMsg = dedupeResult.warningMessage || 'Contato já existe no sistema.'
        setDocumentWarning(errorMsg)
        setDuplicateBanner({
          isDuplicate: true,
          message: errorMsg,
          existingId: dedupeResult.existingCustomer.id,
          existingName: dedupeResult.existingCustomer.name,
          field: dedupeResult.matchType === 'canonical_phone' ? 'telefone' : 'documento',
          entityLabel:
            (dedupeResult.existingCustomer.customer_type || '').toLowerCase() === 'fornecedor'
              ? 'fornecedor'
              : 'cliente',
        })
        toast({
          title: 'Cadastro duplicado identificado',
          description: errorMsg,
          variant: 'destructive',
        })
        return
      }

      if (dedupeResult.action === 'branch_group_found' && dedupeResult.existingCustomer) {
        // Alerta de que a unidade pertence à mesma empresa
        toast({
          title: 'Unidade pertencente à mesma empresa',
          description: dedupeResult.warningMessage,
        })
      } else if (dedupeResult.action === 'fuzzy_warning' && dedupeResult.existingCustomer) {
        toast({
          title: 'Aviso de nome similar',
          description: dedupeResult.warningMessage,
        })
      }
    } catch (err) {
      console.warn('Erro ao validar deduplicação prévia:', err)
    }

    setDocumentWarning(null)
    setDuplicateBanner(null)
    setLoading(true)

    try {
      const isCnpj = parsedDoc.type === 'CNPJ'
      const isCpf = parsedDoc.type === 'CPF'

      const roles =
        customerType === 'Fornecedor'
          ? ['fornecedor']
          : customerType === 'Ambos'
            ? ['cliente', 'fornecedor']
            : ['cliente']

      const payload: Partial<any> = {
        name,
        contact_name: contactName.trim() || undefined,
        phone,
        email,
        company,
        notes,
        type: isCnpj ? 'PJ' : 'PF',
        customer_type: customerType,
        roles,
        item_families: selectedFamilyIds,
        lead_source: leadSource,
        cpf: isCpf ? parsedDoc.cleanDigits : '',
        cnpj: isCnpj ? parsedDoc.cleanDigits : '',
      }

      let savedId = id
      if (isEditing && id) {
        await updateCustomer(id, payload)
      } else {
        const created = await createCustomer(payload)
        savedId = created.id
      }

      // Se documento preenchido, garantir sincronização em customer_documents
      if (savedId && parsedDoc.isValidLength) {
        try {
          const existingDocs = await getCustomerDocuments(savedId)
          const alreadyLinked = existingDocs.some(
            (d: any) => d.document_number === parsedDoc.cleanDigits,
          )
          if (!alreadyLinked) {
            await addCustomerDocument({
              customer: savedId,
              document_type: parsedDoc.type as 'CPF' | 'CNPJ',
              document_number: parsedDoc.cleanDigits,
              root_cnpj: parsedDoc.rootCnpj,
              label: parsedDoc.type === 'CNPJ' ? 'Matriz/Unidade Principal' : 'CPF Principal',
              is_primary: true,
            })
          }
        } catch (docErr) {
          console.warn('Erro ao gravar customer_document secundário:', docErr)
        }
      }

      markDirty(false)
      toast({
        title:
          customerType === 'Fornecedor'
            ? 'Fornecedor salvo com sucesso!'
            : customerType === 'Ambos'
              ? 'Cliente/Fornecedor salvo com sucesso!'
              : 'Cliente salvo com sucesso!',
      })
      closeTab(undefined, true)
    } catch (err: any) {
      const dupInfo: DuplicateConflictInfo = err?.duplicateInfo || extractDuplicateErrorInfo(err)
      if (dupInfo.isDuplicate) {
        setDuplicateBanner(dupInfo)
        toast({
          title: 'Cadastro duplicado bloqueado',
          description: dupInfo.message,
          variant: 'destructive',
        })
      } else {
        const msg = err?.message || 'Erro ao salvar cliente'
        toast({
          title: 'Erro ao salvar',
          description: msg,
          variant: 'destructive',
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    closeTab(undefined, true)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {isEditing ? 'Editar Contato' : 'Novo Contato'}
      </h1>

      {duplicateBanner && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-amber-900 space-y-3 animate-in fade-in-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-amber-950">Cadastro Duplicado Identificado</p>
              <p className="mt-1 text-amber-900/90 leading-relaxed">{duplicateBanner.message}</p>
            </div>
          </div>
          {duplicateBanner.existingId && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(`/clientes/${duplicateBanner.existingId}`)}
                className="bg-white hover:bg-amber-100/60 text-amber-900 border-amber-300 gap-1.5 font-medium shadow-xs"
              >
                <ExternalLink className="w-4 h-4 text-amber-700" />
                Abrir cadastro existente
              </Button>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 rounded-xl border border-slate-200 space-y-5"
      >
        {/* Classificação do Papel: Cliente / Fornecedor / Ambos */}
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-slate-700">Papel do Contato *</Label>
          <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-lg max-w-md">
            <button
              type="button"
              onClick={() => {
                setCustomerType('Cliente')
                markDirty(true)
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs sm:text-sm font-medium rounded-md transition-all ${
                customerType === 'Cliente'
                  ? 'bg-white text-emerald-700 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4" />
              Cliente
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerType('Fornecedor')
                markDirty(true)
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs sm:text-sm font-medium rounded-md transition-all ${
                customerType === 'Fornecedor'
                  ? 'bg-white text-amber-700 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="h-4 w-4" />
              Fornecedor
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerType('Ambos')
                markDirty(true)
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs sm:text-sm font-medium rounded-md transition-all ${
                customerType === 'Ambos'
                  ? 'bg-white text-indigo-700 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="h-4 w-4" />
              Ambos
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {customerType === 'Cliente' && 'Participa de orçamentos e do fluxo comercial.'}
            {customerType === 'Fornecedor' &&
              'Disponível para cotação e pedidos de compras no Pipeline de Compras.'}
            {customerType === 'Ambos' &&
              'Atua tanto como cliente em vendas quanto fornecedor em compras.'}
          </p>
        </div>

        {/* Famílias que fornece (visível para Fornecedor ou Ambos) */}
        {(customerType === 'Fornecedor' || customerType === 'Ambos') && (
          <div className="space-y-2 p-4 bg-amber-50/60 rounded-xl border border-amber-200/80 animate-in fade-in-50">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-amber-600" />
                Famílias que fornece <span className="text-red-500">*</span>
              </Label>
              <span className="text-[11px] font-medium text-amber-700">
                {selectedFamilyIds.length}{' '}
                {selectedFamilyIds.length === 1 ? 'família selecionada' : 'famílias selecionadas'}
              </span>
            </div>
            <p className="text-xs text-amber-800/80">
              Selecione quais categorias de peças este fornecedor fornece para priorização
              inteligente nas compras.
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              {allFamilies.map((fam) => {
                const isSelected = selectedFamilyIds.includes(fam.id)
                return (
                  <button
                    key={fam.id}
                    type="button"
                    onClick={() => toggleFamilySelection(fam.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs ring-2 ring-amber-300'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-amber-400 hover:bg-amber-50/40'
                    }`}
                  >
                    {isSelected ? (
                      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    )}
                    {fam.name}
                  </button>
                )
              })}
            </div>

            {familiesError && (
              <p className="text-xs text-red-600 flex items-center gap-1 pt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {familiesError}
              </p>
            )}
          </div>
        )}

        {/* CAMPO ÚNICO DE DOCUMENTO (CPF / CNPJ) COM AUTO-DETECÇÃO */}
        <div className="space-y-1.5 p-4 bg-slate-50/70 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between">
            <Label htmlFor="doc-input" className="text-sm font-semibold text-slate-800">
              Documento (CPF ou CNPJ)
            </Label>
            <div className="flex items-center gap-1.5">
              {detectedDocType === 'CPF' && (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[11px] font-semibold"
                >
                  <User className="w-3 h-3 mr-1" /> CPF Detectado (11 dígitos)
                </Badge>
              )}
              {detectedDocType === 'CNPJ' && (
                <Badge
                  variant="outline"
                  className="bg-indigo-50 text-indigo-700 border-indigo-300 text-[11px] font-semibold"
                >
                  <Building2 className="w-3 h-3 mr-1" /> CNPJ Detectado (14 dígitos)
                </Badge>
              )}
              {detectedDocType === 'UNKNOWN' && documentInput.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  {cleanDigits(documentInput).length} dígitos
                </span>
              )}
            </div>
          </div>

          <Input
            id="doc-input"
            value={documentInput}
            onChange={(e) => handleDocumentChange(e.target.value)}
            placeholder="Digite CPF (11 dígitos) ou CNPJ (14 dígitos)"
            className={documentWarning ? 'border-red-500 focus-visible:ring-red-500' : ''}
          />
          <p className="text-xs text-slate-500">
            Detecção automática: 11 dígitos = CPF (Pessoa Física), 14 dígitos = CNPJ (Pessoa
            Jurídica).
          </p>

          {documentWarning && (
            <p className="text-xs text-red-600 flex items-center gap-1 mt-1 font-medium">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {documentWarning}
            </p>
          )}

          {/* Lista de documentos vinculados / unidades da mesma empresa (se já editando) */}
          {isEditing && existingDocuments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                Unidades / Documentos vinculados ({existingDocuments.length}):
              </span>
              <div className="space-y-1.5">
                {existingDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {doc.document_type}
                      </Badge>
                      <span className="font-mono font-medium text-slate-800">
                        {formatDocumentDisplay(doc.document_number)}
                      </span>
                      {doc.label && <span className="text-slate-500">({doc.label})</span>}
                    </div>
                    {doc.is_primary && (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
                        Principal
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adicionar nova unidade/filial (N documentos por contato) */}
          {isEditing && (
            <div className="pt-2">
              {!showAddBranchDoc ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddBranchDoc(true)}
                  className="text-xs text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 p-0 h-auto gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Vincular outra unidade/CNPJ à mesma empresa
                </Button>
              ) : (
                <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-200 space-y-2">
                  <span className="text-xs font-semibold text-indigo-900">
                    Vincular Unidade / Filial
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      placeholder="CNPJ ou CPF da unidade"
                      value={newBranchDoc}
                      onChange={(e) => setNewBranchDoc(e.target.value)}
                      className="text-xs h-8 bg-white"
                    />
                    <Input
                      placeholder="Identificação (ex: Filial Campinas)"
                      value={newBranchLabel}
                      onChange={(e) => setNewBranchLabel(e.target.value)}
                      className="text-xs h-8 bg-white"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setShowAddBranchDoc(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="text-xs h-7 bg-indigo-600 hover:bg-indigo-700 text-white"
                      onClick={handleAddBranchDocument}
                    >
                      Vincular Unidade
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>
            {detectedDocType === 'CNPJ' || type === 'PJ'
              ? 'Razão Social / Nome Fantasia *'
              : 'Nome Completo *'}
          </Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty(true)
            }}
            required
            placeholder={
              detectedDocType === 'CNPJ' || type === 'PJ'
                ? 'Ex: Auto Peças Silva Ltda'
                : 'Ex: Carlos Silva'
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            Nome da Pessoa de Contato{' '}
            {detectedDocType === 'CNPJ' || type === 'PJ'
              ? '(Responsável / Comprador)'
              : '(opcional)'}
          </Label>
          <Input
            value={contactName}
            onChange={(e) => {
              setContactName(e.target.value)
              markDirty(true)
            }}
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
              onChange={(e) => {
                setPhone(e.target.value)
                markDirty(true)
              }}
              required
              placeholder="(11) 98765-4321"
            />
          </div>

          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                markDirty(true)
              }}
              placeholder="carlos@empresa.com"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Nome Fantasia / Empresa Parceira</Label>
          <Input
            value={company}
            onChange={(e) => {
              setCompany(e.target.value)
              markDirty(true)
            }}
            placeholder="Ex: Filial Centro / Oficina Silva"
          />
        </div>

        {/* Origem do Lead */}
        <div className="space-y-1.5">
          <Label htmlFor="lead-source">Origem do Lead</Label>
          <div className="relative">
            <select
              id="lead-source"
              value={leadSource}
              onChange={(e) => {
                setLeadSource(e.target.value as LeadSource)
                markDirty(true)
              }}
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
            onChange={(e) => {
              setNotes(e.target.value)
              markDirty(true)
            }}
            rows={3}
            placeholder="Preferências do cliente..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            {loading ? 'Salvando...' : 'Salvar Contato'}
          </Button>
        </div>
      </form>
    </div>
  )
}
