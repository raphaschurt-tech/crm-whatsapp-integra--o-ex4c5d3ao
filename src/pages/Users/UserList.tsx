import { useEffect, useState } from 'react'
import {
  UserPlus,
  Search,
  Edit2,
  Lock,
  Unlock,
  Trash2,
  Shield,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { getUsers, createUser, updateUser, toggleBlockUser, deleteUser } from '@/services/users'
import { User } from '@/types/crm'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'

export default function UserList() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Modais de Criação / Edição
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Formulário
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'colaborador'>('colaborador')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')

  // Modal de confirmação de exclusão
  const [deletingUser, setDeletingUser] = useState<User | null>(null)

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getUsers()
      setUsers(data)
    } catch (err: any) {
      console.error('Erro ao carregar usuários:', err)
      setLoadError(err?.message || 'Falha ao comunicar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useRealtime('users', () => {
    loadData()
  })

  const openCreateModal = () => {
    setEditingUser(null)
    setName('')
    setEmail('')
    setRole('colaborador')
    setPassword('')
    setPhone('')
    setIsModalOpen(true)
  }

  const openEditModal = (user: User) => {
    setEditingUser(user)
    setName(user.name || '')
    setEmail(user.email || '')
    setRole(user.role || 'colaborador')
    setPassword('')
    setPhone(user.phone || '')
    setIsModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      if (editingUser) {
        // Edição
        const updatePayload: Record<string, unknown> = {
          name,
          email,
          role,
          phone,
        }
        if (password.trim()) {
          updatePayload.password = password
          updatePayload.passwordConfirm = password
        }

        await updateUser(editingUser.id, updatePayload)
        toast({
          title: 'Usuário atualizado com sucesso!',
          description: `Os dados de ${name || email} foram salvos.`,
        })
      } else {
        // Criação
        if (!password || password.length < 8) {
          toast({
            title: 'Senha inválida',
            description: 'A senha deve ter no mínimo 8 caracteres.',
            variant: 'destructive',
          })
          setSubmitting(false)
          return
        }

        await createUser({
          name,
          email,
          role,
          phone,
          password,
          passwordConfirm: password,
        })
        toast({
          title: 'Usuário criado com sucesso!',
          description: `${name || email} agora pode acessar o sistema.`,
        })
      }

      setIsModalOpen(false)
      loadData()
    } catch (err: unknown) {
      console.error(err)
      toast({
        title: 'Erro ao salvar usuário',
        description:
          (err as { message?: string })?.message || 'Verifique se o e-mail já está em uso.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleBlock = async (user: User) => {
    if (user.id === currentUser?.id) {
      toast({
        title: 'Ação não permitida',
        description: 'Você não pode bloquear sua própria conta de administrador.',
        variant: 'destructive',
      })
      return
    }

    try {
      const isBlocked = !!user.blocked
      await toggleBlockUser(user.id, isBlocked)
      toast({
        title: isBlocked ? 'Usuário desbloqueado' : 'Usuário bloqueado',
        description: isBlocked
          ? `${user.name || user.email} agora pode acessar o sistema.`
          : `${user.name || user.email} teve seu acesso bloqueado.`,
      })
      loadData()
    } catch (err) {
      console.error(err)
      toast({
        title: 'Erro ao alterar status',
        description: 'Não foi possível alterar o status do usuário.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    if (!deletingUser) return

    if (deletingUser.id === currentUser?.id) {
      toast({
        title: 'Ação não permitida',
        description: 'Você não pode excluir sua própria conta.',
        variant: 'destructive',
      })
      setDeletingUser(null)
      return
    }

    try {
      await deleteUser(deletingUser.id)
      toast({
        title: 'Usuário excluído',
        description: `${deletingUser.name || deletingUser.email} foi removido com sucesso.`,
      })
      setDeletingUser(null)
      loadData()
    } catch (err) {
      console.error(err)
      toast({
        title: 'Erro ao excluir usuário',
        description: 'Não foi possível remover o usuário.',
        variant: 'destructive',
      })
    }
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    return (
      (u.name || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.phone || '').includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    )
  })

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(dateStr))
    } catch (_) {
      return dateStr
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Usuários</h1>
          <p className="text-sm text-slate-500">
            Controle de acesso, funções e permissões da equipe no CRM
          </p>
        </div>
        <Button
          onClick={openCreateModal}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow"
        >
          <UserPlus className="mr-1.5 h-4 w-4" /> Novo Usuário
        </Button>
      </div>

      {/* Barra de busca */}
      <div className="bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, email ou função..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Tabela ou Lista */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
          <p>Carregando usuários...</p>
        </div>
      ) : loadError ? (
        <div className="bg-white p-8 rounded-xl border border-red-200 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <p className="text-slate-700 font-medium">
            Não foi possível carregar a lista de usuários.
          </p>
          <p className="text-xs text-slate-500">O servidor pode estar inicializando.</p>
          <Button onClick={() => loadData()} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
          Nenhum usuário encontrado.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b">
                  <th className="p-4">Usuário</th>
                  <th className="p-4">E-mail</th>
                  <th className="p-4">Função</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Data de Criação</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((u) => {
                  const isBlocked = !!u.blocked
                  const isSelf = u.id === currentUser?.id
                  const isAdminRole = u.role === 'admin'

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                              isBlocked
                                ? 'bg-slate-200 text-slate-500'
                                : isAdminRole
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {u.name?.[0]?.toUpperCase() || u.email[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              {u.name || 'Sem nome'}
                              {isSelf && (
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                                  Você
                                </span>
                              )}
                            </div>
                            {u.phone && <div className="text-xs text-slate-400">{u.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-slate-700">{u.email}</td>
                      <td className="p-4">
                        {isAdminRole ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 gap-1 font-medium"
                          >
                            <Shield className="h-3 w-3" /> Admin
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-slate-50 text-slate-600 border-slate-200 gap-1 font-medium"
                          >
                            <UserIcon className="h-3 w-3" /> Colaborador
                          </Badge>
                        )}
                      </td>
                      <td className="p-4">
                        {isBlocked ? (
                          <Badge
                            variant="destructive"
                            className="bg-red-50 text-red-700 border-red-200 gap-1 hover:bg-red-50"
                          >
                            <XCircle className="h-3 w-3" /> Bloqueado
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 hover:bg-emerald-50"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Ativo
                          </Badge>
                        )}
                      </td>
                      <td className="p-4 text-slate-500 text-xs">{formatDate(u.created)}</td>
                      <td className="p-4 text-right space-x-1">
                        {/* Editar */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(u)}
                          title="Editar usuário"
                          className="text-slate-600 hover:text-slate-900"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>

                        {/* Bloquear / Desbloquear */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf}
                          onClick={() => handleToggleBlock(u)}
                          title={
                            isSelf
                              ? 'Você não pode bloquear a si mesmo'
                              : isBlocked
                                ? 'Desbloquear usuário'
                                : 'Bloquear usuário'
                          }
                          className={
                            isBlocked
                              ? 'text-emerald-600 hover:text-emerald-700'
                              : 'text-amber-600 hover:text-amber-700'
                          }
                        >
                          {isBlocked ? (
                            <Unlock className="h-4 w-4" />
                          ) : (
                            <Lock className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Excluir */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf}
                          onClick={() => setDeletingUser(u)}
                          title={isSelf ? 'Você não pode excluir a si mesmo' : 'Excluir usuário'}
                          className="text-red-500 hover:text-red-700 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Versão Mobile */}
          <div className="md:hidden divide-y">
            {filtered.map((u) => {
              const isBlocked = !!u.blocked
              const isSelf = u.id === currentUser?.id
              const isAdminRole = u.role === 'admin'

              return (
                <div key={u.id} className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                          isBlocked
                            ? 'bg-slate-200 text-slate-500'
                            : isAdminRole
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {u.name?.[0]?.toUpperCase() || u.email[0]?.toUpperCase() || 'U'}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 flex items-center gap-1.5">
                          {u.name || 'Sem nome'}
                          {isSelf && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1 rounded">
                              Você
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                    </div>
                    <div>
                      {isBlocked ? (
                        <Badge variant="destructive" className="text-xs">
                          Bloqueado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-xs">
                          Ativo
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium">
                      Função: {isAdminRole ? 'Admin' : 'Colaborador'}
                    </span>
                    <span>Criado em: {formatDate(u.created)}</span>
                  </div>

                  <div className="flex justify-end gap-1.5 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(u)}
                      className="text-xs"
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf}
                      onClick={() => handleToggleBlock(u)}
                      className={`text-xs ${isBlocked ? 'text-emerald-600' : 'text-amber-600'}`}
                    >
                      {isBlocked ? (
                        <>
                          <Unlock className="h-3.5 w-3.5 mr-1" /> Desbloquear
                        </>
                      ) : (
                        <>
                          <Lock className="h-3.5 w-3.5 mr-1" /> Bloquear
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf}
                      onClick={() => setDeletingUser(u)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal Criar / Editar Usuário */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? 'Atualize os dados e a função do usuário no sistema.'
                : 'Preencha as informações para cadastrar um novo colaborador ou admin.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nome Completo</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: João da Silva"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">E-mail</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="joao@empresa.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-phone">Telefone / WhatsApp (Opcional)</Label>
              <Input
                id="user-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-8888"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-role">Função / Permissão</Label>
              <Select value={role} onValueChange={(val: 'admin' | 'colaborador') => setRole(val)}>
                <SelectTrigger id="user-role">
                  <SelectValue placeholder="Selecione a função" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="colaborador">
                    Colaborador (Acesso a orçamentos, clientes e estoque)
                  </SelectItem>
                  <SelectItem value="admin">
                    Administrador (Acesso total incluindo configurações e usuários)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-password">
                {editingUser
                  ? 'Nova Senha (deixe em branco para manter a atual)'
                  : 'Senha de Acesso'}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editingUser ? '•••••••• (opcional)' : 'Mínimo 8 caracteres'}
                required={!editingUser}
                minLength={editingUser ? undefined : 8}
              />
            </div>

            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
              >
                {submitting ? 'Salvando...' : editingUser ? 'Salvar Alterações' : 'Criar Usuário'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Confirmação de Exclusão */}
      <Dialog
        open={!!deletingUser}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Excluir Usuário
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover o usuário{' '}
              <strong>{deletingUser?.name || deletingUser?.email}</strong>? Esta ação é irreversível
              e o usuário não terá mais acesso à plataforma.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setDeletingUser(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Sim, Excluir Usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
