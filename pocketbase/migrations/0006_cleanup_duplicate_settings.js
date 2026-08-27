migrate(
  (app) => {
    // 1. Confirmar que o registro duplicado iy6gkdc2tx5npcg existe e está sem credenciais
    try {
      const duplicateRec = app.findRecordById('settings', 'iy6gkdc2tx5npcg')
      const zInstance = duplicateRec.getString('zapi_instance_id')
      const zToken = duplicateRec.getString('zapi_token')
      const zClientToken = duplicateRec.getString('zapi_client_token')

      // Verificar que realmente não possui credenciais completas
      if (!zInstance && !zToken && !zClientToken) {
        // Excluir com segurança
        app.delete(duplicateRec)
      }
    } catch (_) {
      // Se não existir, ignora
    }

    // 2. Confirmar que ks86suaa4vn5xd4 está íntegro e possui todas as credenciais necessárias
    try {
      const validRec = app.findRecordById('settings', 'ks86suaa4vn5xd4')
      const validInstance = validRec.getString('zapi_instance_id')
      const validToken = validRec.getString('zapi_token')
      const validClientToken = validRec.getString('zapi_client_token')

      if (validInstance && validToken && validClientToken) {
        // Preservar e garantir valores corretos
        app.save(validRec)
      }
    } catch (_) {}
  },
  (app) => {
    // Reversão não necessária / não recria registro inválido
  },
)
