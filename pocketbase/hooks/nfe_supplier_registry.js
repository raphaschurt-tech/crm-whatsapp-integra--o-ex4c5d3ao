/**
 * F4 — REGISTRO DE FORNECEDOR VIA XML (0.0.265 / 0.0.266)
 * Motor de dedupe + auto-cadastro de fornecedor a partir dos dados do emitente
 * da NF-e. Compartilhado por:
 *   - pocketbase/hooks/nfe_pipeline.js (rota /backend/v1/nfe/upload — worker DF-e / upload manual)
 *   - pocketbase/hooks/nfe_email_inbox.js (cron de inbox + rota /backend/v1/nfe/email-inbox/sync)
 *
 * Regras:
 * - Dedupe ANTES de cada criação (nunca criar duplicado):
 *   1) customers.cnpj (não deletados);
 *   2) customer_documents.document_number (unidade/filial já vinculada);
 *   3) customer_documents.root_cnpj (mesma raiz = mesma entidade, filial cai na
 *      MESMA entidade sem fundir registros);
 *   4) telefone do emitente (cruzamento pelo core canônico, DDD+8).
 * - Se existir registro com o mesmo CNPJ → vincular (atualizar dados que faltam).
 * - Se a raiz já pertence a uma entidade → VINCULAR a nota à entidade (sem nova
 *   criação); se a unidade do XML ainda não está em customer_documents, gravar o
 *   documento da unidade apontando para a entidade.
 * - Criar fornecedor NOVO somente quando nada bate. A coleção customers EXIGE
 *   phone: se o XML não trouxer <enderEmit><fone>, gera um fallback legível
 *   "0000000000" para que a criação não falhe e a nota possa seguir sem retenção.
 * - Suporta extração de IE (Inscrição Estadual) e endereço completo (<xLgr>, <nro>,
 *   <xBairro>, <xMun>, <UF>, <CEP>) e enriquece as notas do fornecedor.
 */

function nfeCleanDigits(value) {
  if (!value) return ''
  return String(value).replace(/\D/g, '')
}

// Core canônico de telefone (espelha getCanonicalPhoneCore do front): DDD + 8
// dígitos, sem DDI 55 e sem nono dígito — para cruzar fornecedores por telefone.
function nfeCanonicalPhoneCore(rawPhone) {
  if (!rawPhone) return ''
  const digits = nfeCleanDigits(rawPhone)
  if (digits.length >= 14 || digits.length < 8) return ''
  let withoutDdi = digits
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    withoutDdi = digits.slice(2)
  }
  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    return withoutDdi.slice(0, 2) + withoutDdi.slice(3)
  }
  return withoutDdi
}

function nfeFindSupplierByCnpj(emitCnpj) {
  if (!emitCnpj) return null
  try {
    const found = $app.findRecordsByFilter(
      'customers',
      'cnpj = {:cnpj} && deleted = false',
      '-created',
      1,
      0,
      { cnpj: emitCnpj },
    )
    if (found && found.length > 0) return found[0]
  } catch (_) {}
  return null
}

function nfeFindSupplierByDocument(emitCnpj) {
  if (!emitCnpj) return null
  try {
    const docs = $app.findRecordsByFilter(
      'customer_documents',
      'document_number = {:num}',
      '-created',
      1,
      0,
      { num: emitCnpj },
    )
    if (docs && docs.length > 0) {
      const custId = docs[0].getString('customer')
      if (custId) {
        try {
          return $app.findRecordById('customers', custId)
        } catch (_) {}
      }
    }
  } catch (_) {}
  return null
}

// Mesma raiz de CNPJ => mesma entidade (filial cai no fornecedor existente)
function nfeFindSupplierByRoot(rootCnpj) {
  if (!rootCnpj) return null
  try {
    const docs = $app.findRecordsByFilter(
      'customer_documents',
      'root_cnpj = {:root}',
      '-created',
      1,
      0,
      { root: rootCnpj },
    )
    if (docs && docs.length > 0) {
      const custId = docs[0].getString('customer')
      if (custId) {
        try {
          const cust = $app.findRecordById('customers', custId)
          if (cust && !cust.getBool('deleted')) return cust
        } catch (_) {}
      }
    }
  } catch (_) {}
  return null
}

function nfeFindSupplierByPhone(emitPhone) {
  const core = nfeCanonicalPhoneCore(emitPhone)
  if (!core) return null
  try {
    const found = $app.findRecordsByFilter(
      'customers',
      'phone ~ {:core} && deleted = false',
      '-created',
      10,
      0,
      { core: core },
    )
    for (let i = 0; i < found.length; i++) {
      if (nfeCanonicalPhoneCore(found[i].getString('phone')) === core) return found[i]
    }
  } catch (_) {}
  return null
}

function nfeFindSupplierByEmail(emitEmail) {
  if (!emitEmail) return null
  try {
    const found = $app.findRecordsByFilter(
      'customers',
      'email = {:email} && deleted = false',
      '-created',
      1,
      0,
      { email: emitEmail },
    )
    if (found && found.length > 0) return found[0]
  } catch (_) {}
  return null
}

// Garante o documento (CNPJ da unidade) em customer_documents apontando para a
// entidade. Idempotente: não cria se o número já estiver vinculado a qualquer
// cliente (regra permanente: nunca fundir/apagar registros existentes).
function nfeEnsureSupplierDocument(supplierRec, emitCnpj, sourceLabel) {
  if (!supplierRec || !emitCnpj) return
  try {
    const existing = $app.findRecordsByFilter(
      'customer_documents',
      'document_number = {:num}',
      '-created',
      1,
      0,
      { num: emitCnpj },
    )
    if (existing && existing.length > 0) return
    const docsCol = $app.findCollectionByNameOrId('customer_documents')
    const docRec = new Record(docsCol)
    docRec.set('customer', supplierRec.id)
    docRec.set('document_type', 'CNPJ')
    docRec.set('document_number', emitCnpj)
    docRec.set('root_cnpj', emitCnpj.slice(0, 8))
    docRec.set('label', 'Unidade (auto via NF-e' + (sourceLabel ? ' — ' + sourceLabel : '') + ')')
    docRec.set('is_primary', false)
    $app.save(docRec)
    console.log(
      '[NFE-SUPPLIER-DOC-LINKED]',
      JSON.stringify({ supplierId: supplierRec.id, document: emitCnpj }),
    )
  } catch (docErr) {
    console.log('[NFE-SUPPLIER-DOC-ERR]', String(docErr))
  }
}

/**
 * Extrai dados do emitente a partir do XML da NF-e de forma completa:
 * CNPJ, Razão Social, Fantasia, IE, Telefone e Endereço.
 */
function nfeExtractEmitDataFromXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') return {}

  function extractTag(src, tagName) {
    if (!src) return ''
    const re = new RegExp('<' + tagName + '[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i')
    const m = src.match(re)
    return m && m[1] ? m[1].trim() : ''
  }

  const infNFeBlock = extractTag(xmlString, 'infNFe')
  const emitBlock = extractTag(infNFeBlock || xmlString, 'emit')
  if (!emitBlock) return {}

  const cnpj = nfeCleanDigits(extractTag(emitBlock, 'CNPJ'))
  const name = extractTag(emitBlock, 'xNome')
  const fant = extractTag(emitBlock, 'xFant')
  const ie = extractTag(emitBlock, 'IE')

  const enderEmitBlock = extractTag(emitBlock, 'enderEmit')
  const phone = nfeCleanDigits(extractTag(enderEmitBlock, 'fone'))
  const xLgr = extractTag(enderEmitBlock, 'xLgr')
  const nro = extractTag(enderEmitBlock, 'nro')
  const xBairro = extractTag(enderEmitBlock, 'xBairro')
  const xMun = extractTag(enderEmitBlock, 'xMun')
  const uf = extractTag(enderEmitBlock, 'UF')
  const cep = nfeCleanDigits(extractTag(enderEmitBlock, 'CEP'))

  const addressParts = []
  if (xLgr) addressParts.push(xLgr + (nro ? ', ' + nro : ''))
  if (xBairro) addressParts.push(xBairro)
  if (xMun) addressParts.push(xMun + (uf ? ' - ' + uf : ''))
  if (cep) addressParts.push('CEP ' + cep)
  const fullAddress = addressParts.join(' - ')

  return {
    cnpj: cnpj,
    name: name || fant,
    fantasia: fant,
    ie: ie,
    phone: phone,
    xLgr: xLgr,
    nro: nro,
    xBairro: xBairro,
    xMun: xMun,
    uf: uf,
    cep: cep,
    address: fullAddress,
  }
}

/**
 * Resolve o fornecedor do emitente do XML: dedupe (CNPJ → documento → raiz →
 * telefone → email → nome) e, se nada bater, auto-cadastra o fornecedor.
 * Retorna { supplier, created, matchedBy, pendingRegistration: false }.
 */
function nfeResolveOrCreateSupplier(emit, sourceChannel) {
  const emitCnpj = nfeCleanDigits(emit && emit.cnpj)
  const emitName = String((emit && emit.name) || '').trim()
  const emitPhone = nfeCleanDigits(emit && emit.phone)
  const emitEmail = String((emit && emit.email) || '').trim()
  const emitIe = String((emit && emit.ie) || '').trim()
  const emitAddress = String((emit && emit.address) || '').trim()
  const rootCnpj = emitCnpj ? emitCnpj.slice(0, 8) : ''
  const sourceLabel = String(sourceChannel || 'xml')

  let supplier = nfeFindSupplierByCnpj(emitCnpj)
  let matchedBy = supplier ? 'cnpj' : ''

  if (!supplier) {
    supplier = nfeFindSupplierByDocument(emitCnpj)
    matchedBy = supplier ? 'customer_documents' : ''
  }
  if (!supplier) {
    supplier = nfeFindSupplierByRoot(rootCnpj)
    matchedBy = supplier ? 'raiz_cnpj' : ''
  }
  if (!supplier) {
    supplier = nfeFindSupplierByPhone(emitPhone)
    matchedBy = supplier ? 'telefone' : ''
  }
  if (!supplier) {
    supplier = nfeFindSupplierByEmail(emitEmail)
    matchedBy = supplier ? 'email' : ''
  }

  // Dedupe por nome aproximado como último recurso
  if (!supplier && emitName && emitName.length >= 5) {
    try {
      const byName = $app.findRecordsByFilter(
        'customers',
        "customer_type = 'Fornecedor' && deleted = false && name ~ {:nm}",
        '-created',
        1,
        0,
        { nm: emitName },
      )
      if (byName && byName.length > 0) {
        supplier = byName[0]
        matchedBy = 'nome'
      }
    } catch (_) {}
  }

  if (supplier) {
    // Vincular: preencher lacunas do cadastro existente (nunca apagar dados)
    try {
      let changed = false
      if (!supplier.getString('cnpj') && emitCnpj) {
        supplier.set('cnpj', emitCnpj)
        changed = true
      }
      if (!supplier.getString('company') && emitName) {
        supplier.set('company', emitName)
        changed = true
      }
      if (!supplier.getString('type')) {
        supplier.set('type', 'PJ')
        changed = true
      }
      if (emitCnpj && supplier.getString('customer_type') !== 'Fornecedor') {
        supplier.set('customer_type', 'Fornecedor')
        changed = true
      }
      if (changed) $app.save(supplier)
    } catch (_) {}
    nfeEnsureSupplierDocument(supplier, emitCnpj, sourceLabel)
    return { supplier: supplier, created: false, matchedBy: matchedBy, pendingRegistration: false }
  }

  // Nada bateu: cadastrar fornecedor novo a partir dos dados do XML.
  // Phone é campo obrigatório em customers: se emitPhone estiver vazio, usa fallback
  const phoneToSave = emitPhone || '0000000000'

  try {
    const custCol = $app.findCollectionByNameOrId('customers')
    const newSupp = new Record(custCol)
    newSupp.set('name', emitName || 'Fornecedor CNPJ ' + emitCnpj)
    newSupp.set('company', emitName || '')
    newSupp.set('cnpj', emitCnpj)
    newSupp.set('phone', phoneToSave)
    if (emitEmail) newSupp.set('email', emitEmail)
    newSupp.set('type', 'PJ')
    newSupp.set('customer_type', 'Fornecedor')
    newSupp.set('source', 'nfe_' + sourceLabel)

    const notesParts = [
      'Fornecedor cadastrado automaticamente via ingestão de NF-e (' + sourceLabel + ').',
    ]
    if (emitIe) notesParts.push('IE: ' + emitIe)
    if (emitAddress) notesParts.push('Endereço: ' + emitAddress)
    newSupp.set('notes', notesParts.join(' | '))

    $app.save(newSupp)
    nfeEnsureSupplierDocument(newSupp, emitCnpj, sourceLabel)
    console.log(
      '[NFE-SUPPLIER-AUTO-CREATED]',
      JSON.stringify({
        supplierId: newSupp.id,
        cnpj: emitCnpj,
        nome: emitName,
        origem: sourceLabel,
        hasPhone: Boolean(emitPhone),
        horarioBrasilia: new Date(Date.now() - 3 * 3600 * 1000)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 19),
      }),
    )
    return { supplier: newSupp, created: true, matchedBy: '', pendingRegistration: false }
  } catch (suppErr) {
    console.log('[NFE-SUPPLIER-CREATE-ERR]', String(suppErr))
    return { supplier: null, created: false, matchedBy: '', pendingRegistration: true }
  }
}
