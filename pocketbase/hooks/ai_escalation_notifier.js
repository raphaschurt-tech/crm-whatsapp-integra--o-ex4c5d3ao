// ============================================
// HELPER DE NOTIFICAÇÃO DE ESCALADA VIA WHATSAPP — Fase 7
// Quando ocorre uma escalada para humano:
//   (a) Camada 3 detecta tom sensível / [TRANSFERIR-HUMANO] (reclamacao, nota, cobranca, aplicacao, etc.)
//   (b) Cliente digita /atendente
// Envia ADICIONALMENTE uma mensagem WhatsApp curta para 11947518805
// usando a mesma integração Z-API já existente no projeto.
//
// Regras obrigatórias:
// 1. Mensagem curta em tom de alerta interno:
//    "🔔 ESCALADA — Cliente <Nome> (<Telefone>) | Motivo: <motivo> | Assunto: <assunto> | <HH:mm>"
// 2. Horário em Brasília (UTC-3).
// 3. Dedupe simples: não notificar duplicado se o mesmo telefone+motivo
//    escalar na janela de 5 minutos.
// 4. Tolerante a falha: se o envio Z-API falhar, apenas loga e NUNCA bloqueia
//    nem atrasa a escalada do cliente.
// 5. Exportado em escopo global (função de topo + globalThis.__aiEscalationNotifier + globalThis.notifyEscalation)
//    para resolução garantida em qualquer VM/callback do PocketBase.
// ============================================

const TARGET_ESCALATION_PHONE = '5511947518805'
const DEDUPE_WINDOW_MS = 5 * 60 * 1000 // 5 minutos

// Armazena no escopo do hook os timestamps dos últimos envios por chave telefone+motivo
const recentEscalations = new Map()

function safeStr(v) {
  return v === undefined || v === null ? '' : String(v).trim()
}

function canonicalDigits(p) {
  const s = String(p || '').replace(/\D/g, '')
  if (s.startsWith('55') && s.length >= 12) return s.slice(2)
  return s
}

function formatBrasiliaTime(dateObj) {
  try {
    const d = dateObj || new Date()
    const utcMs = d.getTime()
    const spMs = utcMs - 3 * 3600 * 1000
    const spDate = new Date(spMs)
    const hh = String(spDate.getUTCHours()).padStart(2, '0')
    const mm = String(spDate.getUTCMinutes()).padStart(2, '0')
    return hh + ':' + mm
  } catch (_) {
    return '00:00'
  }
}

function formatPhoneDisplay(phone) {
  const digits = canonicalDigits(phone)
  if (digits.length === 11) {
    return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7)
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6)
  }
  return phone || 'sem telefone'
}

function resolveCustomerName($app, phone) {
  if (!$app || !phone) return ''
  try {
    const p1 = String(phone).replace(/\D/g, '')
    const p2 = canonicalDigits(phone)
    const found = $app.findRecordsByFilter(
      'customers',
      'phone ~ {:p1} || phone ~ {:p2}',
      '-created',
      1,
      0,
      { p1: p1, p2: p2 },
    )
    if (found && found.length > 0) {
      const rawName = safeStr(found[0].getString('name') || found[0].getString('contact_name'))
      const isDigitsOrPhone = /^[0-9+\s()-]+$/.test(rawName) || rawName === phone
      if (rawName && !isDigitsOrPhone) {
        return rawName
      }
    }
  } catch (err) {
    console.log('[ESCALATION-NOTIFIER-NAME-ERR]', err.message || String(err))
  }
  return ''
}

function extractSubject($app, phone, incomingText, aiReply) {
  // 1. Tenta extrair a partir do incomingText se houver texto claro
  const text = safeStr(incomingText)
  if (text && text !== '/atendente' && text.length > 3) {
    // Limpa quebras de linha e limita tamanho para manter a notificação curta
    const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
    if (clean.length > 80) {
      return clean.slice(0, 77) + '...'
    }
    return clean
  }

  // 2. Tenta extrair de chat_summaries caso incomingText seja vazio ou apenas comando
  if ($app && phone) {
    try {
      const canon = canonicalDigits(phone)
      const sums = $app.findRecordsByFilter(
        'chat_summaries',
        'canonical_phone = {:cp}',
        '-created',
        1,
        0,
        { cp: canon },
      )
      if (sums && sums.length > 0) {
        const preview = safeStr(sums[0].getString('last_message_preview'))
        if (preview && preview !== '/atendente' && preview.length > 3) {
          const clean = preview.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
          if (clean.length > 80) return clean.slice(0, 77) + '...'
          return clean
        }
      }
    } catch (_) {}
  }

  // 3. Fallback inteligente baseado no aiReply se houver menção
  if (aiReply) {
    const cleanReply = safeStr(aiReply).replace(/[\r\n]+/g, ' ')
    if (cleanReply.length > 80) return cleanReply.slice(0, 77) + '...'
    if (cleanReply) return cleanReply
  }

  return 'solicitação de atendimento humano'
}

function buildNotificationMessage(data) {
  const nome = safeStr(data.customerName)
  const telDisplay = formatPhoneDisplay(data.phone)
  const clienteParte = nome ? nome + ' (' + telDisplay + ')' : telDisplay
  const motivo = safeStr(data.reason) || 'atendimento_humano'
  const assunto = safeStr(data.subject) || 'solicitação de atendimento'
  const horario = safeStr(data.timeStr) || formatBrasiliaTime(new Date())

  return (
    '🔔 ESCALADA — Cliente ' +
    clienteParte +
    ' | Motivo: ' +
    motivo +
    ' | Assunto: ' +
    assunto +
    ' | ' +
    horario
  )
}

function checkDedupe(phone, reason) {
  const now = Date.now()
  const canon = canonicalDigits(phone)
  const key = canon + ':' + safeStr(reason)

  // Limpeza de itens antigos no Map (> 10 minutos)
  for (const [k, ts] of recentEscalations.entries()) {
    if (now - ts > 10 * 60 * 1000) {
      recentEscalations.delete(k)
    }
  }

  const lastTs = recentEscalations.get(key)
  if (lastTs && now - lastTs < DEDUPE_WINDOW_MS) {
    return false // Duplicado na janela de 5 min
  }
  recentEscalations.set(key, now)
  return true // Pode enviar
}

function getZapiConfig($app) {
  try {
    const records = $app.findRecordsByFilter(
      'settings',
      "zapi_instance_id != '' && zapi_token != '' && zapi_client_token != ''",
      '-created',
      1,
      0,
    )
    if (records && records.length > 0) {
      const r = records[0]
      return {
        instance: safeStr(r.getString('zapi_instance_id')),
        token: safeStr(r.getString('zapi_token')),
        clientToken: safeStr(r.getString('zapi_client_token')),
      }
    }
  } catch (err) {
    console.log('[ESCALATION-NOTIFIER-CONFIG-ERR]', err.message || String(err))
  }
  return null
}

function notifyEscalation(params) {
  const opts = params || {}
  const $app = opts.$app
  const phone = safeStr(opts.phone)
  const reason = safeStr(opts.reason) || 'atendimento_humano'
  const incomingText = safeStr(opts.incomingText)
  const aiReply = safeStr(opts.aiReply)

  if (!phone) {
    console.log('[ESCALATION-NOTIFIER-SKIP] Telefone não informado.')
    return { sent: false, skipped: true, reason: 'missing_phone' }
  }

  // 1. Dedupe em memória
  if (!checkDedupe(phone, reason)) {
    console.log(
      '[ESCALATION-NOTIFIER-DEDUPE]',
      JSON.stringify({
        phone: phone,
        reason: reason,
        message: 'Notificação suprimida por dedupe (janela de 5 min).',
      }),
    )
    return { sent: false, skipped: true, reason: 'dedupe_suppressed' }
  }

  // 2. Extração de nome e assunto
  const customerName = resolveCustomerName($app, phone)
  const subject = extractSubject($app, phone, incomingText, aiReply)
  const timeStr = formatBrasiliaTime(new Date())

  const message = buildNotificationMessage({
    customerName: customerName,
    phone: phone,
    reason: reason,
    subject: subject,
    timeStr: timeStr,
  })

  console.log(
    '[ESCALATION-NOTIFIER-PREPARED]',
    JSON.stringify({
      target: TARGET_ESCALATION_PHONE,
      clientPhone: phone,
      customerName: customerName,
      reason: reason,
      subject: subject,
      horarioBrasilia: timeStr,
      message: message,
    }),
  )

  // 3. Envio via Z-API usando as mesmas credenciais do settings
  if (!$app) {
    return { sent: false, error: 'missing_$app', message: message }
  }

  const cfg = getZapiConfig($app)
  if (!cfg || !cfg.instance || !cfg.token || !cfg.clientToken) {
    console.log('[ESCALATION-NOTIFIER-WARN] Z-API não configurada em settings.')
    return { sent: false, error: 'zapi_not_configured', message: message }
  }

  try {
    const zapiSendUrl =
      'https://api.z-api.io/instances/' +
      encodeURIComponent(cfg.instance) +
      '/token/' +
      encodeURIComponent(cfg.token) +
      '/send-text'

    const res = $http.send({
      url: zapiSendUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': cfg.clientToken,
      },
      body: JSON.stringify({
        phone: TARGET_ESCALATION_PHONE,
        message: message,
      }),
      timeout: 10,
    })

    const status = res.statusCode
    const success = status >= 200 && status < 300
    if (success) {
      console.log(
        '[ESCALATION-NOTIFIER-SENT]',
        JSON.stringify({
          target: TARGET_ESCALATION_PHONE,
          status: status,
          clientPhone: phone,
          reason: reason,
        }),
      )
      return { sent: true, status: status, message: message }
    } else {
      const bodyStr = String(res.body || '')
      console.log(
        '[ESCALATION-NOTIFIER-FAILED]',
        JSON.stringify({
          target: TARGET_ESCALATION_PHONE,
          status: status,
          body: bodyStr,
          clientPhone: phone,
        }),
      )
      return { sent: false, status: status, error: bodyStr, message: message }
    }
  } catch (httpErr) {
    const errStr = httpErr.message || String(httpErr)
    console.log(
      '[ESCALATION-NOTIFIER-HTTP-ERR]',
      JSON.stringify({
        target: TARGET_ESCALATION_PHONE,
        error: errStr,
        clientPhone: phone,
      }),
    )
    return { sent: false, error: errStr, message: message }
  }
}

// Objeto de exportação
const escalationNotifierApi = {
  TARGET_ESCALATION_PHONE: TARGET_ESCALATION_PHONE,
  formatBrasiliaTime: formatBrasiliaTime,
  formatPhoneDisplay: formatPhoneDisplay,
  resolveCustomerName: resolveCustomerName,
  extractSubject: extractSubject,
  buildNotificationMessage: buildNotificationMessage,
  checkDedupe: checkDedupe,
  notifyEscalation: notifyEscalation,
}

// Disponibilização em globalThis, global e escopo de módulos
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.__aiEscalationNotifier = escalationNotifierApi
    globalThis.notifyEscalation = notifyEscalation
  }
} catch (_) {}

try {
  if (typeof global !== 'undefined') {
    global.__aiEscalationNotifier = escalationNotifierApi
    global.notifyEscalation = notifyEscalation
  }
} catch (_) {}

if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = escalationNotifierApi
}
if (typeof exports !== 'undefined' && exports) {
  exports.__aiEscalationNotifier = escalationNotifierApi
  exports.notifyEscalation = notifyEscalation
}

// Execução de autoteste funcional no ciclo de bootstrap do PocketBase
if (typeof onBootstrap === 'function') {
  onBootstrap((e) => {
    e.next()
    try {
      const fn =
        (typeof notifyEscalation === 'function' && notifyEscalation) ||
        (typeof globalThis !== 'undefined' &&
          globalThis.__aiEscalationNotifier &&
          typeof globalThis.__aiEscalationNotifier.notifyEscalation === 'function' &&
          globalThis.__aiEscalationNotifier.notifyEscalation) ||
        null

      if (fn) {
        const testRes = fn({
          $app: $app,
          phone: '11999990000',
          reason: 'reclamacao',
          incomingText: 'peça com prazo estourado e defeito',
          aiReply: '',
        })
        console.log('[ESCALATION-BOOT-PROBE]', JSON.stringify(testRes))
      } else {
        console.log('[ESCALATION-BOOT-PROBE-ERR] notifyEscalation is not defined')
      }
    } catch (bootErr) {
      console.log('[ESCALATION-BOOT-PROBE-ERR]', bootErr.message || String(bootErr))
    }
  })
}

// Rota de teste/diagnóstico interno para prova funcional segura
if (typeof routerAdd === 'function') {
  try {
    routerAdd('POST', '/backend/v1/ai/test-escalation-notify', (e) => {
      let reqBody = {}
      try {
        reqBody = e.requestInfo().body || {}
      } catch (_) {}

      const testPhone = safeStr(reqBody.phone) || '11999990000'
      const testReason = safeStr(reqBody.reason) || 'reclamacao'
      const testIncoming = safeStr(reqBody.incomingText) || 'peça veio com defeito e prazo estourou'
      const bypassDedupe = Boolean(reqBody.bypassDedupe)

      if (bypassDedupe) {
        const canon = canonicalDigits(testPhone)
        recentEscalations.delete(canon + ':' + testReason)
      }

      const res = notifyEscalation({
        $app: $app,
        phone: testPhone,
        reason: testReason,
        incomingText: testIncoming,
        aiReply: '',
      })

      return e.json(200, {
        ok: true,
        endpoint: '/backend/v1/ai/test-escalation-notify',
        result: res,
      })
    })
  } catch (rErr) {
    console.log('[ESCALATION-NOTIFIER-ROUTER-ERR]', rErr.message || String(rErr))
  }
}
