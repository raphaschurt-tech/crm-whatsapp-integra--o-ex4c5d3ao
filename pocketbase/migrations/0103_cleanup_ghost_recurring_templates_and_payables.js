migrate(
  (app) => {
    // Bloco D: Limpeza idempotente dos 6 modelos recorrentes indesejados e dos lançamentos fantasmas
    // Horário de Brasília fixo (UTC-3) para os logs de auditoria
    const now = new Date()
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
    const brMs = utcMs - 3 * 3600000
    const brDate = new Date(brMs)
    const brIso = brDate.toISOString().replace('Z', '-03:00')

    const unrequestedTemplateNames = [
      'DAS - Simples Nacional',
      'Aluguel do Imóvel',
      'Energia Elétrica (Enel)',
      'Água e Saneamento (Sabesp)',
      'Internet Fibra Óptica',
      'Pró-Labore - Raphael',
    ]

    // 1. Localizar e apagar os lançamentos de origem 'recorrente' gerados a partir desses modelos
    // OU lançamentos indesejados gerados pelo cron (exceto Certificado A1)
    let deletedPayablesCount = 0
    try {
      const allRecPayables = app.findRecordsByFilter(
        'accounts_payable',
        "origin = 'recorrente'",
        'created',
        500,
        0,
      )

      for (let i = 0; i < allRecPayables.length; i++) {
        const p = allRecPayables[i]
        const pDesc = p.getString('description') || ''
        const pAmount = p.getFloat('amount') || 0
        const pId = p.id

        // MANTER o modelo e lançamentos do Certificado A1 (Guard D9)
        if (
          pDesc.toLowerCase().indexOf('certificado a1') !== -1 ||
          pDesc.toLowerCase().indexOf('renovação do certificado') !== -1
        ) {
          console.log(
            `[FIN-CRON] PRESERVED: Lançamento id=${pId} ("${pDesc}", R$ ${pAmount.toFixed(2)}) mantido intacto (Certificado A1 Guard D9).`,
          )
          continue
        }

        // Se for de um dos 6 modelos ou origin recorrente sem ser Certificado A1:
        let shouldDelete = false
        for (let j = 0; j < unrequestedTemplateNames.length; j++) {
          if (pDesc.indexOf(unrequestedTemplateNames[j]) !== -1) {
            shouldDelete = true
            break
          }
        }

        // Se origin for recorrente e não for Certificado A1, apaga conforme Bloco D
        if (shouldDelete || p.getString('origin') === 'recorrente') {
          app.delete(p)
          deletedPayablesCount++
          console.log(
            `[FIN-CRON] CLEANUP: Lançamento id=${pId} removido ("${pDesc}", R$ ${pAmount.toFixed(2)}, horário Brasília: ${brIso})`,
          )
        }
      }
    } catch (payErr) {
      console.log(`[FIN-CRON] CLEANUP WARN (accounts_payable): ${String(payErr)}`)
    }

    // 2. Localizar e apagar os 6 modelos não solicitados em financial_recurring_templates
    let deletedTemplatesCount = 0
    for (let i = 0; i < unrequestedTemplateNames.length; i++) {
      const name = unrequestedTemplateNames[i]
      try {
        const templates = app.findRecordsByFilter(
          'financial_recurring_templates',
          `description = "${name}"`,
          'created',
          50,
          0,
        )
        for (let t = 0; t < templates.length; t++) {
          const tmpl = templates[t]
          const tmplId = tmpl.id
          const tmplDesc = tmpl.getString('description')
          const tmplAmount = tmpl.getFloat('fixed_amount') || 0

          app.delete(tmpl)
          deletedTemplatesCount++
          console.log(
            `[FIN-CRON] CLEANUP: Modelo recorrente id=${tmplId} removido ("${tmplDesc}", valor R$ ${tmplAmount.toFixed(2)}, horário Brasília: ${brIso})`,
          )
        }
      } catch (tmplErr) {
        console.log(`[FIN-CRON] CLEANUP WARN (template ${name}): ${String(tmplErr)}`)
      }
    }

    console.log(
      `[FIN-CRON] CLEANUP concluído com sucesso às ${brIso} (Brasília UTC-3). Removidos: ${deletedTemplatesCount} modelos recorrentes e ${deletedPayablesCount} lançamentos fantasmas. Modelo Certificado A1 PRESERVADO.`,
    )
  },
  (app) => {
    // Rollback no-op idempotente: registros expurgados intencionalmente a pedido do usuário
  },
)
