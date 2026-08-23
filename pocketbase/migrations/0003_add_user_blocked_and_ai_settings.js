migrate(
  (app) => {
    // 1. Atualizar a coleção users: adicionar campo blocked (booleano) se não existir
    // e ajustar regras para administradores poderem gerenciar usuários
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    if (!users.fields.getByName('blocked')) {
      users.fields.add(
        new BoolField({
          name: 'blocked',
          required: false,
        }),
      )
    }

    // Permitir que admins listem, visualizem, criem, atualizem e deletem usuários
    // O próprio usuário ainda pode ver/atualizar seu perfil
    users.listRule = "id = @request.auth.id || @request.auth.role = 'admin'"
    users.viewRule = "id = @request.auth.id || @request.auth.role = 'admin'"
    users.createRule = "@request.auth.role = 'admin' || @request.auth.id = ''"
    users.updateRule = "id = @request.auth.id || @request.auth.role = 'admin'"
    users.deleteRule = "@request.auth.role = 'admin'"

    app.save(users)

    // 2. Atualizar a coleção settings: adicionar campos de IA e Z-API
    const settings = app.findCollectionByNameOrId('settings')
    if (!settings.fields.getByName('ai_enabled')) {
      settings.fields.add(
        new BoolField({
          name: 'ai_enabled',
          required: false,
        }),
      )
    }
    if (!settings.fields.getByName('openai_api_key')) {
      settings.fields.add(
        new TextField({
          name: 'openai_api_key',
        }),
      )
    }
    if (!settings.fields.getByName('zapi_instance_id')) {
      settings.fields.add(
        new TextField({
          name: 'zapi_instance_id',
        }),
      )
    }
    if (!settings.fields.getByName('zapi_token')) {
      settings.fields.add(
        new TextField({
          name: 'zapi_token',
        }),
      )
    }
    if (!settings.fields.getByName('zapi_client_token')) {
      settings.fields.add(
        new TextField({
          name: 'zapi_client_token',
        }),
      )
    }
    if (!settings.fields.getByName('ai_system_prompt')) {
      settings.fields.add(
        new EditorField({
          name: 'ai_system_prompt',
        }),
      )
    }

    app.save(settings)
  },
  (app) => {
    // Reversão
    try {
      const users = app.findCollectionByNameOrId('_pb_users_auth_')
      const blockedField = users.fields.getByName('blocked')
      if (blockedField) users.fields.remove(blockedField)
      users.listRule = 'id = @request.auth.id'
      users.viewRule = 'id = @request.auth.id'
      users.createRule = ''
      users.updateRule = 'id = @request.auth.id'
      users.deleteRule = 'id = @request.auth.id'
      app.save(users)
    } catch (_) {}

    try {
      const settings = app.findCollectionByNameOrId('settings')
      const fieldsToRemove = [
        'ai_enabled',
        'openai_api_key',
        'zapi_instance_id',
        'zapi_token',
        'zapi_client_token',
        'ai_system_prompt',
      ]
      for (const f of fieldsToRemove) {
        const field = settings.fields.getByName(f)
        if (field) settings.fields.remove(field)
      }
      app.save(settings)
    } catch (_) {}
  },
)
