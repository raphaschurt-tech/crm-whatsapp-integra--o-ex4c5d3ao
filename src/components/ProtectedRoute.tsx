import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'

interface ProtectedRouteProps {
  adminOnly?: boolean
}

export const ProtectedRoute = ({ adminOnly = false }: ProtectedRouteProps) => {
  const { isAuthenticated, isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (adminOnly && !isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold text-slate-800">Acesso Negado</h2>
        <p className="mt-2 text-slate-600">Você não tem permissão para acessar esta página.</p>
      </div>
    )
  }

  return <Outlet />
}
