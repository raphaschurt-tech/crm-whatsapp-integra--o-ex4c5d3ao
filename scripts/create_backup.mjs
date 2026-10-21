// Script para exportar backup completo de chat_summaries via PocketBase SDK e salvar em disco
import PocketBase from 'pocketbase'
import { writeFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

const PB_URL =
  process.env.VITE_POCKETBASE_URL ||
  'https://crm-whatsapp-integracao-aee3e.shrd03.internal.goskip.dev'

async function run() {
  const pb = new PocketBase(PB_URL)
  console.log('Conectando ao PocketBase:', PB_URL)

  const records = await pb.collection('chat_summaries').getFullList({
    sort: 'id',
    requestKey: null,
  })

  console.log(`Carregados ${records.length} registros de chat_summaries`)

  const cleanRecords = records.map((r) => {
    let lastSeen = r.last_seen_message_ids
    if (lastSeen && typeof lastSeen === 'object' && !Array.isArray(lastSeen)) {
      try {
        lastSeen = Array.from(lastSeen)
      } catch (_) {}
    }
    return {
      id: r.id,
      canonical_phone: r.canonical_phone,
      raw_phone: r.raw_phone,
      last_message_preview: r.last_message_preview,
      last_message_direction: r.last_message_direction,
      last_message_at: r.last_message_at,
      first_message_at: r.first_message_at,
      unread_count: r.unread_count,
      tem_mensagens: r.tem_mensagens,
      last_message_id: r.last_message_id,
      last_seen_message_ids: lastSeen,
      created: r.created,
      updated: r.updated,
    }
  })

  const jsonStr = JSON.stringify(cleanRecords, null, 2)
  const sha256 = createHash('sha256').update(jsonStr).digest('hex')

  mkdirSync('pocketbase/backups', { recursive: true })
  const backupPath = 'pocketbase/backups/chat_summaries_backup_pre_bug1_20261021.json'
  writeFileSync(backupPath, jsonStr, 'utf-8')

  console.log(`[BACKUP-OK] Arquivo salvo: ${backupPath}`)
  console.log(`[BACKUP-OK] Total registros: ${cleanRecords.length}`)
  console.log(`[BACKUP-OK] SHA-256: ${sha256}`)

  const corrupted = cleanRecords.filter((r) => {
    const arr = r.last_seen_message_ids
    return Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'number'
  })
  console.log(`[BACKUP-OK] Registros com byte-lixo detectados: ${corrupted.length}`)
  console.log(
    'IDs com byte-lixo:',
    corrupted.map((r) => `${r.id} (${r.canonical_phone})`).join(', '),
  )
}

run().catch((err) => {
  console.error('[BACKUP-ERROR]', err)
  process.exit(1)
})
