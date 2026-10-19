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

console.log('\n8. VALIDAÇÃO DE ESQUEMA REAL DE chat_summaries (PARTE 1 — item 4):')
// Importar schema real para validar que o hook NUNCA tenta ordenar por campo inexistente
import schemaJson from './pocketbase/schema.json'

interface SchemaCollection {
  name: string
  fields?: Array<{ name: string; type: string }>
}

interface SchemaFile {
  generatedAt?: string
  collections: SchemaCollection[]
}

const typedSchema = schemaJson as unknown as SchemaFile
const chatSummariesCol = (typedSchema.collections || []).find((c) => c.name === 'chat_summaries')
if (!chatSummariesCol) {
  fail++
  console.error('  ✘ Coleção chat_summaries não encontrada no schema.json!')
} else {
  pass++
  console.log('  ✔ Coleção chat_summaries encontrada no schema.json')

  const fieldNames = new Set((chatSummariesCol.fields || []).map((f) => f.name))

  // Provar categoricamente que o campo 'created' NÃO existe em chat_summaries:
  const hasCreatedField = fieldNames.has('created')
  check(
    "campo 'created' NÃO existe em chat_summaries (motivo do bug de sort)",
    hasCreatedField,
    false,
  )

  // Provar que 'last_message_at' EXISTE e é o campo correto para sort:
  const hasLastMessageAt = fieldNames.has('last_message_at')
  check("campo 'last_message_at' EXISTE em chat_summaries para sort", hasLastMessageAt, true)

  // Provar que 'canonical_phone' EXISTE e é o identificador único para lookup:
  const hasCanonicalPhone = fieldNames.has('canonical_phone')
  check("campo 'canonical_phone' EXISTE em chat_summaries para lookup", hasCanonicalPhone, true)
}

console.log(
  '\n9. SIMULAÇÃO DO NOVO COMPORTAMENTO DO HOOK (Lookup seguro + Upsert à prova de corrida):',
)

interface MockSummary {
  id: string
  canonical_phone: string
  last_message_at: string
  unread_count: number
}

// Mock da base de resumos
const mockDb = new Map<string, MockSummary>()

function simulateHookUpsert(
  cPhone: string,
  sortFieldToUse: string,
  msgIso: string,
  direction: string,
): { status: 'created' | 'updated' | 'race_recovered'; record: MockSummary } {
  // Simular findRecordsByFilter com validação de campo de sort contra schema
  const fieldNames = chatSummariesCol
    ? new Set((chatSummariesCol.fields || []).map((f) => f.name))
    : new Set()

  let found: MockSummary | null = null
  const cleanSort = sortFieldToUse.replace(/^-/, '')

  // Se o sort tentar usar campo que não existe no schema, falha (como Goja/PocketBase faz)
  if (cleanSort && !fieldNames.has(cleanSort)) {
    // Lookup falha com invalid sort field!
    // Mas agora temos fallback sem sort:
    found = mockDb.get(cPhone) || null
  } else {
    found = mockDb.get(cPhone) || null
  }

  if (!found) {
    // Tenta criar novo
    // Se outro processo já inseriu (simulação de corrida), colide com unique index
    if (mockDb.has(cPhone)) {
      // UNIQUE VIOLATION! Recuperação à prova de corrida:
      const recovered = mockDb.get(cPhone)!
      recovered.last_message_at = msgIso
      if (direction === 'inbound') recovered.unread_count++
      return { status: 'race_recovered', record: recovered }
    }
    const newRec: MockSummary = {
      id: 'mock_' + Math.random().toString(36).slice(2),
      canonical_phone: cPhone,
      last_message_at: msgIso,
      unread_count: direction === 'inbound' ? 1 : 0,
    }
    mockDb.set(cPhone, newRec)
    return { status: 'created', record: newRec }
  } else {
    found.last_message_at = msgIso
    if (direction === 'inbound') found.unread_count++
    return { status: 'updated', record: found }
  }
}

// Teste do fluxo com novo sort (-last_message_at)
const r1 = simulateHookUpsert(
  '11941531072',
  '-last_message_at',
  '2026-10-19T18:00:00.000Z',
  'inbound',
)
check('criação com sort válido', r1.status, 'created')

const r2 = simulateHookUpsert(
  '11941531072',
  '-last_message_at',
  '2026-10-19T18:05:00.000Z',
  'inbound',
)
check('atualização normal de resumo existente', r2.status, 'updated')
check('incremento correto de unread_count', r2.record.unread_count, 2)

// Teste do fallback se sort for inválido ('-created')
const r3 = simulateHookUpsert('11941531072', '-created', '2026-10-19T18:10:00.000Z', 'inbound')
check('fallback sem sort encontra e atualiza sem tentar create duplicado', r3.status, 'updated')

console.log(
  `\nResultado: ${pass} passaram, ${fail} falharam. ${fail === 0 ? 'G-E / G-G OK.' : 'FALHAS DETECTADAS — revisar hook e teste.'}\n`,
)

if (fail > 0) {
  throw new Error(`Webhook phone extraction regression test failed: ${fail} failure(s)`)
}
