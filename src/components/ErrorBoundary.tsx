import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou erro de renderização:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoDashboard = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const errorMessage =
        this.state.error?.message || 'Ocorreu um erro inesperado durante a renderização.'
      const errorStack = this.state.errorInfo?.componentStack || this.state.error?.stack || ''

      return (
        <div className="min-h-[500px] w-full flex items-center justify-center p-6 bg-white">
          <div className="max-w-xl w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-sm">
              <AlertTriangle className="w-8 h-8 stroke-[2.2]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900">
                Ocorreu um erro ao carregar esta página
              </h2>
              <p className="text-sm text-slate-500">
                A aplicação capturou uma falha de renderização para evitar o encerramento da
                interface.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left font-mono text-xs overflow-hidden">
              <p className="font-semibold text-red-600 mb-1 break-words">
                {this.state.error?.name || 'Error'}: {errorMessage}
              </p>
              {errorStack && (
                <pre className="text-slate-600 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed pt-2 border-t border-slate-200">
                  {errorStack}
                </pre>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                onClick={this.handleReload}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Recarregar Página
              </Button>
              <Button
                onClick={this.handleGoDashboard}
                variant="outline"
                className="w-full sm:w-auto border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <Home className="mr-2 h-4 w-4" /> Voltar ao Dashboard
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
