import { describe, it, expect } from 'vitest'
import {
  parseOfxContent,
  parseCsvContent,
  parseOfxDateToBrasilia,
  parseAmountString,
  buildDedupeHash,
} from './statementParser'

describe('statementParser - OFX e CSV para Bancos Brasileiros (Itaú, etc.)', () => {
  it('converte datas OFX com e sem fuso horário para horário de Brasília normalizado', () => {
    const res1 = parseOfxDateToBrasilia('20261020120000' + '[-03' + ':EST]')
    expect(res1.display).toBe('2026-10-20')
    expect(res1.iso).toBe('2026-10-20T12:00:00.000Z')

    const res2 = parseOfxDateToBrasilia('20261104')
    expect(res2.display).toBe('2026-11-04')
  })

  it('converte valores numéricos flexíveis com vírgula ou ponto decimal', () => {
    expect(parseAmountString('-120.50')).toBe(-120.5)
    expect(parseAmountString('-120,50')).toBe(-120.5)
    expect(parseAmountString('1.234,56')).toBe(1234.56)
    expect(parseAmountString('(50,00)')).toBe(-50)
    expect(parseAmountString('+350,00')).toBe(350)
  })

  it('gera hash de deduplicação canônico estável', () => {
    const hash1 = buildDedupeHash('2026-11-04', -214.5, 'PAG BOLETO MEC LAN IND', 'ITAU_TR_99128')
    const hash2 = buildDedupeHash('2026-11-04', -214.5, 'PAG BOLETO MEC LAN IND', 'ITAU_TR_99128')
    expect(hash1).toBe(hash2)
    expect(hash1).toContain('2026-11-04_D_21450_ITAU_TR_99128')

    // Sem FITID
    const hash3 = buildDedupeHash('2026-11-04', -214.5, 'PAG BOLETO MEC LAN IND')
    expect(hash3).toContain('2026-11-04_D_21450_pagboletomeclanind')
  })

  it('parseia extrato OFX real do Itaú em formato SGML sem fechamento de tags', () => {
    const itauSgmlOfx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20261104120000
<LANGUAGE>POR
<FI>
<ORG>ITAU
<FID>341
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>341
<BRANCHID>0588
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261101120000
<DTEND>20261104120000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261103120000
<TRNAMT>-214.50
<FITID>20261103001
<CHECKNUM>000001
<MEMO>PAG BOLETO MEC LAN NF 3810
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261104120000
<TRNAMT>-18.50
<FITID>20261104002
<MEMO>TAR CONTA CORRENTE
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261104120000
<TRNAMT>1500.00
<FITID>20261104003
<MEMO>PIX RECEBIDO CLIENTE XYZ
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>15267.00
<DTASOF>20261104120000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

    const parsed = parseOfxContent(itauSgmlOfx)
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.header.bankId).toBe('341')
    expect(parsed.header.branchId).toBe('0588')
    expect(parsed.header.accountId).toBe('12345-6')
    expect(parsed.header.closingBalance).toBe(15267.0)
    expect(parsed.transactions).toHaveLength(3)

    // Linha 1: Débito MEC LAN
    expect(parsed.transactions[0].type).toBe('debito')
    expect(parsed.transactions[0].amount).toBe(-214.5)
    expect(parsed.transactions[0].absoluteAmount).toBe(214.5)
    expect(parsed.transactions[0].description).toBe('PAG BOLETO MEC LAN NF 3810')
    expect(parsed.transactions[0].fitid).toBe('20261103001')
    expect(parsed.transactions[0].dateDisplay).toBe('2026-11-03')

    // Linha 2: Tarifa
    expect(parsed.transactions[1].type).toBe('debito')
    expect(parsed.transactions[1].amount).toBe(-18.5)

    // Linha 3: Crédito Pix
    expect(parsed.transactions[2].type).toBe('credito')
    expect(parsed.transactions[2].amount).toBe(1500.0)

    expect(parsed.totalInflows).toBe(1500.0)
    expect(parsed.totalOutflows).toBe(233.0)
    expect(parsed.netAmount).toBe(1267.0)
  })

  it('parseia extrato CSV brasileiro delimitado por ponto e vírgula', () => {
    const csvContent = `Data;Historico;Documento;Valor
03/11/2026;PAGAMENTO FORNECEDOR MEC LAN;9821;-214,50
04/11/2026;TARIFA BANCARIA TED;0012;-12,00
04/11/2026;PIX RECEBIDO ORCAMENTO 104;9921;850,00`

    const parsed = parseCsvContent(csvContent)
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.transactions).toHaveLength(3)

    expect(parsed.transactions[0].dateDisplay).toBe('2026-11-03')
    expect(parsed.transactions[0].amount).toBe(-214.5)
    expect(parsed.transactions[0].type).toBe('debito')
    expect(parsed.transactions[0].description).toBe('PAGAMENTO FORNECEDOR MEC LAN')

    expect(parsed.transactions[2].dateDisplay).toBe('2026-11-04')
    expect(parsed.transactions[2].amount).toBe(850.0)
    expect(parsed.transactions[2].type).toBe('credito')
  })

  it('mostra erro amigável se arquivo estiver corrompido ou vazio', () => {
    const emptyResult = parseOfxContent('')
    expect(emptyResult.errors.length).toBeGreaterThan(0)

    const invalidResult = parseOfxContent('Isto é um texto aleatório que não é OFX nem nada')
    expect(invalidResult.errors.length).toBeGreaterThan(0)
  })
})
