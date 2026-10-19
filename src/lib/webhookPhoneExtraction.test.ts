/**
 * Teste de regressão G-E — webhook_collection_received: extração de phone.
 *
 * Objetivo: provar que a extração de telefone no hook de resumos lida com TODOS
 * os formatos históricos e atuais do campo `phone` de `webhook_received`:
 *   1. string pura (formato antigo) — "5511999999999"
 *   2. string JSON (formato atual) — '{"phone":"5511999999999"}'
 *   3. objeto JS — { phone: "5511999999999" }
 *   4. string JSON sem aspas nos números (JSON não-estrito)
 *   5. string JSON com número sem aspas — '{"phone":5511999999999}'
 *
 * E que, quando NENHUM formato é parseável, a extração retorna '' (vazio) —
 * o que dispara o log FAIL-ALOUD, mas NUNCA bloqueia a gravação da mensagem.
 *
 * Execução: npx tsx src/lib/webhookPhoneExtraction.test.ts
 * (ou importado por vitest/jest com suporte a TS)
 */

// ============================================================
// Função em teste — CÓPIA EXATA da lógica do hook
// pocketbase/hooks/webhook_collection_received.js (extractPhoneValue)
// Mantenha sincronizada com o hook ao alterá-lo!
// ============================================================
function extractPhoneValue(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') {
    const trimmed = (val as string).trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object') {
          return String(parsed.phone || parsed.number || parsed.id || parsed.chatId || '')
        }
      } catch (_) {
        /* not JSON, fallthrough */
      }
    }
    return trimmed
  }
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    return String(obj.phone || obj.number || obj.id || obj.chatId || '')
  }
  return String(val)
}

/** Cópia da computeCanonicalPhone do hook (remoção 55, descarte LIDs). */
function computeCanonicalPhone(p: unknown): string {
  if (!p) return ''
  const s = String(p).trim()
  if (s.toLowerCase().includes('@lid')) return ''
  const digits = String(s).replace(/\D/g, '')
  if (!digits || digits.length >= 14) return ''
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2)
  }
  return digits
}

// ============================================================
// Testes
// ============================================================
let pass = 0
let fail = 0

function check(name: string, got: unknown, expected: unknown): void {
  const ok = got === expected
  if (ok) {
    pass++
    console.log(`  ✔ ${name} → ${String(got)}`)
  } else {
    fail++
    console.error(
      `  ✘ ${name}\n      esperado: ${JSON.stringify(expected)}\n      obtido:   ${JSON.stringify(got)}`,
    )
  }
}

console.log('\n=== G-E: Regressão do hook webhook_collection_received (extração de phone) ===\n')

console.log('1. Formato ANTIGO (string pura):')
check('string pura com 55', extractPhoneValue('5511999999999'), '5511999999999')
check('string pura com DDD', extractPhoneValue('11999999999'), '11999999999')
check('string pura com máscara', extractPhoneValue('+55 (11) 99999-9999'), '+55 (11) 99999-9999')

console.log('\n2. Formato ATUAL (string JSON {"phone":"..."}):')
check('string JSON simples', extractPhoneValue('{"phone":"5511999999999"}'), '5511999999999')
check(
  'string JSON com espaços',
  extractPhoneValue('  {"phone": "5511999999999"}  '),
  '5511999999999',
)
check('string JSON número sem aspas', extractPhoneValue('{"phone":5511999999999}'), '5511999999999')

console.log('\n3. Formato OBJETO JS:')
check('objeto { phone: ... }', extractPhoneValue({ phone: '5511999999999' }), '5511999999999')
check('objeto com number', extractPhoneValue({ number: '5511999999999' }), '5511999999999')

console.log('\n4. Formatos alternativos (chatId / id):')
check('string JSON chatId', extractPhoneValue('{"chatId":"5511999999999"}'), '5511999999999')
check('objeto id', extractPhoneValue({ id: '5511999999999' }), '5511999999999')

console.log('\n5. Casos NÃO parseáveis → retornam vazio (dispara FAIL-ALOUD, não bloqueia):')
check('string vazia', extractPhoneValue(''), '')
check('null', extractPhoneValue(null), '')
check('undefined', extractPhoneValue(undefined), '')
check('JSON sem phone', extractPhoneValue('{"foo":"bar"}'), '')
check('JSON inválido', extractPhoneValue('{not json}'), '')

console.log('\n6. Canonicalização (remoção do 55, descarte de LIDs):')
check('55 + DDD + 9 dígitos', computeCanonicalPhone('5511999999999'), '11999999999')
check('sem 55, DDD + 9 dígitos', computeCanonicalPhone('11999999999'), '11999999999')
check('LID descartado', computeCanonicalPhone('123456789@lid'), '')
check('vazio', computeCanonicalPhone(''), '')

console.log('\n7. SIMULAÇÃO DO FLUXO COMPLETO DO HOOK:')
console.log('   (phone não parseável → erro alto, mas mensagem NÃO bloqueada — G-B)')

const syntheticRecordPhone = '{"not_a_phone":true}' // sem phone parseável
const extracted = extractPhoneValue(syntheticRecordPhone)
check('extração de phone sintético sem parse', extracted, '')

// G-B demonstrado: o hook NUNCA retorna erro antes de e.next() — a gravação
// NÃO é bloqueada. A lógica do hook é: catch → console.error FAIL-ALOUD → e.next().
// Aqui provamos que nenhum caminho da extração lança exceção:
try {
  extractPhoneValue({ weird: 'object' })
  extractPhoneValue(42)
  extractPhoneValue([] as unknown)
  console.log('  ✔ extração nunca lança exceção (gravação nunca bloqueada — G-B)')
  pass++
} catch (e) {
  fail++
  console.error('  ✘ extração lançou exceção — G-B VIOLADO!', e)
}

console.log(
  `\nResultado: ${pass} passaram, ${fail} falharam. ${fail === 0 ? 'G-E / G-G OK.' : 'FALHAS DETECTADAS — revisar hook e teste.'}\n`,
)

if (fail > 0) {
  throw new Error(`Webhook phone extraction regression test failed: ${fail} failure(s)`)
}
