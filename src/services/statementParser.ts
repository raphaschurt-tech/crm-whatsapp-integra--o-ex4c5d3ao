/**
 * Tipos e utilitários para parsing e deduplicação de extratos bancários (OFX e CSV)
 * Suporte a bancos brasileiros: Itaú, Bradesco, BB, Santander, Caixa, Nubank, Inter, etc.
 * Tolerante a SGML OFX 1.02 sem tags de fechamento, OFX 2.x XML, encodings Latin-1 / UTF-8,
 * formatos de data com/sem timezone, e formatos numéricos brasileiros (1.234,56 ou 1234.56).
 */

export interface ParsedStatementTransaction {
  date: string // YYYY-MM-DDTHH:mm:ss.000Z em horário de Brasília normalizado
  dateDisplay: string // YYYY-MM-DD
  amount: number // Positivo para crédito, negativo para débito
  absoluteAmount: number
  type: 'credito' | 'debito'
  description: string
  fitid?: string
  checkNumber?: string
  memo?: string
  dedupeHash: string // Hash canônico único (data + valor absoluto + tipo + descrição)
}

export interface ParsedStatementHeader {
  bankId?: string
  branchId?: string
  accountId?: string
  accountType?: string
  startDate?: string
  endDate?: string
  closingBalance?: number
  closingDate?: string
}

export interface ParsedStatementResult {
  header: ParsedStatementHeader
  transactions: ParsedStatementTransaction[]
  rawFormat: 'ofx' | 'csv'
  totalInflows: number
  totalOutflows: number
  netAmount: number
  errors: string[]
}

/**
 * Converte data OFX (ex: 20261020, 20261020120000, 20261020120000 com offset)
 * em ISO string normalizada no meio do dia em Brasília (12:00:00.000Z)
 */
export function parseOfxDateToBrasilia(rawDate: string): { iso: string; display: string } {
  if (!rawDate) {
    const today = new Date().toISOString().substring(0, 10)
    return { iso: `${today}T12:00:00.000Z`, display: today }
  }

  // Remove colchetes de fuso horário ex: colchetes com offset
  const cleaned = rawDate.replace(/\[.*?\]/g, '').trim()
  const digits = cleaned.replace(/\D/g, '')

  if (digits.length >= 8) {
    const yyyy = digits.substring(0, 4)
    const mm = digits.substring(4, 6)
    const dd = digits.substring(6, 8)
    const display = `${yyyy}-${mm}-${dd}`
    return {
      iso: `${display}T12:00:00.000Z`,
      display,
    }
  }

  const today = new Date().toISOString().substring(0, 10)
  return { iso: `${today}T12:00:00.000Z`, display: today }
}

/**
 * Parseia string numérica flexível (ex: -120.50, +120,50, "1.234,56", "(50,00)")
 */
export function parseAmountString(rawAmount: string): number {
  if (!rawAmount) return 0
  let cleaned = rawAmount.trim()

  const isParenthesesNegative = cleaned.startsWith('(') && cleaned.endsWith(')')
  if (isParenthesesNegative) {
    cleaned = '-' + cleaned.substring(1, cleaned.length - 1).trim()
  }

  // Se tiver vírgula e ponto (ex: 1.234,56)
  if (cleaned.includes('.') && cleaned.includes(',')) {
    // Se o ponto vier antes da vírgula: padrão BR (1.234,56)
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // Padrão US com vírgula de milhar (1,234.56)
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (cleaned.includes(',')) {
    // Apenas vírgula: assume decimal brasileiro (123,45)
    cleaned = cleaned.replace(',', '.')
  }

  // Remove caracteres que não sejam dígitos, sinal ou ponto
  cleaned = cleaned.replace(/[^0-9.-]/g, '')
  const val = parseFloat(cleaned)
  return isNaN(val) ? 0 : Math.round(val * 100) / 100
}

/**
 * Normaliza descrição para chave de deduplicação estável
 */
export function normalizeDescriptionForDedupe(desc: string): string {
  if (!desc) return 'lancamento'
  return desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Gera hash de deduplicação canônico.
 * Regra: dataDisplay (YYYY-MM-DD) + valor absoluto em centavos + tipo + descrição normalizada.
 * Se tiver FITID válido do banco, adiciona ao hash ou usa como componente primário se único.
 */
export function buildDedupeHash(
  dateDisplay: string,
  amount: number,
  description: string,
  fitid?: string,
): string {
  const absCents = Math.round(Math.abs(amount) * 100)
  const typeStr = amount >= 0 ? 'C' : 'D'
  const normDesc = normalizeDescriptionForDedupe(description).substring(0, 30)
  const normFitid = fitid ? fitid.trim().replace(/[^a-zA-Z0-9_-]/g, '') : ''

  if (normFitid && normFitid.length >= 4) {
    return `${dateDisplay}_${typeStr}_${absCents}_${normFitid}`
  }

  return `${dateDisplay}_${typeStr}_${absCents}_${normDesc}`
}

/**
 * Extrai tag SGML/XML de um bloco OFX
 */
function extractOfxTag(block: string, tag: string): string | null {
  // Tenta formato XML: <TAG>valor</TAG>
  const xmlRegex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const xmlMatch = block.match(xmlRegex)
  if (xmlMatch && xmlMatch[1] !== undefined) {
    return xmlMatch[1].trim()
  }

  // Formato SGML clássico: <TAG>valor (termina na próxima tag '<' ou quebra de linha)
  const sgmlRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
  const sgmlMatch = block.match(sgmlRegex)
  if (sgmlMatch && sgmlMatch[1] !== undefined) {
    return sgmlMatch[1].trim()
  }

  return null
}

/**
 * Parser de OFX (Itaú, Bradesco, Santander, BB, Caixa, etc.)
 */
export function parseOfxContent(rawContent: string): ParsedStatementResult {
  const errors: string[] = []
  const transactions: ParsedStatementTransaction[] = []
  const header: ParsedStatementHeader = {}

  if (!rawContent || !rawContent.trim()) {
    return {
      header,
      transactions: [],
      rawFormat: 'ofx',
      totalInflows: 0,
      totalOutflows: 0,
      netAmount: 0,
      errors: ['Arquivo OFX vazio ou ilegível.'],
    }
  }

  // Verifica se o arquivo parece ser OFX
  const upper = rawContent.toUpperCase()
  if (!upper.includes('OFX') && !upper.includes('<STMTTRN>') && !upper.includes('<OFX>')) {
    return {
      header,
      transactions: [],
      rawFormat: 'ofx',
      totalInflows: 0,
      totalOutflows: 0,
      netAmount: 0,
      errors: ['O arquivo fornecido não possui estrutura OFX válida.'],
    }
  }

  // Cabeçalho da conta bancária
  header.bankId = extractOfxTag(rawContent, 'BANKID') || undefined
  header.branchId = extractOfxTag(rawContent, 'BRANCHID') || undefined
  header.accountId = extractOfxTag(rawContent, 'ACCTID') || undefined
  header.accountType = extractOfxTag(rawContent, 'ACCTTYPE') || undefined

  // Saldo final (LEDGERBAL) se presente
  const balAmtRaw = extractOfxTag(rawContent, 'BALAMT')
  if (balAmtRaw) {
    header.closingBalance = parseAmountString(balAmtRaw)
  }
  const dtAsOfRaw = extractOfxTag(rawContent, 'DTASOF')
  if (dtAsOfRaw) {
    header.closingDate = parseOfxDateToBrasilia(dtAsOfRaw).display
  }

  // Localiza blocos <STMTTRN>...</STMTTRN> ou <STMTTRN> até próximo <STMTTRN> ou </BANKTRANLIST>
  // Muitos OFX brasileiros (especialmente Itaú SGML) não fecham </STMTTRN>.
  const trnBlocks: string[] = []
  const trnRegex = /<STMTTRN>([\s\S]*?)(?=(?:<STMTTRN>|<\/BANKTRANLIST>|<\/STMTTRN>|$))/gi
  let match: RegExpExecArray | null

  while ((match = trnRegex.exec(rawContent)) !== null) {
    const blockContent = match[1]
    if (blockContent && blockContent.trim().length > 5) {
      trnBlocks.push(blockContent)
    }
  }

  for (const block of trnBlocks) {
    const trnType = extractOfxTag(block, 'TRNTYPE') || ''
    const dtPostedRaw = extractOfxTag(block, 'DTPOSTED') || ''
    const trnAmtRaw = extractOfxTag(block, 'TRNAMT') || '0'
    const fitid = extractOfxTag(block, 'FITID') || undefined
    const checkNum = extractOfxTag(block, 'CHECKNUM') || undefined
    const memo = extractOfxTag(block, 'MEMO') || ''
    const name = extractOfxTag(block, 'NAME') || ''

    const amount = parseAmountString(trnAmtRaw)
    const { iso, display } = parseOfxDateToBrasilia(dtPostedRaw)

    // A descrição no OFX geralmente vem no MEMO ou NAME
    let description = memo || name || 'Lançamento bancário'
    if (name && memo && name !== memo) {
      description = `${name} - ${memo}`
    }

    const type: 'credito' | 'debito' =
      amount < 0 || trnType.toUpperCase() === 'DEBIT' ? 'debito' : 'credito'
    const absoluteAmount = Math.abs(amount)
    const signedAmount = type === 'debito' ? -absoluteAmount : absoluteAmount

    const dedupeHash = buildDedupeHash(display, signedAmount, description, fitid)

    transactions.push({
      date: iso,
      dateDisplay: display,
      amount: signedAmount,
      absoluteAmount,
      type,
      description,
      fitid,
      checkNumber: checkNum,
      memo: memo || undefined,
      dedupeHash,
    })
  }

  let totalInflows = 0
  let totalOutflows = 0
  for (const tx of transactions) {
    if (tx.amount > 0) totalInflows += tx.amount
    else totalOutflows += Math.abs(tx.amount)
  }

  totalInflows = Math.round(totalInflows * 100) / 100
  totalOutflows = Math.round(totalOutflows * 100) / 100
  const netAmount = Math.round((totalInflows - totalOutflows) * 100) / 100

  return {
    header,
    transactions,
    rawFormat: 'ofx',
    totalInflows,
    totalOutflows,
    netAmount,
    errors,
  }
}

/**
 * Converte data em formatos comuns de CSV brasileiro para YYYY-MM-DD
 * Suporta: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD/MM/YY
 */
export function parseCsvDateToBrasilia(raw: string): { iso: string; display: string } | null {
  if (!raw) return null
  const cleaned = raw.trim()

  // DD/MM/YYYY ou DD/MM/YY
  const brMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0')
    const month = brMatch[2].padStart(2, '0')
    let year = brMatch[3]
    if (year.length === 2) {
      year = `20${year}`
    }
    const display = `${year}-${month}-${day}`
    return {
      iso: `${display}T12:00:00.000Z`,
      display,
    }
  }

  // YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (isoMatch) {
    const year = isoMatch[1]
    const month = isoMatch[2].padStart(2, '0')
    const day = isoMatch[3].padStart(2, '0')
    const display = `${year}-${month}-${day}`
    return {
      iso: `${display}T12:00:00.000Z`,
      display,
    }
  }

  return null
}

/**
 * Parser de CSV de extrato bancário
 * Detecta delimitador (, ou ; ou \t), localiza colunas Data, Descrição/Histórico, Valor/Entrada/Saída
 */
export function parseCsvContent(rawContent: string): ParsedStatementResult {
  const errors: string[] = []
  const transactions: ParsedStatementTransaction[] = []
  const header: ParsedStatementHeader = {}

  if (!rawContent || !rawContent.trim()) {
    return {
      header,
      transactions: [],
      rawFormat: 'csv',
      totalInflows: 0,
      totalOutflows: 0,
      netAmount: 0,
      errors: ['Arquivo CSV vazio.'],
    }
  }

  // Quebra em linhas
  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length < 2) {
    return {
      header,
      transactions: [],
      rawFormat: 'csv',
      totalInflows: 0,
      totalOutflows: 0,
      netAmount: 0,
      errors: ['O arquivo CSV não possui linhas de dados suficientes.'],
    }
  }

  // Detecta delimitador (; é comum no Brasil para não colidir com vírgula decimal)
  const sample = lines.slice(0, 5).join('\n')
  const semicolonCount = (sample.match(/;/g) || []).length
  const commaCount = (sample.match(/,/g) || []).length
  const tabCount = (sample.match(/\t/g) || []).length

  let delimiter = ','
  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    delimiter = ';'
  } else if (tabCount > commaCount && tabCount > semicolonCount) {
    delimiter = '\t'
  }

  // Função auxiliar para dividir campos respeitando aspas
  const splitLine = (line: string): string[] => {
    const result: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === delimiter && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, ''))
        cur = ''
      } else {
        cur += char
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, ''))
    return result
  }

  // Localiza a linha de cabeçalho
  let headerIndex = -1
  let colDate = -1
  let colDesc = -1
  let colAmount = -1
  let colInflow = -1
  let colOutflow = -1
  let colFitid = -1

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = splitLine(lines[i]).map((c) =>
      c
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim(),
    )

    let foundDate = -1
    let foundDesc = -1
    let foundAmount = -1
    let foundIn = -1
    let foundOut = -1
    let foundDoc = -1

    for (let j = 0; j < cols.length; j++) {
      const c = cols[j]
      if (c === 'data' || c === 'dt' || c === 'date' || c === 'data lancamento') {
        foundDate = j
      } else if (
        c.includes('descricao') ||
        c.includes('historico') ||
        c.includes('memo') ||
        c.includes('detalhe')
      ) {
        foundDesc = j
      } else if (
        c === 'valor' ||
        c === 'valor (r$)' ||
        c === 'amount' ||
        c === 'valor r$' ||
        c === 'lancamento'
      ) {
        foundAmount = j
      } else if (c.includes('entrada') || c.includes('credito') || c.includes('recebimento')) {
        foundIn = j
      } else if (c.includes('saida') || c.includes('debito') || c.includes('pagamento')) {
        foundOut = j
      } else if (
        c.includes('documento') ||
        c.includes('doc') ||
        c.includes('id') ||
        c.includes('identificador')
      ) {
        foundDoc = j
      }
    }

    if (foundDate !== -1 && (foundAmount !== -1 || (foundIn !== -1 && foundOut !== -1))) {
      headerIndex = i
      colDate = foundDate
      colDesc = foundDesc
      colAmount = foundAmount
      colInflow = foundIn
      colOutflow = foundOut
      colFitid = foundDoc
      break
    }
  }

  // Se não achou por nomes, tenta heurística nas primeiras colunas de dados
  if (headerIndex === -1) {
    headerIndex = 0
    colDate = 0
    colDesc = 1
    colAmount = 2
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])
    if (cols.length < 2) continue

    const rawDate = cols[colDate] || ''
    const parsedDate = parseCsvDateToBrasilia(rawDate)
    if (!parsedDate) continue // Linha de rodapé ou inválida

    const desc = colDesc !== -1 && cols[colDesc] ? cols[colDesc] : 'Lançamento bancário'
    const fitid = colFitid !== -1 && cols[colFitid] ? cols[colFitid] : undefined

    let amount = 0
    if (colAmount !== -1 && cols[colAmount] !== undefined) {
      amount = parseAmountString(cols[colAmount])
    } else if (colInflow !== -1 && colOutflow !== -1) {
      const inVal = parseAmountString(cols[colInflow] || '0')
      const outVal = parseAmountString(cols[colOutflow] || '0')
      amount = inVal > 0 ? inVal : -Math.abs(outVal)
    }

    if (amount === 0) continue

    const type: 'credito' | 'debito' = amount < 0 ? 'debito' : 'credito'
    const absoluteAmount = Math.abs(amount)
    const signedAmount = type === 'debito' ? -absoluteAmount : absoluteAmount

    const dedupeHash = buildDedupeHash(parsedDate.display, signedAmount, desc, fitid)

    transactions.push({
      date: parsedDate.iso,
      dateDisplay: parsedDate.display,
      amount: signedAmount,
      absoluteAmount,
      type,
      description: desc,
      fitid,
      dedupeHash,
    })
  }

  let totalInflows = 0
  let totalOutflows = 0
  for (const tx of transactions) {
    if (tx.amount > 0) totalInflows += tx.amount
    else totalOutflows += Math.abs(tx.amount)
  }

  totalInflows = Math.round(totalInflows * 100) / 100
  totalOutflows = Math.round(totalOutflows * 100) / 100
  const netAmount = Math.round((totalInflows - totalOutflows) * 100) / 100

  return {
    header,
    transactions,
    rawFormat: 'csv',
    totalInflows,
    totalOutflows,
    netAmount,
    errors,
  }
}

/**
 * Lê arquivo como texto suportando detecção de encoding (UTF-8 ou Latin-1/ISO-8859-1)
 */
export async function readBankStatementFile(
  file: File,
): Promise<{ content: string; format: 'ofx' | 'csv' }> {
  const isOfx =
    file.name.toLowerCase().endsWith('.ofx') ||
    file.name.toLowerCase().endsWith('.qfx') ||
    file.type.includes('ofx')

  const format: 'ofx' | 'csv' = isOfx ? 'ofx' : 'csv'

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // Testa decodificar como UTF-8 primeiro
  let text = ''
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
    text = utf8Decoder.decode(bytes)
  } catch (_) {
    // Falhou UTF-8 (caracteres acentuados Latin-1 / Windows-1252 típicos de bancos BR como Itaú)
    try {
      const latin1Decoder = new TextDecoder('iso-8859-1')
      text = latin1Decoder.decode(bytes)
    } catch (_) {
      const fallbackDecoder = new TextDecoder('windows-1252')
      text = fallbackDecoder.decode(bytes)
    }
  }

  return { content: text, format }
}
