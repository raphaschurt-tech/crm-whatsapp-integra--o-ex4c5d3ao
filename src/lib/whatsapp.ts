export function cleanPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55')) return digits
  return `55${digits}`
}

export function openWhatsApp(phone: string, text: string) {
  const cleaned = cleanPhoneNumber(phone)
  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)
}

export interface QuoteMessageItem {
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export function buildDetailedQuoteMessage(
  quoteNumber: string,
  customerName: string,
  items: QuoteMessageItem[],
  subtotal: number,
  discount: number,
  total: number,
  paymentLink?: string,
): string {
  let msg = `Olá, *${customerName}*! Tudo bem?\n`
  msg += `Segue o resumo do seu orçamento *${quoteNumber}* na *RPA Auto Parts*:\n\n`
  msg += `📦 *ITENS DO ORÇAMENTO:*\n`
  items.forEach((item, index) => {
    msg += `${index + 1}. *${item.name}*\n`
    msg += `   ${item.quantity} un. x ${formatCurrency(item.unitPrice)} = *${formatCurrency(item.total)}*\n`
  })

  msg += `\n-------------------------\n`
  if (discount > 0) {
    msg += `Subtotal: ${formatCurrency(subtotal)}\n`
    msg += `Desconto: - ${formatCurrency(discount)}\n`
  }
  msg += `*VALOR TOTAL: ${formatCurrency(total)}*\n`
  msg += `-------------------------\n`

  if (paymentLink) {
    msg += `\n💳 *PAGAMENTO ON-LINE (PIX / Cartão):*\n`
    msg += `Acesse o link seguro para concluir seu pedido:\n${paymentLink}\n`
  }

  msg += `\nCaso tenha alguma dúvida ou queira ajustar a quantidade, basta responder por aqui!`
  return msg
}

export function buildQuoteMessage(
  quoteNumber: string,
  customerName: string,
  total: number,
  paymentLink?: string,
): string {
  let msg = `Olá, ${customerName}!\n\nSegue o seu orçamento *${quoteNumber}* no valor total de *${formatCurrency(total)}*.\n`
  if (paymentLink) {
    msg += `\nPara efetuar o pagamento com praticidade, acesse o link abaixo:\n${paymentLink}\n`
  }
  msg += `\nQualquer dúvida, estamos à disposição!`
  return msg
}

export function buildPaymentLinkMessage(
  quoteNumber: string,
  total: number,
  paymentLink: string,
): string {
  return `Olá! Aqui está o seu link de pagamento para o orçamento *${quoteNumber}* no valor de *${formatCurrency(total)}*:\n\n${paymentLink}\n\nAgradecemos a preferência!`
}

export function buildReceiptMessage(quoteNumber: string, total: number): string {
  return `Olá! Segue o comprovante do orçamento *${quoteNumber}* no valor de *${formatCurrency(total)}*. Obrigado pela preferência!`
}
