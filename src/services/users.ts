import pb from '@/lib/pocketbase/client'
import { withRetry } from '@/lib/retry'
import { User } from '@/types/crm'

export interface CreateUserData {
  name: string
  email: string
  password: string
  passwordConfirm: string
  role: 'admin' | 'colaborador'
  phone?: string
  blocked?: boolean
}

export interface UpdateUserData {
  name?: string
  email?: string
  role?: 'admin' | 'colaborador'
  phone?: string
  blocked?: boolean
  password?: string
  passwordConfirm?: string
}

export const getUsers = async (): Promise<User[]> => {
  try {
    return await withRetry(
      () =>
        pb.collection<User>('users').getFullList({
          sort: '-created',
        }),
      { retries: 3, delayMs: 800 },
    )
  } catch (error) {
    console.warn('Erro ao carregar usuários:', error)
    return []
  }
}

export const getUserById = async (id: string): Promise<User> => {
  return withRetry(() => pb.collection<User>('users').getOne(id), { retries: 2, delayMs: 800 })
}

export const createUser = async (data: CreateUserData): Promise<User> => {
  return pb.collection<User>('users').create({
    ...data,
    emailVisibility: true,
  })
}

export const updateUser = async (id: string, data: UpdateUserData): Promise<User> => {
  return pb.collection<User>('users').update(id, data)
}

export const toggleBlockUser = async (id: string, currentBlocked: boolean): Promise<User> => {
  return pb.collection<User>('users').update(id, {
    blocked: !currentBlocked,
  })
}

export const deleteUser = async (id: string): Promise<boolean> => {
  return pb.collection('users').delete(id)
}
