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
