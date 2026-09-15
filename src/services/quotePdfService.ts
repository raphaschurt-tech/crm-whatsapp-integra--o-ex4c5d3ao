import { Quote, QuoteItem, Customer } from '@/types/crm'
import { formatCurrency } from '@/lib/whatsapp'

export interface QuotePdfData {
  quote: Quote
  items: QuoteItem[]
  customer?: Customer | null
}

/**
 * Escapa strings para formato seguro em PDF (ASCII básico/ISO-8859-1 simples)
 */
function cleanPdfText(text: string): string {
  if (!text) return ''
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos para PDF padrão Type1 (Helvetica)
    .replace(/[\\()]/g, '') // remove parênteses e barras invertidas de controle
}

/**
 * Gera um arquivo PDF no padrão PDF 1.4 limpo e bem formatado, sem dependências externas.
 * Retorna Uint8Array com os bytes brutos do PDF.
 */
export function generateQuotePdfBytes(data: QuotePdfData): Uint8Array {
  const { quote, items, customer } = data

  const customerName = cleanPdfText(customer?.name || quote.expand?.customer?.name || 'Cliente')
  const customerPhone = cleanPdfText(customer?.phone || quote.expand?.customer?.phone || '')
  const customerEmail = cleanPdfText(customer?.email || quote.expand?.customer?.email || '')
  const customerCompany = cleanPdfText(customer?.company || quote.expand?.customer?.company || '')
  const quoteNumber = cleanPdfText(quote.number || 'ORCAMENTO')
  const dateStr = new Date(quote.created || Date.now()).toLocaleDateString('pt-BR')

  // Dimensões A4 em pontos: 595 x 842 pt
  // Margens: 40pt
  const streams: string[] = []

  // Construção do stream gráfico de desenho da página
  let s = ''

  // Cabeçalho da Empresa (Faixa Superior)
  // Retângulo superior verde RPA: rgb(0.06, 0.58, 0.35)
  s += '0.06 0.58 0.35 rg\n'
  s += '40 760 515 50 re f\n'

  // Texto do cabeçalho
  s += 'BT\n'
  s += '/F2 20 Tf\n'
  s += '1 1 1 rg\n'
  s += '55 778 Td\n'
  s += '(RPA AUTO PARTS) Tj\n'
  s += 'ET\n'

  s += 'BT\n'
  s += '/F1 10 Tf\n'
  s += '1 1 1 rg\n'
  s += '360 782 Td\n'
  s += `(ORCAMENTO: ${quoteNumber}) Tj\n`
  s += '0 -14 Td\n'
  s += `(Data: ${dateStr}) Tj\n`
  s += 'ET\n'

  // Dados da Empresa e do Cliente (2 Blocos)
  // Bloco Cliente (Fundo cinza claro)
  s += '0.96 0.97 0.98 rg\n'
  s += '40 680 515 65 re f\n'
  s += '0.85 0.88 0.91 RG\n'
  s += '0.8 w\n'
  s += '40 680 515 65 re s\n'

  s += 'BT\n'
  s += '/F2 11 Tf\n'
  s += '0.1 0.1 0.1 rg\n'
  s += '55 725 Td\n'
  s += `(CLIENTE: ${customerName}) Tj\n`
  s += '/F1 9 Tf\n'
  s += '0.3 0.3 0.3 rg\n'
  s += '0 -15 Td\n'
  s += `(Telefone: ${customerPhone || 'Nao informado'}   Email: ${customerEmail || 'Nao informado'}) Tj\n`
  if (customerCompany) {
    s += '0 -13 Td\n'
    s += `(Empresa: ${customerCompany}) Tj\n`
  }
  s += 'ET\n'

  // Tabela de Itens
  // Cabeçalho da Tabela
  s += '0.90 0.93 0.95 rg\n'
  s += '40 645 515 22 re f\n'

  s += 'BT\n'
  s += '/F2 9 Tf\n'
  s += '0.2 0.2 0.2 rg\n'
  s += '50 652 Td (ITEM / DESCRICAO) Tj\n'
  s += '270 0 Td (QTD) Tj\n'
  s += '60 0 Td (VALOR UN.) Tj\n'
  s += '80 0 Td (TOTAL) Tj\n'
  s += 'ET\n'

  // Linhas de Itens
  let currentY = 625
  const rowHeight = 22

  items.slice(0, 18).forEach((item, index) => {
    const isEven = index % 2 === 0
    if (isEven) {
      s += '0.98 0.98 0.99 rg\n'
      s += `40 ${currentY - 4} 515 ${rowHeight} re f\n`
    }
    // Linha inferior suave
    s += '0.90 0.90 0.92 RG\n'
    s += '0.5 w\n'
    s += `40 ${currentY - 4} m 555 ${currentY - 4} l S\n`

    const prodName = cleanPdfText(
      item.expand?.product?.name || item.product || `Item ${index + 1}`,
    ).slice(0, 38)
    const qty = String(item.quantity || 1)
    const unitPrice = formatCurrency(item.unit_price || 0)
    const totalItem = formatCurrency(item.total || 0)

    s += 'BT\n'
    s += '/F1 9 Tf\n'
    s += '0.15 0.15 0.15 rg\n'
    s += `50 ${currentY + 2} Td (${index + 1}. ${prodName}) Tj\n`
    s += `275 0 Td (${qty}) Tj\n`
    s += `50 0 Td (${unitPrice}) Tj\n`
    s += `80 0 Td (${totalItem}) Tj\n`
    s += 'ET\n'

    currentY -= rowHeight
  })

  // Bloco de Totais
  const totalsY = Math.max(160, currentY - 20)
  s += '0.95 0.97 0.96 rg\n'
  s += `320 ${totalsY - 10} 235 75 re f\n`
  s += '0.7 0.85 0.75 RG\n'
  s += '1 w\n'
  s += `320 ${totalsY - 10} 235 75 re s\n`

  s += 'BT\n'
  s += '/F1 10 Tf\n'
  s += '0.3 0.3 0.3 rg\n'
  s += `335 ${totalsY + 45} Td (Subtotal:) Tj\n`
  s += `120 0 Td (${formatCurrency(quote.subtotal || quote.total)}) Tj\n`
  if (quote.discount && quote.discount > 0) {
    s += `-120 -16 Td (Desconto:) Tj\n`
    s += `120 0 Td (- ${formatCurrency(quote.discount)}) Tj\n`
  }
  s += `-120 -20 Td\n`
  s += '/F2 13 Tf\n'
  s += '0.06 0.58 0.35 rg\n'
  s += '(VALOR TOTAL:) Tj\n'
  s += `100 0 Td (${formatCurrency(quote.total)}) Tj\n`
  s += 'ET\n'

  // Bloco de Observações / Validade
  const notesText = cleanPdfText(
    quote.notes || 'Orcamento valido por 10 dias. Pecas sujeitas a confirmacao de estoque.',
  )
  s += 'BT\n'
  s += '/F2 9 Tf\n'
  s += '0.3 0.3 0.3 rg\n'
  s += `45 ${totalsY + 45} Td (OBSERVACOES E CONDICOES:) Tj\n`
  s += '/F1 8 Tf\n'
  s += '0.4 0.4 0.4 rg\n'
  s += `0 -14 Td (${notesText.slice(0, 55)}) Tj\n`
  if (notesText.length > 55) {
    s += `0 -11 Td (${notesText.slice(55, 110)}) Tj\n`
  }
  s += 'ET\n'

  // Rodapé Oficial
  s += '0.85 0.85 0.85 RG\n'
  s += '0.5 w\n'
  s += '40 60 m 555 60 l S\n'

  s += 'BT\n'
  s += '/F1 8 Tf\n'
  s += '0.5 0.5 0.5 rg\n'
  s +=
    '140 45 Td (RPA Auto Parts - Pecas e Acessorios Automotivos - Documento Oficial de Orcamento) Tj\n'
  s += 'ET\n'

  // Montar objeto PDF completo com cross-reference table válida
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
