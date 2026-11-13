/// <reference path="../pb_data/types.d.ts" />
// 0156 — Correção 1: saneamento de settings.allowed_families
// Lê o array, mantém apenas valores que existem em products.sou_family
// (mesma normalização do funil da IA: sem acento, minúsculo, espaços colapsados).
// Se sobrar vazio, grava [] (aceitável porque a Parte 2 cria a proteção por
// família de insumo via settings.ai_blocked_families). Guarda o valor antigo
// em settings._old_allowed_families para a down-migration restaurar.
migrate(
  (app) => {
    const norm = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    const squeeze = (s) => {
      const n = norm(s)
      return n === 'sem familia' ? '' : n
    }
    const settings = app.findFirstRecordByFilter('settings', "id != ''")
    if (!settings) {
      console.log('[ALLOWED-FAMILIES-SANEADO] nenhuma coleção settings encontrada — nada a fazer')
      return
    }
    const raw = settings.get('allowed_families')
    let list = []
    if (Array.isArray(raw)) {
      list = raw.map(String)
    } else if (typeof raw === 'string' && raw.trim()) {
      const t = raw.trim()
      if (t.startsWith('[')) {
        try {
          const p = JSON.parse(t)
          if (Array.isArray(p)) list = p.map(String)
        } catch (_) {
          list = t.replace(/[\[\]"]/g, '').split(',')
        }
      } else {
        list = t.split(',')
      }
    }
    // Normaliza o valor antigo para comparação (sem duplicatas)
    const oldNorm = []
    const seen = {}
    for (const item of list) {
      const k = squeeze(item)
      if (k && !seen[k]) {
        seen[k] = true
        oldNorm.push(k)
      }
    }
    // Conjunto de famílias existentes em products.sou_family
    const fams = {}
    try {
      const recs = app.findRecordsByFilter('products', "sou_family != ''", '', 0, 0)
      for (const r of recs) {
        const k = squeeze(r.getString('sou_family'))
        if (k) fams[k] = true
      }
    } catch (e) {
      console.log('[ALLOWED-FAMILIES-SANEADO] erro lendo famílias: ' + String(e))
    }
    const kept = oldNorm.filter((k) => fams[k])
    const dropped = oldNorm.filter((k) => !fams[k])
    const novo = kept.map((k) => k)
    // Sempre grava um array JSON explícito (nunca string, nunca null)
    settings.set('allowed_families', JSON.stringify(novo))
    settings.set('_old_allowed_families', JSON.stringify(list.map(String)))
    app.save(settings)
    console.log(
      '[ALLOWED-FAMILIES-SANEADO] ' +
        JSON.stringify({ antigo: list, novo: novo, descartadas: dropped }),
    )
  },
  (app) => {
    // Down: restaura o valor anterior de allowed_families
    const settings = app.findFirstRecordByFilter('settings', "id != ''")
    if (!settings) return
    const oldRaw = String(settings.getString('_old_allowed_families') || '')
    if (!oldRaw) return
    try {
      const p = JSON.parse(oldRaw)
      if (Array.isArray(p)) {
        settings.set('allowed_families', JSON.stringify(p))
        app.save(settings)
        console.log('[ALLOWED-FAMILIES-SANEADO] down: restaurado ' + JSON.stringify(p))
      }
    } catch (e) {
      console.log('[ALLOWED-FAMILIES-SANEADO] down erro: ' + String(e))
    }
  },
)
