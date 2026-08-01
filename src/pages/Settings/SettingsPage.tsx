import { useEffect, useState } from 'react'
import { Save, Settings as SettingsIcon } from 'lucide-react'
import { getSettings, saveSettings } from '@/services/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'

export default function SettingsPage() {
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [stockApiUrl, setStockApiUrl] = useState('')
  const [paymentLinkTemplate, setPaymentLinkTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      if (s) {
        setWhatsappNumber(s.whatsapp_number || '')
        setStockApiUrl(s.stock_api_url || '')
        setPaymentLinkTemplate(s.payment_link_template || '')
      }
      setLoading(false)
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await saveSettings({
        whatsapp_number: whatsappNumber,
        stock_api_url: stockApiUrl,
        payment_link_template: paymentLinkTemplate,
      })
      toast({ title: 'Configurações salvas com sucesso!' })
    } catch (_) {
      toast({ title: 'Erro ao salvar configurações', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return <div className="p-8 text-center text-slate-500">Carregando configurações...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-6 w-6 text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">Configurações do Sistema</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 rounded-xl border border-slate-200 space-y-6"
      >
        <div className="space-y-1.5">
          <Label>Número padrão do WhatsApp da Empresa</Label>
          <Input
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="5511999998888"
          />
          <p className="text-xs text-slate-500">
            Usado como remetente/contato de apoio nas mensagens.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>URL da API Externa de Estoque</Label>
          <Input
            value={stockApiUrl}
            onChange={(e) => setStockApiUrl(e.target.value)}
            placeholder="https://dummyjson.com/products"
          />
          <p className="text-xs text-slate-500">
            Endpoint para consulta e sincronização em tempo real de produtos.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Modelo de Link de Pagamento (Opcional)</Label>
          <Input
            value={paymentLinkTemplate}
            onChange={(e) => setPaymentLinkTemplate(e.target.value)}
            placeholder="Deixe em branco para usar a página interna de checkout"
          />
          <p className="text-xs text-slate-500">
            Pode usar espaço para gateway customizado. Ex: https://gateway.com/pay/{'{id}'}?token=
            {'{token}'}
          </p>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button
            type="submit"
            disabled={saving}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            <Save className="mr-1.5 h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar Configurações'}
          </Button>
        </div>
      </form>
    </div>
  )
}
