// pocketbase/hooks/danfe_pdf_processor.js
// Utilitário central de processamento de DANFE em PDF (canais WhatsApp e E-mail).
//
// Regras e Diretrizes do Projeto:
// 1. Extração da chave de acesso de 44 dígitos do texto do PDF ($documents.toMarkdown).
// 2. Sem OCR pesado: se o PDF não tiver camada de texto (ex.: escaneado como imagem),
//    encaminha para a Fila de Revisão (nfe_price_queue) com alerta:
//    "PDF sem camada de texto — pedir XML ao fornecedor" (comportamento CORRETO, não defeito).
// 3. Validação de formato da chave de 44 dígitos (dígito verificador módulo 11 ponderado padrão SEFAZ).
// 4. Deduplicação em 3 camadas (reutilizando nfe_processed existente por chave).
//    Se já processada -> BARRAR por dedupe com log e auditoria clara.
// 5. Se válida e não processada: enfileira comando 'busca_por_chave' no worker DF-e (dfe_command_queue)
//    para baixar o XML oficial da SEFAZ via certificado A1.
// 6. Horários sempre em fuso de Brasília (UTC-3).
// 7. Auditoria do rastro completo: arquivo PDF, remetente, origem (whatsapp/email/upload).

function getBrasiliaIsoDanfe() {
  try {
    return new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
  } catch (_) {
    return new Date().toISOString()
  }
}

/**
 * Valida o dígito verificador módulo 11 de uma chave de NF-e de 44 dígitos.
 * Ponderação SEFAZ: pesos 2 a 9 da direita para a esquerda nos primeiros 43 dígitos.
 * dv = 11 - (soma % 11). Se resto 0 ou 1, dv = 0.
 */
function validateNfeKeyDV(key44) {
  if (!key44 || typeof key44 !== 'string') return false
  const clean = key44.replace(/\D/g, '')
  if (clean.length !== 44) return false

  const base = clean.slice(0, 43)
  const expectedDv = parseInt(clean.slice(43), 10)

  let sum = 0
  let weight = 2
  for (let i = base.length - 1; i >= 0; i--) {
    sum += parseInt(base[i], 10) * weight
    weight++
    if (weight > 9) weight = 2
  }

  const remainder = sum % 11
  const calculatedDv = remainder === 0 || remainder === 1 ? 0 : 11 - remainder
  return calculatedDv === expectedDv
}

/**
 * Extrai candidatos a chaves de 44 dígitos de um texto.
 * Lida com formatações típicas de DANFE:
 * - 44 dígitos contínuos: 35261059417469000173550010000329431406428669
 * - Agrupados de 4 em 4: 3526 1059 4174 6900 0173 5500 1000 0329 4314 0642 8669
 * - Marcados com rótulo "CHAVE DE ACESSO"
 */
function extractNfeKeysFromText(text) {
  if (!text || typeof text !== 'string') return []

  const foundKeys = new Set()

  // 1. Regex para bloco de 44 dígitos com possíveis espaços ou hífens
  // Ex: 11 blocos de 4 dígitos (com espaços)
  const spacedRegex = /\b(?:\d{4}[\s-]?){10}\d{4}\b/g
  const spacedMatches = text.match(spacedRegex) || []
  for (const m of spacedMatches) {
    const raw = m.replace(/\D/g, '')
    if (raw.length === 44) {
      foundKeys.add(raw)
    }
  }

  // 2. Regex direta para 44 dígitos seguidos
  const directRegex = /\b\d{44}\b/g
  const directMatches = text.match(directRegex) || []
  for (const m of directMatches) {
    foundKeys.add(m)
  }

  // 3. Procura próxima ao rótulo "CHAVE DE ACESSO"
  const labelRegex = /CHAVE\s+(?:DE\s+)?ACESSO[^\d]{0,40}((?:\d[\s-]?){44})/gi
  let match
  while ((match = labelRegex.exec(text)) !== null) {
    if (match[1]) {
      const raw = match[1].replace(/\D/g, '')
      if (raw.length === 44) {
        foundKeys.add(raw)
      }
    }
  }

  return Array.from(foundKeys)
}

/**
 * Envia um caso com problema/sem chave/sem camada para a Fila de Revisão (nfe_price_queue)
 * Aceita objeto { reason, auditTrail, accessKey, itemType } OU assinatura posicional (accessKey, reason, auditTrail, itemType)
 */
function sendToDanfeReviewQueue(arg1, arg2, arg3, arg4) {
  let reason = ''
  let auditTrail = {}
  let accessKey = ''
  let itemType = 'excecao'

  if (
    arg1 &&
    typeof arg1 === 'object' &&
    !Array.isArray(arg1) &&
    (arg1.reason || arg1.auditTrail || arg1.accessKey !== undefined)
  ) {
    reason = arg1.reason || ''
    auditTrail = arg1.auditTrail || {}
    accessKey = arg1.accessKey || ''
    itemType = arg1.itemType || 'excecao'
  } else {
    accessKey = typeof arg1 === 'string' ? arg1 : ''
    reason = typeof arg2 === 'string' ? arg2 : ''
    auditTrail = arg3 && typeof arg3 === 'object' ? arg3 : {}
    itemType = typeof arg4 === 'string' ? arg4 : 'excecao'
  }

  const bIso = getBrasiliaIsoDanfe()
  const cleanReason = (reason || 'DANFE em PDF pendente de revisão').trim()
  const cleanAccessKey = (accessKey || '').trim()

  const rastro =
    'Origem: ' +
    (auditTrail.origin || 'pdf') +
    ' | Remetente: ' +
    (auditTrail.sender || auditTrail.sender_phone || auditTrail.remetente || 'desconhecido') +
    ' | Arquivo: ' +
    (auditTrail.fileName || auditTrail.url || 'sem_nome') +
    ' | Horário: ' +
    bIso +
    (cleanAccessKey ? ' | Chave: ' + cleanAccessKey : '')

  try {
    const queueCol = $app.findCollectionByNameOrId('nfe_price_queue')
    const qRec = new Record(queueCol)
    qRec.set('access_key', cleanAccessKey)
    qRec.set('supplier_code', '')
    qRec.set('description', cleanReason)
    qRec.set('status', 'pendente')
    qRec.set('item_type', itemType || 'excecao')
    qRec.set('resolution_notes', rastro)
    $app.save(qRec)

    console.log(
      '[DANFE-PDF-QUEUE-SENT]',
      JSON.stringify({
        queueId: qRec.id,
        reason: cleanReason,
        accessKey: cleanAccessKey || null,
        status: 'pendente',
        item_type: itemType || 'excecao',
        auditTrail: auditTrail,
      }),
    )
    return { queued: true, queueId: qRec.id, recordId: qRec.id }
  } catch (err) {
    console.log('[DANFE-PDF-QUEUE-ERR]', String(err))
    return { queued: false, error: String(err) }
  }
}

/**
 * Enfileira comando 'busca_por_chave' no worker DF-e
 */
function enqueueDfeKeyDownload(accessKey, auditTrail) {
  const bIso = getBrasiliaIsoDanfe()
  try {
    const cmdCol = $app.findCollectionByNameOrId('dfe_command_queue')
    const cmdRec = new Record(cmdCol)
    cmdRec.set('command', 'busca_por_chave')
    cmdRec.set('params', {
      access_key: accessKey,
      audit_trail: auditTrail,
      requested_at: bIso,
    })
    cmdRec.set('status', 'pendente')
    cmdRec.set('created_by', '')
    $app.save(cmdRec)

    console.log(
      '[DANFE-PDF-COMMAND-ENQUEUED]',
      JSON.stringify({
        commandId: cmdRec.id,
        accessKey: accessKey,
        auditTrail: auditTrail,
      }),
    )
    return { success: true, commandId: cmdRec.id }
  } catch (err) {
    console.log('[DANFE-PDF-COMMAND-ERR]', String(err))
    return { success: false, error: String(err) }
  }
}

/**
 * Processa um PDF de DANFE.
 *
 * @param {Object} options
 * @param {string|Uint8Array} options.pdfSource - Caminho local, URL remota ou bytes do PDF
 * @param {string} options.sourceType - 'url' | 'path' | 'bytes'
 * @param {Object} options.auditTrail - { origin: 'whatsapp'|'email'|'upload', sender: string, fileName: string, messageId: string, url: string }
 * @returns {Object} { status: 'barrado_dedupe' | 'enfileirado_dfe' | 'fila_revisao' | 'erro', accessKey, reason }
 */
function processDanfePdf(options) {
  const { pdfSource, sourceType, auditTrail } = options
  const bIso = getBrasiliaIsoDanfe()
  const audit = auditTrail || {}

  let markdownText = ''

  try {
    if (sourceType === 'url') {
      const res = $http.send({
        url: pdfSource,
        method: 'GET',
        timeout: 40,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error('Falha HTTP ao baixar PDF: ' + res.statusCode)
      }
      markdownText = $documents.toMarkdown(res.body, 'danfe.pdf')
    } else if (sourceType === 'bytes') {
      markdownText = $documents.toMarkdown(pdfSource, audit.fileName || 'danfe.pdf')
    } else {
      // Local path
      markdownText = $documents.toMarkdown(pdfSource)
    }
  } catch (docErr) {
    console.log('[DANFE-PDF-DOC-CONVERT-ERR]', String(docErr), JSON.stringify(audit))
    const reason = 'PDF sem camada de texto — pedir XML ao fornecedor'
    sendToDanfeReviewQueue({
      reason: reason,
      auditTrail: audit,
      accessKey: '',
      itemType: 'excecao',
    })
    return {
      status: 'fila_revisao',
      reason: reason,
      error: String(docErr),
      auditTrail: audit,
    }
  }

  // Verificar se há camada de texto real
  const cleanText = (markdownText || '').trim()
  if (!cleanText || cleanText.length < 30) {
    const reason = 'PDF sem camada de texto — pedir XML ao fornecedor'
    console.log('[DANFE-PDF-NO-TEXT]', JSON.stringify({ length: cleanText.length, audit: audit }))
    sendToDanfeReviewQueue({
      reason: reason,
      auditTrail: audit,
      accessKey: '',
      itemType: 'excecao',
    })
    return {
      status: 'fila_revisao',
      reason: reason,
      textLength: cleanText.length,
      auditTrail: audit,
    }
  }

  // Extrair chaves candidatas
  const candidateKeys = extractNfeKeysFromText(cleanText)

  if (candidateKeys.length === 0) {
    const reason =
      'PDF possui texto, mas nenhuma chave de 44 dígitos da NF-e foi localizada — verificar documento'
    console.log(
      '[DANFE-PDF-NO-KEY-FOUND]',
      JSON.stringify({ textSample: cleanText.slice(0, 200), audit: audit }),
    )
    sendToDanfeReviewQueue({
      reason: reason,
      auditTrail: audit,
      accessKey: '',
      itemType: 'excecao',
    })
    return {
      status: 'fila_revisao',
      reason: reason,
      auditTrail: audit,
    }
  }

  // Validar formato e DV de cada chave candidata
  let validKey = null
  for (const k of candidateKeys) {
    if (validateNfeKeyDV(k)) {
      validKey = k
      break
    }
  }

  // Se nenhuma chave passou no DV da SEFAZ
  if (!validKey) {
    const candidateSample = candidateKeys[0]
    const reason =
      'Chave extraída do PDF com formato/dígito verificador inválido pela SEFAZ: ' + candidateSample
    console.log(
      '[DANFE-PDF-INVALID-KEY]',
      JSON.stringify({ candidates: candidateKeys, audit: audit }),
    )
    sendToDanfeReviewQueue({
      reason: reason,
      auditTrail: audit,
      accessKey: candidateSample,
      itemType: 'excecao',
    })
    return {
      status: 'fila_revisao',
      reason: reason,
      candidates: candidateKeys,
      auditTrail: audit,
    }
  }

  console.log(
    '[DANFE-PDF-KEY-EXTRACTED]',
    JSON.stringify({ accessKey: validKey, audit: audit, horarioBrasilia: bIso }),
  )

  // Deduplicação em 3 camadas: verificar se JÁ existe na tabela nfe_processed
  let existingProcessed = null
  try {
    existingProcessed = $app.findFirstRecordByFilter(
      'nfe_processed',
      "access_key = '" + validKey + "'",
    )
  } catch (_) {
    existingProcessed = null
  }

  if (existingProcessed) {
    const reason =
      'NF-e já processada anteriormente (ID: ' +
      existingProcessed.id +
      ', Chave: ' +
      validKey +
      ') — dedupe ativado'
    console.log(
      '[DANFE-PDF-DEDUPE-BLOCKED]',
      JSON.stringify({
        accessKey: validKey,
        existingId: existingProcessed.id,
        auditTrail: audit,
        horarioBrasilia: bIso,
      }),
    )
    return {
      status: 'barrado_dedupe',
      accessKey: validKey,
      existingId: existingProcessed.id,
      reason: reason,
      auditTrail: audit,
    }
  }

  // Verificar também se já há um comando pendente na dfe_command_queue para a mesma chave
  let pendingCmd = null
  try {
    pendingCmd = $app.findFirstRecordByFilter(
      'dfe_command_queue',
      "command = 'busca_por_chave' && status = 'pendente' && params ~ '" + validKey + "'",
    )
  } catch (_) {
    pendingCmd = null
  }

  if (pendingCmd) {
    const reason =
      'Comando de busca por chave já está pendente na fila do worker DF-e (ID: ' +
      pendingCmd.id +
      ')'
    console.log(
      '[DANFE-PDF-DEDUPE-COMMAND-EXISTS]',
      JSON.stringify({ accessKey: validKey, cmdId: pendingCmd.id }),
    )
    return {
      status: 'barrado_dedupe',
      accessKey: validKey,
      commandId: pendingCmd.id,
      reason: reason,
      auditTrail: audit,
    }
  }

  // Tudo validado! Enfileira o comando 'busca_por_chave' para o worker DF-e
  const cmdResult = enqueueDfeKeyDownload(validKey, audit)

  return {
    status: 'enfileirado_dfe',
    accessKey: validKey,
    commandId: cmdResult.commandId || null,
    auditTrail: audit,
    horarioBrasilia: bIso,
  }
}

const processorApi = {
  validateNfeKeyDV: validateNfeKeyDV,
  extractNfeKeysFromText: extractNfeKeysFromText,
  processDanfePdf: processDanfePdf,
  sendToDanfeReviewQueue: sendToDanfeReviewQueue,
  enqueueDfeKeyDownload: enqueueDfeKeyDownload,
}

// Disponibiliza no escopo global em múltiplos ambientes
try {
  if (typeof global !== 'undefined') {
    global.danfePdfProcessor = processorApi
  }
} catch (_) {}

try {
  if (typeof globalThis !== 'undefined') {
    globalThis.danfePdfProcessor = processorApi
  }
} catch (_) {}

try {
  danfePdfProcessor = processorApi
} catch (_) {}

if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = processorApi
}
if (typeof exports !== 'undefined' && exports) {
  exports.danfePdfProcessor = processorApi
  exports.validateNfeKeyDV = validateNfeKeyDV
  exports.extractNfeKeysFromText = extractNfeKeysFromText
  exports.processDanfePdf = processDanfePdf
  exports.sendToDanfeReviewQueue = sendToDanfeReviewQueue
  exports.enqueueDfeKeyDownload = enqueueDfeKeyDownload
}
