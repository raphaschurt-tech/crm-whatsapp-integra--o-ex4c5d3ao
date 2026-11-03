import { BankAccountsView } from './BankAccountsView'

export function BankAccountsPage() {
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Contas Bancárias</h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão de contas correntes, caixas físicos e aplicações financeiras multi-conta.
          </p>
        </div>
      </div>

      <BankAccountsView />
    </div>
  )
}
