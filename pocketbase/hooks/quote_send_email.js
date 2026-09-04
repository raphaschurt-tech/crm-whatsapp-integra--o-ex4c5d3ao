// Endpoint autenticado para envio de e-mail de orçamento
// Rota: POST /backend/v1/quotes/send-email
// Body: { quote_id: string, email: string, subject?: string, message: string }
routerAdd(
  'POST',
  '/backend/v1/quotes/send-email',
  (e) => {
    const reqInfo = e.requestInfo()
    const rawBody = reqInfo.body || {}

    const quoteId = String(rawBody.quote_id || '').trim()
    const toEmail = String(rawBody.email || '').trim()
    const messageText = String(rawBody.message || '').trim()
    const subject = String(rawBody.subject || 'Orçamento RPA Auto Parts').trim()

    if (!toEmail || !messageText) {
      return e.json(400, {
        ok: false,
        error: 'E-mail de destino e mensagem são obrigatórios',
      })
    }

    // Tenta enviar via e-mail transacional do PocketBase
    let emailSent = false
    let emailError = ''

    try {
      const mailer = $app.newMailClient()
      const message = new MailerMessage()
      message.from = {
        address: $app.settings().meta.senderAddress || 'orcamentos@rpaautoparts.com.br',
        name: $app.settings().meta.senderName || 'RPA Auto Parts',
      }
      message.to = [{ address: toEmail }]
      message.subject = subject
      message.text = messageText
      message.html =
        '<pre style="font-family: sans-serif; white-space: pre-wrap; line-height: 1.5;">' +
        messageText.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
        '</pre>'

      mailer.send(message)
      emailSent = true
    } catch (mailErr) {
      emailError = mailErr.message || String(mailErr)
    }

    // Se o envio transacional falhou porque não há SMTP configurado no PocketBase,
    // informamos com ok: false para o frontend acionar o fallback suave mailto:
    console.log(
      '[QUOTE-EMAIL-SEND]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        quoteId: quoteId,
        toEmail: toEmail,
        emailSent: emailSent,
        error: emailError || null,
      }),
    )

    return e.json(200, {
      ok: emailSent,
      sent: emailSent,
      error: emailSent ? null : emailError,
    })
  },
  $apis.requireAuth(),
)
