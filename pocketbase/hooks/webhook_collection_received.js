onRecordAfterCreateSuccess((e) => {
  try {
    const record = e.record
    const recordType = record.getString('type') || ''
    const messageId = record.getString('messageId') || ''
    const rawInstanceId = record.getString('instanceId') || ''

    let maskedInstanceId = ''
    if (rawInstanceId) {
      if (rawInstanceId.length > 8) {
        maskedInstanceId = rawInstanceId.slice(0, 4) + '****' + rawInstanceId.slice(-4)
      } else {
        maskedInstanceId = '****'
      }
    }

    let rawPhone = ''
    try {
      const phoneVal = record.get('phone')
      if (phoneVal) {
        if (typeof phoneVal === 'string') {
          rawPhone = phoneVal
        } else if (typeof phoneVal === 'object' && phoneVal.phone) {
          rawPhone = String(phoneVal.phone)
        }
      }
    } catch (_) {}

    if (!rawPhone) {
      try {
        const senderVal = record.get('sender')
        if (senderVal) {
          if (typeof senderVal === 'string') {
            rawPhone = senderVal
          } else if (typeof senderVal === 'object' && senderVal.phone) {
            rawPhone = String(senderVal.phone)
          }
        }
      } catch (_) {}
    }

    rawPhone = rawPhone.replace(/\D/g, '')

    let maskedSenderPhone = ''
    if (rawPhone) {
      if (rawPhone.length > 4) {
        maskedSenderPhone = '****' + rawPhone.slice(-4)
      } else {
        maskedSenderPhone = '****'
      }
    }

    console.log(
      '[WEBHOOK-COLLECTION-RECEIVED]',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        type: recordType,
        instanceId: maskedInstanceId,
        senderPhone: maskedSenderPhone,
        messageId: messageId,
      }),
    )
  } catch (err) {
    console.log('[WEBHOOK-COLLECTION-RECEIVED-ERROR]', err.message || String(err))
  }

  e.next()
}, 'webhook_received')
