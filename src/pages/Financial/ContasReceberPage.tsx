import { AccountsReceivableList } from './AccountsReceivableList'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'

export default function ContasReceberPage() {
  const { isAdmin } = useAuth()

  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800">Acesso Restrito</h2>
        <p className="mt-2 text-slate-600 text-sm">
          O módulo financeiro é exclusivo para a administração.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            Contas a Receber
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão de receitas, recebimentos vinculados a orçamentos e clientes.
          </p>
        </div>
      </div>

      <AccountsReceivableList />
    </div>
  )
}
