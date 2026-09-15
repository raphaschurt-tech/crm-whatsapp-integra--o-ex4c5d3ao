import { Quote, QuoteItem, Customer } from '@/types/crm'

export interface QuotePdfData {
  quote: Quote
  items: QuoteItem[]
  customer?: Customer | null
}

/**
 * Normaliza e formata valores em moeda brasileira (Real - R$) sem caracteres especiais
 * como acentos graves, non-breaking space (0xA0) corrompido ou espaços anômalos.
 * Exemplo: 52 -> "R$ 52,00" | 104.5 -> "R$ 104,50"
 */
export function formatPdfCurrency(amount: number | null | undefined): string {
  const val = Number(amount) || 0
  const formatted = val.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  // Substitui qualquer espaço com non-breaking space ou caractere especial por espaço ASCII normal
  const cleanFormatted = formatted.replace(/\s+/g, ' ').trim()
  return `R$ ${cleanFormatted}`
}

/**
 * Escapa strings para formato seguro em PDF padrão Type1 (Helvetica)
 * Remove acentos diacríticos para evitar caracteres ilegíveis e escapa parênteses / barras.
 */
function cleanPdfText(text: string | null | undefined): string {
  if (!text) return ''
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ') // mantém apenas ASCII imprimível e \n
    .replace(/[\\()]/g, '') // remove parênteses e barras invertidas de controle do PDF
    .trim()
}

/**
 * Escapa para literais de string em PDF (envolto por parênteses)
 */
function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Quebra um texto longo em linhas que caibam aproximadamente em um número máximo de caracteres
 */
function wrapText(text: string, maxCharsPerLine: number = 75): string[] {
  if (!text) return []
  const paragraphs = text.split('\n')
  const lines: string[] = []

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) {
      lines.push('')
      continue
    }

    const words = trimmed.split(/\s+/)
    let currentLine = ''

    for (const word of words) {
      if (!currentLine) {
        currentLine = word
      } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
        currentLine += ' ' + word
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }
    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines
}

/**
 * Gera um arquivo PDF no padrão PDF 1.4 limpo, elegante e profissional, sem dependências externas.
 * Retorna Uint8Array com os bytes brutos do PDF.
 */
export function generateQuotePdfBytes(data: QuotePdfData): Uint8Array {
  const { quote, items, customer } = data

  const customerName = cleanPdfText(customer?.name || quote.expand?.customer?.name) || 'Cliente'
  const customerPhone = cleanPdfText(customer?.phone || quote.expand?.customer?.phone)
  const customerEmail = cleanPdfText(customer?.email || quote.expand?.customer?.email)
  const customerDoc = cleanPdfText(
    (customer as any)?.cnpj ||
      (customer as any)?.cpf ||
      quote.expand?.customer?.cnpj ||
      quote.expand?.customer?.cpf,
  )
  const customerCompany = cleanPdfText(customer?.company || quote.expand?.customer?.company)

  const quoteNumber = cleanPdfText(quote.number || 'ORCAMENTO')
  const dateStr = new Date(quote.created || Date.now()).toLocaleDateString('pt-BR')

  // Dimensões A4 em pontos: 595.28 x 841.89 pt (arredondado 595 x 842)
  // Margens laterais: 36 pt (largura útil = 523 pt)
  const marginX = 36
  const pageWidth = 595
  const contentWidth = 523 // 595 - 72

  let s = ''

  // ==========================================
  // 1. TOPO: BARRA DECORATIVA ESMERALDA
  // ==========================================
  // Verde RPA elegante: rgb(0.04, 0.48, 0.32)
  s += '0.04 0.48 0.32 rg\n'
  s += `0 834 ${pageWidth} 8 re f\n`

  // ==========================================
  // 2. CABEÇALHO EM DUAS COLUNAS (Y ~ 740 até 820)
  // ==========================================
  // ESQUERDA: Dados da empresa
  s += 'BT\n'
  // Nome da Empresa em negrito grande
  s += '/F2 18 Tf\n'
  s += '0.04 0.48 0.32 rg\n'
  s += `${marginX} 806 Td\n`
  s += `(${escapePdfLiteral('RPA AUTO PARTS')}) Tj\n`

  // Subtítulo da empresa
  s += '/F2 9 Tf\n'
  s += '0.22 0.28 0.34 rg\n'
  s += `0 -13 Td\n`
  s += `(${escapePdfLiteral('PECAS E ACESSORIOS AUTOMOTIVOS')}) Tj\n`

  // Informações de contato da empresa
  s += '/F1 8.5 Tf\n'
  s += '0.42 0.46 0.52 rg\n'
  s += `0 -12 Td\n`
  s += `(${escapePdfLiteral('WhatsApp: (11) 94786-1439  |  Vendas e Orcamentos Especializados')}) Tj\n`
  s += `0 -11 Td\n`
  s += `(${escapePdfLiteral('Atendimento de Segunda a Sexta-feira')}) Tj\n`
  s += 'ET\n'

  // DIREITA: LOGO DA RPA AUTO PARTS (Lado Superior Direito, conforme pedido)
  // Emblema vetorial de alta definição da marca RPA AUTO PARTS
  const logoRightX = marginX + contentWidth // 559 pt
  const logoBoxWidth = 148
  const logoBoxHeight = 56
  const logoBoxX = logoRightX - logoBoxWidth // 411 pt
  const logoBoxY = 766 // de 766 até 822 pt

  // Fundo sutil com borda do badge da logo
  s += '0.96 0.98 0.96 rg\n'
  s += `${logoBoxX} ${logoBoxY} ${logoBoxWidth} ${logoBoxHeight} re f\n`
  s += '0.80 0.89 0.82 RG\n'
  s += '0.75 w\n'
  s += `${logoBoxX} ${logoBoxY} ${logoBoxWidth} ${logoBoxHeight} re s\n`

  // Ícone decorativo: engrenagem / suspensão estilizada à esquerda do badge da marca
  s += '0.04 0.48 0.32 rg\n'
  s += `${logoBoxX + 12} ${logoBoxY + 14} 28 28 re f\n`
  // Detalhe branco no ícone
  s += '1 1 1 rg\n'
  s += `${logoBoxX + 19} ${logoBoxY + 21} 14 14 re f\n`
  s += '0.04 0.48 0.32 rg\n'
  s += `${logoBoxX + 23} ${logoBoxY + 25} 6 6 re f\n`

  // Tipografia da Logo: "RPA" em destaque e "AUTO PARTS" logo abaixo
  s += 'BT\n'
  s += '/F2 15 Tf\n'
  s += '0.04 0.48 0.32 rg\n'
  s += `${logoBoxX + 46} ${logoBoxY + 33} Td\n`
  s += `(${escapePdfLiteral('RPA')}) Tj\n`

  s += '/F2 8 Tf\n'
  s += '0.15 0.20 0.25 rg\n'
  s += `0 -12 Td\n`
  s += `(${escapePdfLiteral('AUTO PARTS')}) Tj\n`

  s += '/F1 6.5 Tf\n'
  s += '0.45 0.50 0.55 rg\n'
  s += `0 -9 Td\n`
  s += `(${escapePdfLiteral('SUSPENSAO & FREIOS')}) Tj\n`
  s += 'ET\n'

  // Linha divisória sutil abaixo do cabeçalho
  s += '0.86 0.89 0.92 RG\n'
  s += '0.75 w\n'
  s += `${marginX} 752 m ${marginX + contentWidth} 752 l S\n`

  // ==========================================
  // 3. FAIXA DE IDENTIFICAÇÃO DO ORÇAMENTO E DATAS (Y: 712 a 744)
  // ==========================================
  s += '0.94 0.97 0.95 rg\n'
  s += `${marginX} 714 ${contentWidth} 32 re f\n`
  s += '0.78 0.87 0.81 RG\n'
  s += '0.75 w\n'
  s += `${marginX} 714 ${contentWidth} 32 re s\n`

  s += 'BT\n'
  s += '/F2 11 Tf\n'
  s += '0.04 0.48 0.32 rg\n'
  s += `${marginX + 12} 726 Td\n`
  s += `(${escapePdfLiteral(`PROPOSTA COMERCIAL / ORCAMENTO: ${quoteNumber}`)}) Tj\n`

  s += '/F1 9 Tf\n'
  s += '0.30 0.35 0.40 rg\n'
  s += `${contentWidth - 145} 0 Td\n`
  s += `(${escapePdfLiteral(`Data de Emissao: ${dateStr}`)}) Tj\n`
  s += 'ET\n'

  // ==========================================
  // 4. BLOCO DE DADOS DO CLIENTE (Y: 648 a 704)
  // ==========================================
  const clientBoxY = 650
  const clientBoxHeight = 54
  s += '0.98 0.99 1 rg\n'
  s += `${marginX} ${clientBoxY} ${contentWidth} ${clientBoxHeight} re f\n`
  s += '0.88 0.90 0.94 RG\n'
  s += '0.5 w\n'
  s += `${marginX} ${clientBoxY} ${contentWidth} ${clientBoxHeight} re s\n`

  // Pequeno marcador colorido na borda esquerda do bloco de cliente
  s += '0.04 0.48 0.32 rg\n'
  s += `${marginX} ${clientBoxY} 3.5 ${clientBoxHeight} re f\n`

  s += 'BT\n'
  s += '/F2 8 Tf\n'
  s += '0.45 0.50 0.55 rg\n'
  s += `${marginX + 12} ${clientBoxY + 38} Td\n`
  s += `(${escapePdfLiteral('DADOS DO CLIENTE')}) Tj\n`

  s += '/F2 10.5 Tf\n'
  s += '0.10 0.12 0.15 rg\n'
  s += `0 -13 Td\n`
  s += `(${escapePdfLiteral(customerName.toUpperCase())}) Tj\n`

  s += '/F1 8.5 Tf\n'
  s += '0.35 0.40 0.45 rg\n'
  s += `0 -12 Td\n`
  const phoneText = customerPhone
    ? `Telefone/WhatsApp: ${customerPhone}`
    : 'Telefone: Nao informado'
  const emailText = customerEmail ? `Email: ${customerEmail}` : 'Email: Nao informado'
  const docText = customerDoc ? `  |  CPF/CNPJ: ${customerDoc}` : ''
  const companyText = customerCompany ? `  |  Empresa: ${customerCompany}` : ''
  s += `(${escapePdfLiteral(`${phoneText}    ${emailText}${docText}${companyText}`)}) Tj\n`
  s += 'ET\n'

  // ==========================================
  // 5. TABELA DE ITENS DO ORÇAMENTO
  // ==========================================
  // Colunas da tabela (largura total 523 pt):
  // # (Item): 30 pt
  // Descrição do Produto / Peça: 270 pt
  // Qtd: 45 pt (centralizado/alinhado)
  // Valor Unitário: 85 pt (alinhado à direita)
  // Subtotal / Total: 93 pt (alinhado à direita)
  const colXItem = marginX + 8
  const colXDesc = marginX + 32
  const colXQty = marginX + 305
  const colXUnit = marginX + 355
  const colXTotal = marginX + 445

  const tableHeaderY = 618
  const tableHeaderHeight = 22

  // Fundo do cabeçalho da tabela: tom esmeralda bem suave e profissional
  s += '0.12 0.42 0.30 rg\n'
  s += `${marginX} ${tableHeaderY} ${contentWidth} ${tableHeaderHeight} re f\n`

  s += 'BT\n'
  s += '/F2 8.5 Tf\n'
  s += '1 1 1 rg\n'
  s += `${colXItem} ${tableHeaderY + 7} Td (${escapePdfLiteral('#')}) Tj\n`
  s += `${colXDesc - colXItem} 0 Td (${escapePdfLiteral('DESCRICAO DA PECA / ITEM')}) Tj\n`
  s += `${colXQty - colXDesc} 0 Td (${escapePdfLiteral('QTD')}) Tj\n`
  s += `${colXUnit - colXQty} 0 Td (${escapePdfLiteral('VALOR UN.')}) Tj\n`
  s += `${colXTotal - colXUnit} 0 Td (${escapePdfLiteral('TOTAL DO ITEM')}) Tj\n`
  s += 'ET\n'

  // Linhas de itens
  let currentY = tableHeaderY - 22
  const rowHeight = 22
  const maxItemsOnPage = 14
  const displayItems = items.slice(0, maxItemsOnPage)

  displayItems.forEach((item, index) => {
    const isEven = index % 2 === 0
    if (isEven) {
      s += '0.97 0.98 0.99 rg\n'
      s += `${marginX} ${currentY} ${contentWidth} ${rowHeight} re f\n`
    }

    // Linha divisória inferior suave
    s += '0.88 0.90 0.93 RG\n'
    s += '0.5 w\n'
    s += `${marginX} ${currentY} m ${marginX + contentWidth} ${currentY} l S\n`

    const prodName = cleanPdfText(
      item.expand?.product?.name || item.product || `Item ${index + 1}`,
    ).slice(0, 48)
    const qty = String(item.quantity || 1)
    const unitPrice = formatPdfCurrency(item.unit_price || 0)
    const totalItem = formatPdfCurrency(item.total || 0)

    s += 'BT\n'
    s += '/F1 8.5 Tf\n'
    s += '0.35 0.40 0.45 rg\n'
    s += `${colXItem} ${currentY + 6} Td (${escapePdfLiteral(String(index + 1))}) Tj\n`

    s += '/F2 8.5 Tf\n'
    s += '0.12 0.15 0.18 rg\n'
    s += `${colXDesc - colXItem} 0 Td (${escapePdfLiteral(prodName)}) Tj\n`

    s += '/F1 8.5 Tf\n'
    s += '0.25 0.30 0.35 rg\n'
    s += `${colXQty - colXDesc + 6} 0 Td (${escapePdfLiteral(qty)}) Tj\n`

    s += `${colXUnit - (colXQty + 6)} 0 Td (${escapePdfLiteral(unitPrice)}) Tj\n`

    s += '/F2 8.5 Tf\n'
    s += '0.08 0.12 0.15 rg\n'
    s += `${colXTotal - colXUnit} 0 Td (${escapePdfLiteral(totalItem)}) Tj\n`
    s += 'ET\n'

    currentY -= rowHeight
  })

  // Mensagem se houver mais itens que couberem em 1 página
  if (items.length > maxItemsOnPage) {
    const diff = items.length - maxItemsOnPage
    s += 'BT\n'
    s += '/F1 8 Tf\n'
    s += '0.5 0.5 0.5 rg\n'
    s += `${marginX + 10} ${currentY + 6} Td (${escapePdfLiteral(`... e mais ${diff} item(ns) detalhados na proposta completa.`)}) Tj\n`
    s += 'ET\n'
    currentY -= 16
  }

  // ==========================================
  // 6. BLOCO INFERIOR: OBSERVAÇÕES (ESQ.) E TOTAIS (DIR.)
  // ==========================================
  // Posição vertical calculada com margem de segurança para nunca sobrepor
  const bottomSectionTopY = Math.min(currentY - 14, 310)
  const totalsBoxWidth = 230
  const totalsBoxX = marginX + contentWidth - totalsBoxWidth // 329 pt
  const totalsBoxHeight = 110
  const totalsBoxY = bottomSectionTopY - totalsBoxHeight

  // CAIXA DE TOTAIS (Direita) - Estilo cartão com borda e destaque de valor
  s += '0.97 0.98 0.99 rg\n'
  s += `${totalsBoxX} ${totalsBoxY} ${totalsBoxWidth} ${totalsBoxHeight} re f\n`
  s += '0.82 0.86 0.90 RG\n'
  s += '0.75 w\n'
  s += `${totalsBoxX} ${totalsBoxY} ${totalsBoxWidth} ${totalsBoxHeight} re s\n`

  // Linha de Subtotal
  const subtotalValue = quote.subtotal || quote.total
  const discountValue = quote.discount || 0
  const totalValue = quote.total

  let lineOffset = totalsBoxY + totalsBoxHeight - 22

  s += 'BT\n'
  s += '/F1 9 Tf\n'
  s += '0.35 0.40 0.45 rg\n'
  s += `${totalsBoxX + 14} ${lineOffset} Td (${escapePdfLiteral('Subtotal das Pecas:')}) Tj\n`
  s += '/F2 9 Tf\n'
  s += '0.15 0.20 0.25 rg\n'
  s += `120 0 Td (${escapePdfLiteral(formatPdfCurrency(subtotalValue))}) Tj\n`
  s += 'ET\n'

  lineOffset -= 18

  if (discountValue > 0) {
    s += 'BT\n'
    s += '/F1 9 Tf\n'
    s += '0.80 0.20 0.20 rg\n'
    s += `${totalsBoxX + 14} ${lineOffset} Td (${escapePdfLiteral('Desconto Especial:')}) Tj\n`
    s += '/F2 9 Tf\n'
    s += `120 0 Td (${escapePdfLiteral(`- ${formatPdfCurrency(discountValue)}`)}) Tj\n`
    s += 'ET\n'
    lineOffset -= 18
  }

  // Divisória antes do TOTAL FINAL
  s += '0.85 0.88 0.92 RG\n'
  s += '0.5 w\n'
  s += `${totalsBoxX + 10} ${totalsBoxY + 40} m ${totalsBoxX + totalsBoxWidth - 10} ${totalsBoxY + 40} l S\n`

  // Faixa de destaque para o VALOR TOTAL (fundo esmeralda suave)
  s += '0.04 0.48 0.32 rg\n'
  s += `${totalsBoxX + 6} ${totalsBoxY + 6} ${totalsBoxWidth - 12} 30 re f\n`

  s += 'BT\n'
  s += '/F2 11 Tf\n'
  s += '1 1 1 rg\n'
  s += `${totalsBoxX + 14} ${totalsBoxY + 16} Td (${escapePdfLiteral('VALOR TOTAL:')}) Tj\n`
  s += '/F2 13 Tf\n'
  s += `90 0 Td (${escapePdfLiteral(formatPdfCurrency(totalValue))}) Tj\n`
  s += 'ET\n'

  // CAIXA DE OBSERVAÇÕES E CONDIÇÕES (Esquerda)
  const notesBoxX = marginX
  const notesBoxWidth = totalsBoxX - marginX - 16 // ~ 277 pt
  const notesBoxHeight = totalsBoxHeight
  const notesBoxY = totalsBoxY

  s += '0.98 0.99 1 rg\n'
  s += `${notesBoxX} ${notesBoxY} ${notesBoxWidth} ${notesBoxHeight} re f\n`
  s += '0.88 0.90 0.94 RG\n'
  s += '0.5 w\n'
  s += `${notesBoxX} ${notesBoxY} ${notesBoxWidth} ${notesBoxHeight} re s\n`

  s += 'BT\n'
  s += '/F2 8.5 Tf\n'
  s += '0.20 0.25 0.30 rg\n'
  s += `${notesBoxX + 12} ${notesBoxY + notesBoxHeight - 18} Td (${escapePdfLiteral('CONDICOES E OBSERVACOES:')}) Tj\n`
  s += 'ET\n'

  // Processar observações do orçamento com quebra de linha limpa e sem sobreposição
  const userNotes = cleanPdfText(quote.notes || '')
  const defaultNotice =
    'Orcamento valido por 10 dias a contar da data de emissao. Pecas de suspensao com garantia oficial RPA. Instalacao sob consulta.'

  let notesLines: string[] = []
  if (userNotes) {
    // Quebra respeitando parágrafos e limite de largura (~46 caracteres por linha)
    notesLines = wrapText(userNotes, 46)
  } else {
    notesLines = wrapText(defaultNotice, 46)
  }

  // Renderiza até 5 linhas com entrelinha adequada
  let noteTextY = notesBoxY + notesBoxHeight - 32
  notesLines.slice(0, 5).forEach((line) => {
    if (line) {
      s += 'BT\n'
      s += '/F1 8 Tf\n'
      s += '0.35 0.40 0.45 rg\n'
      s += `${notesBoxX + 12} ${noteTextY} Td (${escapePdfLiteral(line)}) Tj\n`
      s += 'ET\n'
    }
    noteTextY -= 11.5
  })

  // Se houver validade padrão e couber, adiciona lembrete discreto
  if (userNotes && notesLines.length <= 3 && noteTextY >= notesBoxY + 14) {
    s += 'BT\n'
    s += '/F1 7 Tf\n'
    s += '0.50 0.55 0.60 rg\n'
    s += `${notesBoxX + 12} ${notesBoxY + 10} Td (${escapePdfLiteral('* Proposta valida por 10 dias. Garantia e procedencia RPA.')}) Tj\n`
    s += 'ET\n'
  }

  // ==========================================
  // 7. RODAPÉ INSTITUCIONAL (Y: 20 a 50)
  // ==========================================
  s += '0.86 0.89 0.92 RG\n'
  s += '0.5 w\n'
  s += `${marginX} 52 m ${marginX + contentWidth} 52 l S\n`

  s += 'BT\n'
  s += '/F2 7.5 Tf\n'
  s += '0.35 0.40 0.45 rg\n'
  s += `${marginX} 38 Td (${escapePdfLiteral('RPA Auto Parts Industria e Comercio de Pecas Automotivas')}) Tj\n`

  s += '/F1 7.5 Tf\n'
  s += '0.50 0.55 0.60 rg\n'
  s += `0 -11 Td (${escapePdfLiteral('Documento Comercial Oficial gerado via Sistema Integrado de Vendas - Pagina 1/1')}) Tj\n`

  // Lado direito do rodapé: status do orçamento
  s += '/F2 7.5 Tf\n'
  s += '0.04 0.48 0.32 rg\n'
  const statusLabel = cleanPdfText(quote.status || 'orcamento').toUpperCase()
  s += `${contentWidth - 110} 11 Td (${escapePdfLiteral(`STATUS: ${statusLabel}`)}) Tj\n`
  s += 'ET\n'

  // ==========================================
  // 8. ESTRUTURA DO ARQUIVO PDF (PDF 1.4 Standard)
  // ==========================================
  const contentStream = s
  const contentLength = new TextEncoder().encode(contentStream).length

  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>'
  objects[4] = `<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream`
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  let pdfText = '%PDF-1.4\n'
  const offsets: number[] = []

  for (let i = 1; i <= 6; i++) {
    offsets[i] = new TextEncoder().encode(pdfText).length
    pdfText += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefStart = new TextEncoder().encode(pdfText).length
  pdfText += 'xref\n0 7\n0000000000 65535 f \n'
  for (let i = 1; i <= 6; i++) {
    const offStr = String(offsets[i]).padStart(10, '0')
    pdfText += `${offStr} 00000 n \n`
  }

  pdfText += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  return new TextEncoder().encode(pdfText)
}

/**
 * Converte os bytes do PDF gerado para Base64 data URL compatível com envio de arquivos
 */
export function generateQuotePdfBase64(data: QuotePdfData): string {
  const bytes = generateQuotePdfBytes(data)
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return `data:application/pdf;base64,${base64}`
}

/**
 * Aciona o download local do arquivo PDF do orçamento no navegador
 */
export function downloadQuotePdf(data: QuotePdfData): void {
  const bytes = generateQuotePdfBytes(data)
  // Cria cópia segura em ArrayBuffer padrão para compatibilidade de BlobPart
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeNumber = (data.quote.number || 'orcamento').replace(/[^a-zA-Z0-9-_]/g, '_')
  a.download = `${safeNumber}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
