import { Customer } from '@/types/crm'
import logoPngUrl from '@/assets/logo-4855f.png'
import { preloadQuotePdfLogo, formatPdfCurrency } from '@/services/quotePdfService'

export interface PurchaseSupplierPdfItem {
  part_name: string
  vehicle?: string
  quantity: number
  reduced_code?: string
  unit_price?: number
}

export interface PurchaseSupplierPdfData {
  supplier: Customer
  items: PurchaseSupplierPdfItem[]
  osNumber?: string
  deliveryDays?: string | number
  notes?: string
}

function cleanPdfText(text: string | null | undefined): string {
  if (!text) return ''
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[\\()]/g, '')
    .trim()
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

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

export async function generatePurchaseSupplierPdfBase64Async(
  data: PurchaseSupplierPdfData,
): Promise<string> {
  const logo = await preloadQuotePdfLogo()
  const bytes = generatePurchaseSupplierPdfBytes(data, logo)
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return `data:application/pdf;base64,${base64}`
}

export function generatePurchaseSupplierPdfBytes(
  data: PurchaseSupplierPdfData,
  logoPayloadOverride?: any,
): Uint8Array {
  const { supplier, items, osNumber, deliveryDays, notes } = data
  const logo = logoPayloadOverride
  const hasLogoImage = Boolean(logo && logo.jpegBytes && logo.jpegBytes.length > 0)

  const supplierName = cleanPdfText(supplier.name || supplier.company) || 'Fornecedor'
  const supplierPhone = cleanPdfText(supplier.phone)
  const supplierDoc = cleanPdfText(supplier.cnpj || supplier.cpf)
  const dateStr = new Date().toLocaleDateString('pt-BR')
  const osLabel = osNumber ? `OS ${cleanPdfText(osNumber)}` : 'SOLICITACAO DE COTACAO'

  const marginX = 36
  const pageWidth = 595
  const contentWidth = 523

  let s = ''

  // 1. Barra âmbar de topo (Pipeline de Compras)
  // rgb(0.85, 0.45, 0.08)
  s += '0.85 0.45 0.08 rg\n'
  s += `0 834 ${pageWidth} 8 re f\n`

  // 2. Cabeçalho com Logo
  const logoLeftX = marginX
  const logoWidth = 114
  const logoHeight = 57
  const logoBottomY = 762

  if (hasLogoImage) {
    s += 'q\n'
    s += `${logoWidth} 0 0 ${logoHeight} ${logoLeftX} ${logoBottomY} cm\n`
    s += '/ImLogo Do\n'
    s += 'Q\n'
  } else {
    s += '0.98 0.95 0.90 rg\n'
    s += `${logoLeftX} ${logoBottomY} ${logoWidth} ${logoHeight} re f\n`
    s += '0.90 0.80 0.70 RG\n'
    s += '0.75 w\n'
    s += `${logoLeftX} ${logoBottomY} ${logoWidth} ${logoHeight} re s\n`

    s += 'BT\n'
    s += '/F2 13 Tf\n'
    s += '0.85 0.45 0.08 rg\n'
    s += `${logoLeftX + 38} ${logoBottomY + 34} Td\n`
    s += `(${escapePdfLiteral('RPA')}) Tj\n`
    s += '/F2 7.5 Tf\n'
    s += '0.15 0.20 0.25 rg\n'
    s += `0 -11 Td\n`
    s += `(${escapePdfLiteral('AUTO PARTS')}) Tj\n`
    s += 'ET\n'
  }

  // Dados da empresa RPA
  const companyInfoX = marginX + logoWidth + 20
  s += 'BT\n'
  s += '/F2 16 Tf\n'
  s += '0.85 0.45 0.08 rg\n'
  s += `${companyInfoX} 805 Td\n`
  s += `(${escapePdfLiteral('RPA AUTO PARTS - COMPRAS')}) Tj\n`

  s += '/F2 9 Tf\n'
  s += '0.22 0.28 0.34 rg\n'
  s += `0 -13 Td\n`
  s += `(${escapePdfLiteral('SOLICITACAO DE COTACAO / PEDIDO DE COMPRA')}) Tj\n`

  s += '/F1 8.5 Tf\n'
  s += '0.42 0.46 0.52 rg\n'
  s += `0 -12 Td\n`
  s += `(${escapePdfLiteral('Departamento de Suprimentos & Aquisicao de Pecas')}) Tj\n`
  s += `0 -11 Td\n`
  s += `(${escapePdfLiteral('WhatsApp: (11) 94786-1439  |  Desde 1995')}) Tj\n`
  s += 'ET\n'

  s += '0.86 0.89 0.92 RG\n'
  s += '0.75 w\n'
  s += `${marginX} 752 m ${marginX + contentWidth} 752 l S\n`

  // 3. Faixa de Identificação
  s += '0.98 0.96 0.92 rg\n'
  s += `${marginX} 714 ${contentWidth} 32 re f\n`
  s += '0.90 0.80 0.65 RG\n'
  s += '0.75 w\n'
  s += `${marginX} 714 ${contentWidth} 32 re s\n`

  s += 'BT\n'
  s += '/F2 11 Tf\n'
  s += '0.75 0.35 0.05 rg\n'
  s += `${marginX + 12} 726 Td\n`
  s += `(${escapePdfLiteral(`SOLICITACAO DE COTACAO: ${osLabel}`)}) Tj\n`

  s += '/F1 9 Tf\n'
  s += '0.30 0.35 0.40 rg\n'
  s += `${contentWidth - 145} 0 Td\n`
  s += `(${escapePdfLiteral(`Data de Envio: ${dateStr}`)}) Tj\n`
  s += 'ET\n'

  // 4. Bloco de Dados do Fornecedor
  const supBoxY = 650
  const supBoxHeight = 54
  s += '0.99 0.99 1 rg\n'
  s += `${marginX} ${supBoxY} ${contentWidth} ${supBoxHeight} re f\n`
  s += '0.88 0.90 0.94 RG\n'
  s += '0.5 w\n'
  s += `${marginX} ${supBoxY} ${contentWidth} ${supBoxHeight} re s\n`

  s += '0.85 0.45 0.08 rg\n'
  s += `${marginX} ${supBoxY} 3.5 ${supBoxHeight} re f\n`

  s += 'BT\n'
  s += '/F2 8 Tf\n'
  s += '0.45 0.50 0.55 rg\n'
  s += `${marginX + 12} ${supBoxY + 38} Td\n`
  s += `(${escapePdfLiteral('FORNECEDOR DESTINATARIO')}) Tj\n`

  s += '/F2 10.5 Tf\n'
  s += '0.10 0.12 0.15 rg\n'
  s += `0 -13 Td\n`
  s += `(${escapePdfLiteral(supplierName.toUpperCase())}) Tj\n`

  s += '/F1 8.5 Tf\n'
  s += '0.35 0.40 0.45 rg\n'
  s += `0 -12 Td\n`
  const phoneText = supplierPhone ? `WhatsApp: ${supplierPhone}` : 'Telefone: Nao informado'
  const docText = supplierDoc ? `  |  CNPJ/CPF: ${supplierDoc}` : ''
  const prazoText = deliveryDays ? `  |  Prazo solicitado: ${deliveryDays} dia(s)` : ''
  s += `(${escapePdfLiteral(`${phoneText}${docText}${prazoText}`)}) Tj\n`
  s += 'ET\n'

  // 5. Tabela de Itens Solicitados ao Fornecedor
  const colXItem = marginX + 8
  const colXDesc = marginX + 32
  const colXQty = marginX + 340
  const colXVeh = marginX + 400

  const tableHeaderY = 618
  const tableHeaderHeight = 22

  s += '0.25 0.30 0.35 rg\n'
  s += `${marginX} ${tableHeaderY} ${contentWidth} ${tableHeaderHeight} re f\n`

  s += 'BT\n'
  s += '/F2 8.5 Tf\n'
  s += '1 1 1 rg\n'
  s += `${colXItem} ${tableHeaderY + 7} Td (${escapePdfLiteral('#')}) Tj\n`
  s += `${colXDesc - colXItem} 0 Td (${escapePdfLiteral('DESCRICAO DA PECA / PRODUTO')}) Tj\n`
  s += `${colXQty - colXDesc} 0 Td (${escapePdfLiteral('QTD')}) Tj\n`
  s += `${colXVeh - colXQty} 0 Td (${escapePdfLiteral('VEICULO / APLICACAO')}) Tj\n`
  s += 'ET\n'

  let currentY = tableHeaderY - 22
  const rowHeight = 24
  const maxItems = 16
  const displayItems = items.slice(0, maxItems)

  displayItems.forEach((item, index) => {
    const isEven = index % 2 === 0
    if (isEven) {
      s += '0.97 0.98 0.99 rg\n'
      s += `${marginX} ${currentY} ${contentWidth} ${rowHeight} re f\n`
    }

    s += '0.88 0.90 0.93 RG\n'
    s += '0.5 w\n'
    s += `${marginX} ${currentY} m ${marginX + contentWidth} ${currentY} l S\n`

    const rawProdName = cleanPdfText(item.part_name || `Item ${index + 1}`)
    const reducedCodeText = item.reduced_code ? ` [cod. ${cleanPdfText(item.reduced_code)}]` : ''
    const prodName = `${rawProdName}${reducedCodeText}`.slice(0, 58)
    const qty = String(item.quantity || 1)
    const veh = cleanPdfText(item.vehicle || '—').slice(0, 24)

    s += 'BT\n'
    s += '/F1 8.5 Tf\n'
    s += '0.35 0.40 0.45 rg\n'
    s += `${colXItem} ${currentY + 7} Td (${escapePdfLiteral(String(index + 1))}) Tj\n`

    s += '/F2 8.5 Tf\n'
    s += '0.12 0.15 0.18 rg\n'
    s += `${colXDesc - colXItem} 0 Td (${escapePdfLiteral(prodName)}) Tj\n`

    s += '/F2 9 Tf\n'
    s += '0.85 0.45 0.08 rg\n'
    s += `${colXQty - colXDesc + 4} 0 Td (${escapePdfLiteral(qty)}) Tj\n`

    s += '/F1 8.5 Tf\n'
    s += '0.25 0.30 0.35 rg\n'
    s += `${colXVeh - (colXQty + 4)} 0 Td (${escapePdfLiteral(veh)}) Tj\n`
    s += 'ET\n'

    currentY -= rowHeight
  })

  // 6. Bloco de Observações e Instruções de Cotação
  const notesBoxY = Math.min(currentY - 14, 310) - 100
  const notesBoxHeight = 100

  s += '0.98 0.99 1 rg\n'
  s += `${marginX} ${notesBoxY} ${contentWidth} ${notesBoxHeight} re f\n`
  s += '0.88 0.90 0.94 RG\n'
  s += '0.5 w\n'
  s += `${marginX} ${notesBoxY} ${contentWidth} ${notesBoxHeight} re s\n`

  s += 'BT\n'
  s += '/F2 8.5 Tf\n'
  s += '0.20 0.25 0.30 rg\n'
  s += `${marginX + 12} ${notesBoxY + notesBoxHeight - 18} Td (${escapePdfLiteral('INSTRUCOES AO FORNECEDOR / OBSERVACOES:')}) Tj\n`
  s += 'ET\n'

  const userNotes = cleanPdfText(notes || '')
  const defaultNotice =
    'Favor nos retornar informando disponibilidade, melhor preco, prazo de entrega e condicoes de pagamento via WhatsApp ou telefone. Agradecemos a parceria.'

  const fullNotice = userNotes ? `${userNotes}\n\n${defaultNotice}` : defaultNotice
  const notesLines = wrapText(fullNotice, 90)

  let noteTextY = notesBoxY + notesBoxHeight - 32
  notesLines.slice(0, 5).forEach((line) => {
    if (line) {
      s += 'BT\n'
      s += '/F1 8 Tf\n'
      s += '0.35 0.40 0.45 rg\n'
      s += `${marginX + 12} ${noteTextY} Td (${escapePdfLiteral(line)}) Tj\n`
      s += 'ET\n'
    }
    noteTextY -= 12
  })

  // 7. Rodapé
  s += '0.86 0.89 0.92 RG\n'
  s += '0.5 w\n'
  s += `${marginX} 52 m ${marginX + contentWidth} 52 l S\n`

  s += 'BT\n'
  s += '/F2 7.5 Tf\n'
  s += '0.35 0.40 0.45 rg\n'
  s += `${marginX} 38 Td (${escapePdfLiteral('RPA Auto Parts Industria e Comercio de Pecas Automotivas')}) Tj\n`

  s += '/F1 7.5 Tf\n'
  s += '0.50 0.55 0.60 rg\n'
  s += `0 -11 Td (${escapePdfLiteral('Solicitacao de Cotacao de Compras - Documento Oficial - Pagina 1/1')}) Tj\n`
  s += 'ET\n'

  // Estrutura PDF 1.4
  const encoder = new TextEncoder()
  const contentStreamBytes = encoder.encode(s)

  const numObjects = hasLogoImage ? 7 : 6
  const resourcesStr = hasLogoImage
    ? '<< /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /ImLogo 7 0 R >> >>'
    : '<< /Font << /F1 5 0 R /F2 6 0 R >> >>'

  const objectChunks: { id: number; data: Uint8Array }[] = []

  objectChunks.push({
    id: 1,
    data: encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
  })

  objectChunks.push({
    id: 2,
    data: encoder.encode('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
  })

  objectChunks.push({
    id: 3,
    data: encoder.encode(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources ${resourcesStr} >>\nendobj\n`,
    ),
  })

  const header4 = encoder.encode(`4 0 obj\n<< /Length ${contentStreamBytes.length} >>\nstream\n`)
  const footer4 = encoder.encode('\nendstream\nendobj\n')
  const obj4 = new Uint8Array(header4.length + contentStreamBytes.length + footer4.length)
  obj4.set(header4, 0)
  obj4.set(contentStreamBytes, header4.length)
  obj4.set(footer4, header4.length + contentStreamBytes.length)
  objectChunks.push({ id: 4, data: obj4 })

  objectChunks.push({
    id: 5,
    data: encoder.encode(
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ),
  })

  objectChunks.push({
    id: 6,
    data: encoder.encode(
      '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    ),
  })

  if (hasLogoImage && logo) {
    const imgWidth = logo.width
    const imgHeight = logo.height
    const imgLen = logo.jpegBytes.length

    const header7 = encoder.encode(
      `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLen} >>\nstream\n`,
    )
    const footer7 = encoder.encode('\nendstream\nendobj\n')
    const obj7 = new Uint8Array(header7.length + imgLen + footer7.length)
    obj7.set(header7, 0)
    obj7.set(logo.jpegBytes, header7.length)
    obj7.set(footer7, header7.length + imgLen)
    objectChunks.push({ id: 7, data: obj7 })
  }

  const headerBytes = encoder.encode('%PDF-1.4\n')
  const offsets: number[] = new Array(numObjects + 1)
  offsets[0] = 0

  let currentOffset = headerBytes.length
  for (const obj of objectChunks) {
    offsets[obj.id] = currentOffset
    currentOffset += obj.data.length
  }

  const xrefStart = currentOffset
  let xrefStr = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= numObjects; i++) {
    const offStr = String(offsets[i]).padStart(10, '0')
    xrefStr += `${offStr} 00000 n \n`
  }

  xrefStr += `trailer\n<< /Size ${numObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  const xrefBytes = encoder.encode(xrefStr)

  const totalLength = currentOffset + xrefBytes.length
  const finalPdf = new Uint8Array(totalLength)
  finalPdf.set(headerBytes, 0)

  let pos = headerBytes.length
  for (const obj of objectChunks) {
    finalPdf.set(obj.data, pos)
    pos += obj.data.length
  }
  finalPdf.set(xrefBytes, pos)

  return finalPdf
}
