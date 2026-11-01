// Hook de bloqueio de duplicidade em customers (clientes e fornecedores)
// FASE 2: Unificado com o motor anti-duplicidade
// Regras:
// 1. Fornecedor e Cliente PJ: dedupe por CNPJ normalizado.
// 2. Cliente PF: dedupe por CPF se houver; senão por TELEFONE NORMALIZADO (DDI+DDD canônico).
// 3. Ao editar, o próprio registro não conta como duplicado.
// 4. Registros deleted = true são ignorados na validação de salvamento ativo.
// IMPORTANTE: Todas as funções auxiliares são declaradas inline dentro de cada callback (PocketBase JSVM scoping rule)

onRecordCreateRequest((e) => {
  const record = e.record
  if (record.getBool('deleted')) return e.next()

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function getCorePhoneKey(raw, defaultDdd) {
    if (!raw) return ''
    const ddd = defaultDdd || '11'
    const s = String(raw).trim()
    if (s.toLowerCase().indexOf('@lid') !== -1) return ''
    const digits = cleanDigits(s)
    if (!digits || digits.length < 8) return ''

    let canonical = digits
    if (canonical.length === 8) {
      canonical = '55' + ddd + canonical
    } else if (canonical.length === 10 && canonical.indexOf('55') !== 0) {
      canonical = '55' + canonical
    } else if (canonical.length === 9) {
      canonical = '55' + ddd + canonical
    } else if (canonical.length === 11 && canonical.indexOf('55') !== 0) {
      canonical = '55' + canonical
    }

    let withoutDdi = canonical
    if (canonical.indexOf('55') === 0 && canonical.length >= 12) {
      withoutDdi = canonical.slice(2)
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

    // 1. Validar CNPJ exato
    if (cleanCnpj && cleanCnpj.length === 14) {
      const existingCnpj = cleanDigits(existing.getString('cnpj'))
      if (existingCnpj && existingCnpj === cleanCnpj) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CNPJ: ${existingName} [id:${existing.id}]`,
        )
      }
    }

    // 2. Validar CPF exato
    if (cleanCpf && cleanCpf.length === 11) {
      const existingCpf = cleanDigits(existing.getString('cpf'))
      if (existingCpf && existingCpf === cleanCpf) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CPF: ${existingName} [id:${existing.id}]`,
        )
      }
    }

    // 3. Validar telefone normalizado (chave principal para cliente PF e atendimento)
    if (phoneCore) {
      const existingPhoneCore = getCorePhoneKey(existing.getString('phone'))
      if (existingPhoneCore && existingPhoneCore === phoneCore) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este telefone: ${existingName} [id:${existing.id}]`,
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

  function getCorePhoneKey(raw, defaultDdd) {
    if (!raw) return ''
    const ddd = defaultDdd || '11'
    const s = String(raw).trim()
    if (s.toLowerCase().indexOf('@lid') !== -1) return ''
    const digits = cleanDigits(s)
    if (!digits || digits.length < 8) return ''

    let canonical = digits
    if (canonical.length === 8) {
      canonical = '55' + ddd + canonical
    } else if (canonical.length === 10 && canonical.indexOf('55') !== 0) {
      canonical = '55' + canonical
    } else if (canonical.length === 9) {
      canonical = '55' + ddd + canonical
    } else if (canonical.length === 11 && canonical.indexOf('55') !== 0) {
      canonical = '55' + canonical
    }

    let withoutDdi = canonical
    if (canonical.indexOf('55') === 0 && canonical.length >= 12) {
      withoutDdi = canonical.slice(2)
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

    // 1. Validar CNPJ
    if (cleanCnpj && cleanCnpj.length === 14) {
      const existingCnpj = cleanDigits(existing.getString('cnpj'))
      if (existingCnpj && existingCnpj === cleanCnpj) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CNPJ: ${existingName} [id:${existing.id}]`,
        )
      }
    }

    // 2. Validar CPF
    if (cleanCpf && cleanCpf.length === 11) {
      const existingCpf = cleanDigits(existing.getString('cpf'))
      if (existingCpf && existingCpf === cleanCpf) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este CPF: ${existingName} [id:${existing.id}]`,
        )
      }
    }

    // 3. Validar telefone
    if (phoneCore) {
      const existingPhoneCore = getCorePhoneKey(existing.getString('phone'))
      if (existingPhoneCore && existingPhoneCore === phoneCore) {
        throw new BadRequestError(
          `Já existe um ${entityLabel} cadastrado com este telefone: ${existingName} [id:${existing.id}]`,
        )
      }
    }
  }

  return e.next()
}, 'customers')
