/// <reference path="../pb_data/types.d.ts" />
// 0157 — Correção 2: cria o campo settings.ai_blocked_families (JSON) e o popula
// com as famílias 100% insumo (TODOS os produtos is_component=true) + as famílias
// explicitamente de insumo/fabricação detectadas no log de produção:
// capa bucha, pino bucha, servico fabrica, recondicionado, rpa recondicionado.
// Editável futuramente pela tela Configurações, sem deploy.
migrate(
  (app) => {
    const squeeze = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

    // 1) famílias em que TODOS os produtos são is_component=true
    const fams = {} // squeeze -> {total, comp}
    try {
      const recs = app.findRecordsByFilter('products', "id != ''", '', 0, 0)
      for (const r of recs) {
        const f = squeeze(r.getString('sou_family'))
        if (!f) continue
        if (!fams[f]) fams[f] = { total: 0, comp: 0 }
        fams[f].total++
        if (r.get('is_component') === true) fams[f].comp++
      }
    } catch (e) {
      console.log('[AI-BLOCKED-FAMILIES] erro lendo produtos: ' + String(e))
    }

    // 2) famílias explicitamente de insumo/fabricação (evidência de produção 13/11)
    const seedBlocked = [
      'capa bucha',
      'pino bucha',
      'servico fabrica',
      'recondicionado',
      'rpa recondicionado',
    ]
    const blockedSet = {}
    for (const b of seedBlocked) blockedSet[squeeze(b)] = true

    for (const f in fams) {
      if (fams[f].total > 0 && fams[f].comp === fams[f].total) blockedSet[f] = true
    }

    // Exibe os nomes originais (com acento/espaços como estão no banco) na lista final
    const originalNames = {}
    try {
      const recs2 = app.findRecordsByFilter('products', "id != ''", '', 0, 0)
      for (const r of recs2) {
        const f = squeeze(r.getString('sou_family'))
        const raw = String(r.getString('sou_family') || '').trim()
        if (f && blockedSet[f] && raw && !originalNames[f]) originalNames[f] = raw
      }
    } catch (e) {}

    const blocked = []
    for (const f in blockedSet) {
      blocked.push(originalNames[f] || f)
    }
    blocked.sort()

    const settings = app.findFirstRecordByFilter('settings', "id != ''")
    if (!settings) {
      console.log('[AI-BLOCKED-FAMILIES] nenhuma coleção settings — nada a fazer')
      return
    }
    settings.set('ai_blocked_families', JSON.stringify(blocked))
    app.save(settings)
    console.log('[AI-BLOCKED-FAMILIES] gravadas: ' + JSON.stringify(blocked))
  },
  (app) => {
    const settings = app.findFirstRecordByFilter('settings', "id != ''")
    if (!settings) return
    settings.set('ai_blocked_families', '')
    app.save(settings)
  },
)
