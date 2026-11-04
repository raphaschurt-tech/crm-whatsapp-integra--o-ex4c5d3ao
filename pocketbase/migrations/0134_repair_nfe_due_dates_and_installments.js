/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Migration 0134: Correção cirúrgica de due_date para as 11 contas origin='nfe'
    // Guardas estritos respeitados: valor intocado (R$ 2.486,74 soma total), fornecedor intocado, status intocado.
    const NFE_DUE_DATA = {
      // 1. NF-e #1195508 (Jahu Matriz) - Valor: 158.86 | dVenc: 2026-11-23
      '35261061136701000147550010011955081731581098': {
        nfe_number: '1195508',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000147',
        emissao: '2026-10-26 00:00:00.000Z',
        dueDateIso: '2026-11-23 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-11-23',
        hasDup: true,
      },
      // 2. NF-e #1197024 (Jahu Matriz) - Valor: 257.66 | dVenc: 2026-11-26
      '35261061136701000147550010011970241843930987': {
        nfe_number: '1197024',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000147',
        emissao: '2026-10-29 00:00:00.000Z',
        dueDateIso: '2026-11-26 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-11-26',
        hasDup: true,
      },
      // 3. NF-e #32943 (Oxilapa) - Valor: 200.00 | dVenc: 2026-11-16
      '35261059417469000173550010000329431406428669': {
        nfe_number: '32943',
        supplier_name: 'OXILAPA GASES EQUIPAMENTOS E SOLDAS LTDA',
        cnpj: '59417469000173',
        emissao: '2026-10-19 00:00:00.000Z',
        dueDateIso: '2026-11-16 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-11-16',
        hasDup: true,
      },
      // 4. NF-e #500503 (Jahu Filial) - Valor: 82.48 | Sem duplicata no XML (dVenc ausente)
      // Guard: NÃO INVENTAR - manter due_date igual à emissão e marcar com nota para revisão manual
      '35260961136701000732550010005005031273283880': {
        nfe_number: '500503',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-11 00:00:00.000Z',
        dueDateIso: '2026-09-11 00:00:00.000Z',
        dupInfo: 'XML sem duplicata/dVenc (revisão manual)',
        hasDup: false,
      },
      // 5. NF-e #501369 (Jahu Filial) - Valor: 83.20 | dVenc: 2026-10-13
      '35260961136701000732550010005013691913994109': {
        nfe_number: '501369',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-15 00:00:00.000Z',
        dueDateIso: '2026-10-13 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-10-13',
        hasDup: true,
      },
      // 6. NF-e #502498 (Jahu Filial) - Valor: 147.90 | dVenc: 2026-10-16
      '35260961136701000732550010005024981994937196': {
        nfe_number: '502498',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-18 00:00:00.000Z',
        dueDateIso: '2026-10-16 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-10-16',
        hasDup: true,
      },
      // 7. NF-e #503935 (Jahu Filial) - Valor: 100.98 | dVenc: 2026-10-21
      '35260961136701000732550010005039351330899154': {
        nfe_number: '503935',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-23 00:00:00.000Z',
        dueDateIso: '2026-10-21 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-10-21',
        hasDup: true,
      },
      // 8. NF-e #504820 (Jahu Filial) - Valor: 157.88 | dVenc: 2026-10-23
      '35260961136701000732550010005048201698057487': {
        nfe_number: '504820',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-25 00:00:00.000Z',
        dueDateIso: '2026-10-23 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-10-23',
        hasDup: true,
      },
      // 9. NF-e #506038 (Jahu Filial) - Valor: 114.62 | Sem duplicata no XML (dVenc ausente)
      // Guard: NÃO INVENTAR - manter due_date igual à emissão e marcar com nota para revisão manual
      '35260961136701000732550010005060381548219210': {
        nfe_number: '506038',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-09-30 00:00:00.000Z',
        dueDateIso: '2026-09-30 00:00:00.000Z',
        dupInfo: 'XML sem duplicata/dVenc (revisão manual)',
        hasDup: false,
      },
      // 10. NF-e #506904 (Jahu Filial) - Valor: 163.12 | dVenc: 2026-11-03
      '35261061136701000732550010005069041294114447': {
        nfe_number: '506904',
        supplier_name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
        cnpj: '61136701000732',
        emissao: '2026-10-05 00:00:00.000Z',
        dueDateIso: '2026-11-03 00:00:00.000Z',
        dupInfo: 'dup 001 vencimento 2026-11-03',
        hasDup: true,
      },
      // 11. NF-e #56184 (Mec Lan) - Valor total: 1020.00 | Duplicatas: 2 parcelas de R$ 510,00 (17/11/2026 e 15/12/2026)
      // Vencimento da 1ª parcela: 2026-11-17. Registro preserva valor contratual R$ 1.020,00 e detalha as 2 duplicatas nas notas.
      '35261062538228000197550010000561841438996935': {
        nfe_number: '56184',
        supplier_name: 'MEC LAN INDUSTRIA E COMERCIO LTDA EPP',
        cnpj: '62538228000197',
        emissao: '2026-10-20 00:00:00.000Z',
        dueDateIso: '2026-11-17 00:00:00.000Z',
        dupInfo:
          'dup 001 R$ 510,00 venc 17/11/2026; dup 002 R$ 510,00 venc 15/12/2026 (vencimento inicial: 17/11/2026)',
        hasDup: true,
      },
    }

    const keys = Object.keys(NFE_DUE_DATA)

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const data = NFE_DUE_DATA[key]

      const ap = app.findFirstRecordByFilter('accounts_payable', 'nfe_access_key = {:key}', {
        key: key,
      })

      if (!ap) continue

      // Limpar prefixo de auditoria temporário de description
      let cleanDesc = ap.getString('description')
      if (cleanDesc.startsWith('[')) {
        const closeIdx = cleanDesc.indexOf('] ')
        if (closeIdx !== -1) {
          cleanDesc = cleanDesc.slice(closeIdx + 2)
        }
      }

      ap.set('description', cleanDesc)
      ap.set('due_date', data.dueDateIso)

      let noteText =
        'Gerado via reparo 0119 da NF-e #' +
        data.nfe_number +
        '. Chave: ' +
        key +
        ' | Fornecedor: ' +
        data.supplier_name +
        ' (' +
        data.cnpj +
        ') | Emissão: ' +
        data.emissao

      if (data.hasDup) {
        noteText += ' | Vencimento real extraído do XML: ' + data.dupInfo + '.'
      } else {
        noteText +=
          ' | [REVISÃO MANUAL: XML sem duplicata/dVenc. Vencimento mantido na data de emissão para conferência do boleto físico/fatura com o fornecedor.]'
      }

      ap.set('notes', noteText)
      app.save(ap)
    }
  },
  (app) => {},
)
