/**
 * worker-dfe/stateStore.js
 * Persistência local do ponteiro NSU do worker DF-e (FIX HEAP-OOM / NSU-PERSISTENTE).
 *
 * Problema resolvido: após crash (OOM) ou restart, o worker retomava do NSU-START
 * (0000000000000002) e revarria todo o backlog, estourando a memória novamente —
 * loop crash -> restart -> backlog -> crash. O ponteiro agora vive em um arquivo
 * de estado local (state.json, ao lado do config.json) e é gravado após CADA ciclo
 * bem-sucedido, garantindo retomada incremental mesmo após restart ou crash.
 *
 * Regras:
 * - Gravação ATÔMICA (arquivo temporário + rename) para não corromper o estado
 *   em caso de crash/queda de energia no meio da escrita.
 * - Histórico dos últimos ponteiros gravados (para auditoria/diagnóstico).
 * - Se o arquivo de estado não existir (primeira instalação ou state.json apagado),
 *   o valor do config.json é usado como fallback e isso é LOGADO no boot.
 * - Nunca lança exceção: falha de leitura/escrita de estado não pode derrubar o worker.
 */

const fs = require('fs')
const path = require('path')

const STATE_FILE_NAME = 'state.json'
const MAX_HISTORY_ENTRIES = 20

function getStateFilePath(workerDir) {
  return path.resolve(workerDir || __dirname, STATE_FILE_NAME)
}

function getBrasiliaTimestamp() {
  const d = new Date(Date.now() - 3 * 3600 * 1000)
  return d.toISOString().replace('Z', '-03:00')
}

function normalizeNsu(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim()
  if (!/^\d+$/.test(raw)) return ''
  return raw
}

/**
 * Lê o state.json cru (sem fallback). Retorna null se não existir/corrompido.
 */
function readState(workerDir) {
  const statePath = getStateFilePath(workerDir)
  if (!fs.existsSync(statePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (parsed && typeof parsed === 'object') return parsed
    return null
  } catch (err) {
    console.warn(
      `[STATE-READ-WARN] state.json corrompido ou ilegível (${err.message}). Será regravado no próximo ciclo bem-sucedido.`,
    )
    return null
  }
}

/**
 * Resolve o ultNSU de partida do worker:
 * 1. state.json (ponteiros persistidos ciclo a ciclo) — fonte primária;
 * 2. fallback: valor do config.json + LOG explícito.
 * NUNCA volta ao NSU-START após restart/crash quando houver arquivo de estado.
 */
function loadPersistedPointer(workerDir, configFallbackNsu) {
  const state = readState(workerDir)

  if (state && state.pointer && normalizeNsu(state.pointer.ult_nsu)) {
    return {
      ultNsu: normalizeNsu(state.pointer.ult_nsu),
      maxNsu: normalizeNsu(state.pointer.max_nsu),
      isInitialized: Boolean(state.pointer.is_initialized),
      source: 'state_file',
      savedAt: state.pointer.saved_at_brasilia || '',
      historySize: Array.isArray(state.history) ? state.history.length : 0,
    }
  }

  if (state && state.pointer && state.pointer.ult_nsu) {
    // Estado existe mas o NSU gravado é inválido/vazio — não usar, cair no fallback
    console.warn(
      `[STATE-READ-WARN] ponteiro em state.json inválido ("${state.pointer.ult_nsu}"). Usando fallback do config.`,
    )
  }

  const fallback = normalizeNsu(configFallbackNsu) || '0'
  console.warn(
    `[STATE-READ] state.json ausente ou sem ponteiro válido — usando fallback do config: ultNSU=${fallback}. ` +
      `O ponteiro será persistido em ${STATE_FILE_NAME} após o primeiro ciclo bem-sucedido.`,
  )
  return {
    ultNsu: fallback,
    maxNsu: '',
    isInitialized: null, // desconhecido: o ciclo decide pelo CRM
    source: 'config_fallback',
    savedAt: '',
    historySize: 0,
  }
}

/**
 * Grava (atomicamente) o ponteiro persistido após um ciclo bem-sucedido.
 * Faz merge com o estado anterior e mantém histórico dos últimos ponteiros.
 * Retorna true em caso de sucesso; em falha apenas loga (nunca derruba o ciclo).
 */
function persistPointer(workerDir, pointerData) {
  const statePath = getStateFilePath(workerDir)
  const ultNsu = normalizeNsu(pointerData && pointerData.ult_nsu)
  if (!ultNsu) return false

  const previous = readState(workerDir) || {}
  const nowBrasilia = getBrasiliaTimestamp()
  const nowIso = new Date().toISOString()

  const entry = {
    saved_at_brasilia: nowBrasilia,
    saved_at_iso: nowIso,
    ult_nsu: ultNsu,
    max_nsu: normalizeNsu(pointerData && pointerData.max_nsu) || '',
    is_initialized: Boolean(pointerData && pointerData.is_initialized),
    cstat_last: pointerData && pointerData.cstat_last ? String(pointerData.cstat_last) : '',
    worker_mode: pointerData && pointerData.worker_mode ? String(pointerData.worker_mode) : '',
  }

  const history = Array.isArray(previous.history) ? previous.history.slice() : []
  history.unshift(entry)
  while (history.length > MAX_HISTORY_ENTRIES) history.pop()

  const nextState = {
    schema_version: 1,
    pointer: {
      ult_nsu: entry.ult_nsu,
      max_nsu: entry.max_nsu,
      is_initialized: entry.is_initialized,
      cstat_last: entry.cstat_last,
      worker_mode: entry.worker_mode,
      saved_at_brasilia: entry.saved_at_brasilia,
      saved_at_iso: entry.saved_at_iso,
    },
    history,
  }

  try {
    const tmpPath = statePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(nextState, null, 2), 'utf8')
    fs.renameSync(tmpPath, statePath)
    return true
  } catch (err) {
    console.warn(
      `[STATE-WRITE-WARN] Falha ao persistir ponteiro em ${STATE_FILE_NAME}: ${err.message}. O worker continuará com o ponteiro em memória.`,
    )
    return false
  }
}

/**
 * Lista resumida dos últimos NSUs persistidos (para logs de boot/diagnóstico).
 */
function describeStateHistory(workerDir, limit = 5) {
  const state = readState(workerDir)
  if (!state || !Array.isArray(state.history) || state.history.length === 0) return []
  return state.history.slice(0, limit).map((h) => ({
    saved_at_brasilia: h.saved_at_brasilia || '',
    ult_nsu: h.ult_nsu || '',
    max_nsu: h.max_nsu || '',
    is_initialized: Boolean(h.is_initialized),
  }))
}

module.exports = {
  STATE_FILE_NAME,
  MAX_HISTORY_ENTRIES,
  getStateFilePath,
  readState,
  loadPersistedPointer,
  persistPointer,
  describeStateHistory,
  normalizeNsu,
}
