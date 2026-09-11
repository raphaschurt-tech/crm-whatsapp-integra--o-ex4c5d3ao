// Validação de soft delete em customers
// Regras:
// 1. Apenas usuários autenticados com role 'admin' podem marcar um cliente como excluído (deleted = true).
// 2. Se um usuário que não é 'admin' tentar alterar deleted para true, a requisição é rejeitada com erro 403 Forbidden.
// 3. Edições normais de dados de cliente continuam 100% permitidas para todos os papéis (colaborador / admin).

onRecordUpdateRequest((e) => {
  const authRecord = e.auth
  const updatedRecord = e.record

  // Se a requisição está definindo deleted = true
  const isDeletedNow = Boolean(updatedRecord.get('deleted'))
  const wasDeletedBefore = Boolean(updatedRecord.original().get('deleted'))

  // Se está ocorrendo uma exclusão (transição para deleted=true)
  if (isDeletedNow && !wasDeletedBefore) {
    if (!authRecord) {
      throw new ForbiddenError('Apenas usuários autenticados podem excluir clientes.')
    }

    const userRole = String(authRecord.getString('role') || authRecord.get('role') || '')
    if (userRole !== 'admin') {
      throw new ForbiddenError(
        'Apenas administradores têm permissão para excluir clientes ou leads.',
      )
    }

    // Preenche deleted_at caso não tenha sido enviado
    if (!updatedRecord.get('deleted_at')) {
      updatedRecord.set('deleted_at', new Date().toISOString())
    }
  }

  return e.next()
}, 'customers')
