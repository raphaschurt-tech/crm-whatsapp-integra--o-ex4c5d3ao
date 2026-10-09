// Hook de bloqueio de duplicidade em customers (clientes e fornecedores)
// Regras:
// 1. Ao salvar cliente ou fornecedor (criar ou editar), verificar se o telefone, CPF ou CNPJ já pertence a outro registro do mesmo tipo.
// 2. Comparação normalizada:
//    - Telefone sem pontuação/55/9º dígito: DDD + 8 dígitos canônicos (ou variantes).
//    - CPF/CNPJ apenas dígitos — grafias diferentes do mesmo documento devem casar.
//    - Campo vazio de CPF/CNPJ nunca bloqueia.
// 3. Duplicidade -> bloquear o salvamento com aviso claro:
//    "Já existe um cliente/fornecedor cadastrado com este telefone/CPF/CNPJ: {nome do existente}"
// 4. Ao editar um registro, o próprio registro não conta como duplicado (comparar apenas contra os outros).

onRecordCreateRequest((e) => {
  const record = e.record
  if (record.getBool('deleted')) return e.next()

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function getCorePhoneKey(raw) {
    if (!raw) return ''
    const s = String(raw).trim()
    if (s.toLowerCase().indexOf('@lid') !== -1) return ''
    const digits = cleanDigits(s)
    if (digits.length >= 14 || digits.length < 8) return ''

    let withoutDdi = digits
    if (digits.indexOf('55') === 0 && (digits.length === 12 || digits.length === 13)) {
      withoutDdi = digits.slice(2)
    }

    if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
      return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
    }
    if (withoutDdi.length === 10) {
      return withoutDdi
    }
    return withoutDdi
  }

  function getGroupType(customerType) {
    const t = (customerType || '').toLowerCase()
    if (t === 'fornecedor' || t === 'ambos') return 'fornecedor'
    return 'cliente'
  }

  const rawPhone = record.getString('phone')
  const phoneCore = getCorePhoneKey(rawPhone)
  const cleanCpf = cleanDigits(record.getString('cpf'))
  const cleanCnpj = cleanDigits(record.getString('cnpj'))
  const targetGroupType = getGroupType(record.getString('customer_type'))
  const entityLabel = targetGroupType === 'fornecedor' ? 'fornecedor' : 'cliente'

  const allActive = $app.findRecordsByFilter('customers', 'deleted = false', 'created', 10000, 0)

  for (let i = 0; i < allActive.length; i++) {
    const existing = allActive[i]
    const existingGroupType = getGroupType(existing.getString('customer_type'))
    if (existingGroupType !== targetGroupType) continue

    const existingName = existing.getString('name') || 'Sem Nome'

    // 1. Validar telefone
    if (phoneCore) {
      const existingPhoneCore = getCorePhoneKey(existing.getString('phone'))
      if (existingPhoneCore && existingPhoneCore === phoneCore) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este telefone: ${existingName}`,
        )
      }
    }

    // 2. Validar CPF
    if (cleanCpf) {
      const existingCpf = cleanDigits(existing.getString('cpf'))
      if (existingCpf && existingCpf === cleanCpf) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CPF: ${existingName}`,
        )
      }
    }

    // 3. Validar CNPJ
    if (cleanCnpj) {
      const existingCnpj = cleanDigits(existing.getString('cnpj'))
      if (existingCnpj && existingCnpj === cleanCnpj) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CNPJ: ${existingName}`,
        )
      }
    }
  }

  return e.next()
}, 'customers')

onRecordUpdateRequest((e) => {
  const record = e.record
  if (record.getBool('deleted')) return e.next()

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function getCorePhoneKey(raw) {
    if (!raw) return ''
    const s = String(raw).trim()
    if (s.toLowerCase().indexOf('@lid') !== -1) return ''
    const digits = cleanDigits(s)
    if (digits.length >= 14 || digits.length < 8) return ''

    let withoutDdi = digits
    if (digits.indexOf('55') === 0 && (digits.length === 12 || digits.length === 13)) {
      withoutDdi = digits.slice(2)
    }

    if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
      return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
    }
    if (withoutDdi.length === 10) {
      return withoutDdi
    }
    return withoutDdi
  }

  function getGroupType(customerType) {
    const t = (customerType || '').toLowerCase()
    if (t === 'fornecedor' || t === 'ambos') return 'fornecedor'
    return 'cliente'
  }

  const currentId = record.id
  const rawPhone = record.getString('phone')
  const phoneCore = getCorePhoneKey(rawPhone)
  const cleanCpf = cleanDigits(record.getString('cpf'))
  const cleanCnpj = cleanDigits(record.getString('cnpj'))
  const targetGroupType = getGroupType(record.getString('customer_type'))
  const entityLabel = targetGroupType === 'fornecedor' ? 'fornecedor' : 'cliente'

  const allActive = $app.findRecordsByFilter('customers', 'deleted = false', 'created', 10000, 0)

  for (let i = 0; i < allActive.length; i++) {
    const existing = allActive[i]
    if (existing.id === currentId) continue

    const existingGroupType = getGroupType(existing.getString('customer_type'))
    if (existingGroupType !== targetGroupType) continue

    const existingName = existing.getString('name') || 'Sem Nome'

    // 1. Validar telefone
    if (phoneCore) {
      const existingPhoneCore = getCorePhoneKey(existing.getString('phone'))
      if (existingPhoneCore && existingPhoneCore === phoneCore) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este telefone: ${existingName}`,
        )
      }
    }

    // 2. Validar CPF
    if (cleanCpf) {
      const existingCpf = cleanDigits(existing.getString('cpf'))
      if (existingCpf && existingCpf === cleanCpf) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CPF: ${existingName}`,
        )
      }
    }

    // 3. Validar CNPJ
    if (cleanCnpj) {
      const existingCnpj = cleanDigits(existing.getString('cnpj'))
      if (existingCnpj && existingCnpj === cleanCnpj) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CNPJ: ${existingName}`,
        )
      }
    }
  }

  return e.next()
}, 'customers')
