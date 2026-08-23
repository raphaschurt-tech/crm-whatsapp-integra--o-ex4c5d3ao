// Intercepta requisições de login e authRefresh para rejeitar usuários bloqueados
onRecordAuthRequest((e) => {
  const record = e.record
  if (record && record.getBool('blocked')) {
    return e.forbiddenError('Usuário bloqueado. Entre em contato com o administrador.')
  }
  return e.next()
}, 'users')
