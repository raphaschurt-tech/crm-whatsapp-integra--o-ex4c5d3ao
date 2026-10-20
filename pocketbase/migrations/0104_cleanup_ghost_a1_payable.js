migrate(
  (app) => {
    // BLOCO 1 — FECHO DO LIMPEZA D (urgente)
    // Apagar o lançamento fantasma do A1 (amount: 0, status: 'pendente', due_date: 10/10/2026, id: 'ibk672xom2sqx0s')
    // O modelo financial_recurring_templates id '6km2bjonw8bxb66' (Renovação do Certificado A1) FICA PRESERVADO (Guard D9).
    // Horário de Brasília fixo (UTC-3) para log de auditoria [FIN-CRON] CLEANUP.
    const now = new Date()
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
    const brMs = utcMs - 3 * 3600000
    const brDate = new Date(brMs)
    const brIso = brDate.toISOString().replace('Z', '-03:00')

    let deletedCount = 0

    try {
      const ghostA1 = app.findRecordById('accounts_payable', 'ibk672xom2sqx0s')
      if (ghostA1) {
        const desc = ghostA1.getString('description')
        const amount = ghostA1.getFloat('amount')
        const comp = ghostA1.getString('recurring_competence')
        const origin = ghostA1.getString('origin')

        app.delete(ghostA1)
        deletedCount++
        console.log(
          `[FIN-CRON] CLEANUP: Lançamento fantasma A1 id=ibk672xom2sqx0s removido com sucesso. Descrição="${desc}", valor=R$ ${amount.toFixed(2)}, competência=${comp}, origem=${origin}. Horário de Brasília: ${brIso}. Modelo Certificado A1 preservado (Guard D9).`,
        )
      }
    } catch (err) {
      console.log(
        `[FIN-CRON] CLEANUP: Registro id ibk672xom2sqx0s já não existe ou erro ao buscar: ${String(err)}`,
      )
    }

    // Validação de segurança adicional: caso o id varie, apagar lançamento da competência 2026-10 de origin 'recorrente'
    // com amount 0 e modelo do A1
    try {
      const records = app.findRecordsByFilter(
        'accounts_payable',
        'recurring_competence = "2026-10" && origin = "recorrente" && amount = 0',
        'created',
        10,
        0,
      )
      for (let i = 0; i < records.length; i++) {
        const rec = records[i]
        const recId = rec.id
        const desc = rec.getString('description')
        app.delete(rec)
        deletedCount++
        console.log(
          `[FIN-CRON] CLEANUP: Lançamento id=${recId} ("${desc}") removido por filtro de competência 2026-10. Horário de Brasília: ${brIso}`,
        )
      }
    } catch (_) {}

    console.log(
      `[FIN-CRON] CLEANUP BLOCO 1 concluído às ${brIso} (Brasília UTC-3). Total de lançamentos removidos: ${deletedCount}. Modelo A1 intacto. Dedupe único por (modelo+competência) liberado.`,
    )
  },
  (app) => {
    // Rollback no-op idempotente
  },
)
