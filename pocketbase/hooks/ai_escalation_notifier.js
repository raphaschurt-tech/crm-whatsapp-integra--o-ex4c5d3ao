// ============================================
// pocketbase/hooks/ai_escalation_notifier.js
// NOTIFICADOR DE ESCALADA VIA WHATSAPP — Fase 7
// ============================================
// Regra fundamental do PocketBase JSVM:
// "Hook scoping error: top-level declarations are referenced inside callbacks —
// PocketBase's JSVM executes callbacks in a separate VM pool, so top-level
// functions and variables are not accessible at runtime".
//
// Conclusão arquitetural:
// 1. NENHUMA função ou variável referenciada nos callbacks (routerAdd, cronAdd, etc.)
//    pode ser declarada no top-level do arquivo.
// 2. A lógica central de envio e dedupe fica exposta via função inline encapsulada em
//    globalThis.__aiEscalationNotifier = { notifyEscalation: ... } e globalThis.notifyEscalation.
// 3. Cada callback (routerAdd, onBootstrap) possui sua própria implementação estritamente
//    INLINE ou resolve estritamente em tempo de execução via globalThis sem fecho léxico top-level.
// 4. O dedupe de 5 minutos (não repetir notificação da mesma escalada por telefone+motivo)
//    é armazenado em chat_control (ou memória no globalThis / settings) de forma persistente
//    ou inline.
// 5. Destino da notificação: 5511947518805 via Z-API /send-text (credenciais lidas de settings).
// 6. Formato obrigatório:
//    "🔔 ESCALADA — Cliente <Nome> (<Telefone>) | Motivo: <motivo> | Assunto: <assunto> | <HH:mm>"
// 7. Horário Brasília (UTC-3).
// 8. Tolerante a erros: NUNCA bloqueia a escalada.
// ============================================

;(function () {
  try {
    if (typeof globalThis === 'undefined') return

    // Objeto de dedupe em globalThis para persistir entre chamadas na mesma instância
    if (!globalThis.__aiEscalationRecentMap) {
      globalThis.__aiEscalationRecentMap = {}
    }

    const TARGET_ESCALATION_PHONE = '5511947518805'
    const DEDUPE_WINDOW_MS = 5 * 60 * 1000 // 5 minutos

    const coreNotifyEscalation = function (opts) {
      try {
        const o = opts || {}
        const $pbApp = o.$app || (typeof $app !== 'undefined' ? $app : null)
        const phone = o.phone ? String(o.phone).trim() : ''
        const reason = o.reason ? String(o.reason).trim() : 'atendimento_humano'
        const incomingText = o.incomingText ? String(o.incomingText).trim() : ''
        const aiReply = o.aiReply ? String(o.aiReply).trim() : ''

        if (!phone) {
          console.log('[ESCALATION-NOTIFIER-SKIP] Telefone não informado.')
          return { sent: false, skipped: true, reason: 'missing_phone' }
        }

        // Canonical phone
        let canonPhone = phone.replace(/\D/g, '')
        if (canonPhone.startsWith('55') && canonPhone.length >= 12) {
          canonPhone = canonPhone.slice(2)
        }

        // 1. Dedupe em memória (5 minutos por telefone+motivo)
        const dedupeKey = canonPhone + ':' + reason
        const nowMs = Date.now()
        if (globalThis.__aiEscalationRecentMap) {
          const lastSent = globalThis.__aiEscalationRecentMap[dedupeKey] || 0
          if (nowMs - lastSent < DEDUPE_WINDOW_MS) {
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
        }

        // 2. Horário de Brasília (UTC-3)
        let timeStr = '00:00'
        try {
          const spDate = new Date(Date.now() - 3 * 3600 * 1000)
          const hh = String(spDate.getUTCHours()).padStart(2, '0')
          const mm = String(spDate.getUTCMinutes()).padStart(2, '0')
          timeStr = hh + ':' + mm
        } catch (_) {}

        // 3. Resolução do Nome do Cliente
        let customerName = ''
        if ($pbApp && canonPhone) {
          try {
            const rawDigits = phone.replace(/\D/g, '')
            const foundCusts = $pbApp.findRecordsByFilter(
              'customers',
              'phone ~ {:p1} || phone ~ {:p2}',
              '-created',
              1,
              0,
              { p1: rawDigits, p2: canonPhone },
            )
            if (foundCusts && foundCusts.length > 0) {
              const rawName = String(
                foundCusts[0].getString('name') || foundCusts[0].getString('contact_name') || '',
              ).trim()
              const isDigits = /^[0-9+\s()-]+$/.test(rawName) || rawName === phone
              if (rawName && !isDigits) {
                customerName = rawName
              }
            }
          } catch (cErr) {
            console.log('[ESCALATION-NOTIFIER-NAME-ERR]', String(cErr))
          }
        }

        // 4. Formatação de exibição do telefone
        let phoneDisplay = phone
        if (canonPhone.length === 11) {
          phoneDisplay =
            '(' + canonPhone.slice(0, 2) + ') ' + canonPhone.slice(2, 7) + '-' + canonPhone.slice(7)
        } else if (canonPhone.length === 10) {
          phoneDisplay =
            '(' + canonPhone.slice(0, 2) + ') ' + canonPhone.slice(2, 6) + '-' + canonPhone.slice(6)
        }

        // 5. Extração de Assunto
        let subject = ''
        if (incomingText && incomingText !== '/atendente' && incomingText.length > 3) {
          const clean = incomingText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
          subject = clean.length > 80 ? clean.slice(0, 77) + '...' : clean
        } else if ($pbApp && canonPhone) {
          try {
            const sums = $pbApp.findRecordsByFilter(
              'chat_summaries',
              'canonical_phone = {:cp}',
              '-created',
              1,
              0,
              { cp: canonPhone },
            )
            if (sums && sums.length > 0) {
              const preview = String(sums[0].getString('last_message_preview') || '').trim()
              if (preview && preview !== '/atendente' && preview.length > 3) {
                const clean = preview.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
                subject = clean.length > 80 ? clean.slice(0, 77) + '...' : clean
              }
            }
          } catch (_) {}
        }
        if (!subject) {
          if (reason === 'reclamacao') subject = 'Reclamação ou insatisfação com atendimento/peça'
          else if (reason === 'nota') subject = 'Problema ou dúvida sobre nota fiscal / DANFE'
          else if (reason === 'cobranca')
            subject = 'Dúvida ou solicitação sobre cobrança/financeiro'
          else if (reason === 'interesse_compra') subject = 'Interesse de compra / cotação formal'
          else if (reason === 'aplicacao')
            subject = 'Dúvida de aplicação de peça (requer atendente)'
          else if (reason === 'comando_atendente') subject = 'Cliente solicitou atendente humano'
          else subject = 'Solicitação de atendimento humano'
        }

        // Mapeamento de rótulo do motivo
        let reasonLabel = reason
        if (reason === 'reclamacao') reasonLabel = 'Reclamação'
        else if (reason === 'nota') reasonLabel = 'Nota Fiscal'
        else if (reason === 'cobranca') reasonLabel = 'Cobrança'
        else if (reason === 'interesse_compra') reasonLabel = 'Interesse de Compra'
        else if (reason === 'aplicacao') reasonLabel = 'Aplicação de Peça'
        else if (reason === 'comando_atendente') reasonLabel = 'Solicitado pelo Cliente'

        // 6. Montagem da mensagem obrigatória
        const clientPart = customerName ? customerName + ' (' + phoneDisplay + ')' : phoneDisplay
        const finalMessage =
          '🔔 ESCALADA — Cliente ' +
          clientPart +
          ' | Motivo: ' +
          reasonLabel +
          ' | Assunto: ' +
          subject +
          ' | ' +
          timeStr

        console.log(
          '[ESCALATION-NOTIFIER-PREPARED]',
          JSON.stringify({
            target: TARGET_ESCALATION_PHONE,
            clientPhone: phone,
            customerName: customerName,
            reason: reason,
            subject: subject,
            horarioBrasilia: timeStr,
            message: finalMessage,
          }),
        )

        // Grava no dedupe
        if (globalThis.__aiEscalationRecentMap) {
          globalThis.__aiEscalationRecentMap[dedupeKey] = nowMs
        }

        if (!$pbApp) {
          return { sent: false, error: 'missing_$app', message: finalMessage }
        }

        // 7. Leitura da configuração Z-API em settings
        let zapiCfg = null
        try {
          const setRecs = $pbApp.findRecordsByFilter('settings', 'id != ""', '-created', 1, 0)
          if (setRecs && setRecs.length > 0) {
            const s = setRecs[0]
            const inst = String(s.getString('zapi_instance_id') || '').trim()
            const tok = String(s.getString('zapi_token') || '').trim()
            const clTok = String(s.getString('zapi_client_token') || '').trim()
            if (inst && tok && clTok) {
              zapiCfg = { instance: inst, token: tok, clientToken: clTok }
            }
          }
        } catch (setErr) {
          console.log('[ESCALATION-NOTIFIER-SETTINGS-ERR]', String(setErr))
        }

        if (!zapiCfg) {
          console.log('[ESCALATION-NOTIFIER-WARN] Z-API não configurada em settings.')
          return { sent: false, error: 'zapi_not_configured', message: finalMessage }
        }

        // 8. Envio Z-API estritamente protegido
        try {
          const zapiSendUrl =
            'https://api.z-api.io/instances/' +
            encodeURIComponent(zapiCfg.instance) +
            '/token/' +
            encodeURIComponent(zapiCfg.token) +
            '/send-text'

          const res = $http.send({
            url: zapiSendUrl,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Token': zapiCfg.clientToken,
            },
            body: JSON.stringify({
              phone: TARGET_ESCALATION_PHONE,
              message: finalMessage,
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
            return { sent: true, status: status, message: finalMessage }
          } else {
            const bodyStr = String(res.body || '')
            console.log(
              '[ESCALATION-NOTIFIER-FAILED]',
              JSON.stringify({
                target: TARGET_ESCALATION_PHONE,
                status: status,
                body: bodyStr.slice(0, 200),
                clientPhone: phone,
              }),
            )
            return { sent: false, status: status, error: bodyStr, message: finalMessage }
          }
        } catch (httpErr) {
          console.log('[ESCALATION-NOTIFIER-FAILED]', String(httpErr))
          return { sent: false, error: String(httpErr), message: finalMessage }
        }
      } catch (fatalErr) {
        console.log('[ESCALATION-NOTIFIER-FATAL-ERR]', String(fatalErr))
        return { sent: false, error: String(fatalErr) }
      }
    }

    globalThis.__aiEscalationNotifier = {
      notifyEscalation: coreNotifyEscalation,
    }
    globalThis.notifyEscalation = coreNotifyEscalation
  } catch (initErr) {
    console.log('[ESCALATION-NOTIFIER-INIT-ERR]', String(initErr))
  }
})()

// Rota de teste/diagnóstico interno para prova funcional segura (TUDO INLINE)
if (typeof routerAdd === 'function') {
  try {
    routerAdd('POST', '/backend/v1/ai/test-escalation-notify', (e) => {
      let reqBody = {}
      try {
        reqBody = e.requestInfo().body || {}
      } catch (_) {}

      const testPhone = reqBody.phone ? String(reqBody.phone).trim() : '11999990000'
      const testReason = reqBody.reason ? String(reqBody.reason).trim() : 'reclamacao'
      const testIncoming = reqBody.incomingText
        ? String(reqBody.incomingText).trim()
        : 'peça veio com defeito e prazo estourou'
      const bypassDedupe = Boolean(reqBody.bypassDedupe)

      if (bypassDedupe && typeof globalThis !== 'undefined' && globalThis.__aiEscalationRecentMap) {
        let cp = testPhone.replace(/\D/g, '')
        if (cp.startsWith('55') && cp.length >= 12) cp = cp.slice(2)
        delete globalThis.__aiEscalationRecentMap[cp + ':' + testReason]
      }

      let res = null
      if (
        typeof globalThis !== 'undefined' &&
        globalThis.__aiEscalationNotifier &&
        typeof globalThis.__aiEscalationNotifier.notifyEscalation === 'function'
      ) {
        res = globalThis.__aiEscalationNotifier.notifyEscalation({
          $app: $app,
          phone: testPhone,
          reason: testReason,
          incomingText: testIncoming,
          aiReply: '',
        })
      } else if (
        typeof globalThis !== 'undefined' &&
        typeof globalThis.notifyEscalation === 'function'
      ) {
        res = globalThis.notifyEscalation({
          $app: $app,
          phone: testPhone,
          reason: testReason,
          incomingText: testIncoming,
          aiReply: '',
        })
      } else {
        res = { sent: false, error: 'notifyEscalation_not_loaded' }
      }

      return e.json(200, {
        ok: true,
        endpoint: '/backend/v1/ai/test-escalation-notify',
        result: res,
      })
    })
  } catch (rErr) {
    console.log('[ESCALATION-NOTIFIER-ROUTER-ERR]', String(rErr))
  }
}
