import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import pb from '@/lib/pocketbase/client'
import { User } from '@/types/crm'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isAdmin: boolean
  signUp: (email: string, password: string, name?: string) => Promise<{ error: any }>
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(
    pb.authStore.isValid && pb.authStore.record ? (pb.authStore.record as unknown as User) : null,
  )
  const [isAuthenticated, setIsAuthenticated] = useState(pb.authStore.isValid)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, record) => {
      setUser(pb.authStore.isValid && record ? (record as unknown as User) : null)
      setIsAuthenticated(pb.authStore.isValid)
    })

    if (pb.authStore.isValid) {
      pb.collection('users')
        .authRefresh()
        .catch((error: unknown) => {
          // Só desloga se o erro for definitivamente de autenticação (400, 401, 403 ou token expirado/inválido)
          // Em erros transitórios (429 rate limit, 5xx, falha de rede/sem resposta), preserva a sessão local
          const status =
            (error as { status?: number })?.status ??
            (error as { response?: { status?: number } })?.response?.status
          const isExplicitAuthFailure = status === 400 || status === 401 || status === 403

          if (isExplicitAuthFailure) {
            pb.authStore.clear()
          } else {
            console.warn(
              '[AuthProvider] authRefresh falhou por erro transitório; mantendo sessão local:',
              error,
            )
          }
        })
        .finally(() => setLoading(false))
    } else {
      if (pb.authStore.record) pb.authStore.clear()
      setLoading(false)
    }

    return () => {
      unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string, name?: string) => {
    try {
      await pb
        .collection('users')
        .create({ email, password, passwordConfirm: password, name, role: 'colaborador' })
      await pb.collection('users').authWithPassword(email, password)
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      await pb.collection('users').authWithPassword(email, password)
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const signOut = () => {
    pb.authStore.clear()
  }

  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        signUp,
        signIn,
        signOut,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
