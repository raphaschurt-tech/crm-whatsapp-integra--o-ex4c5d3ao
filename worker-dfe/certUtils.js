/**
 * worker-dfe/certUtils.js
 * Leitura de certificado digital A1 (.pfx/.p12), extração de CNPJ e verificação de validade.
 * Guards D7, D8, D9 (senha secreta, cálculo de dias restantes, alerta <30 dias, bloqueio se vencido).
 */

const fs = require('fs')
const forge = require('node-forge')

function readCertInfo(pfxPath, password) {
  if (!fs.existsSync(pfxPath)) {
    return {
      valid: false,
      error: `Arquivo de certificado não encontrado no caminho: ${pfxPath} (D7)`,
    }
  }

  try {
    const pfxBuffer = fs.readFileSync(pfxPath)
    const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
    const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password || '')

    // Buscar certificado
    let certBag = null
    for (let i = 0; i < pfx.safeContents.length; i++) {
      const safeContents = pfx.safeContents[i]
      for (let j = 0; j < safeContents.safeBags.length; j++) {
        const bag = safeContents.safeBags[j]
        if (bag.cert) {
          certBag = bag.cert
          break
        }
      }
      if (certBag) break
    }

    if (!certBag) {
      return {
        valid: false,
        error: 'Certificado digital não encontrado dentro do arquivo PFX.',
      }
    }

    const notAfter = certBag.validity.notAfter
    const notBefore = certBag.validity.notBefore
    const now = new Date()

    const msPerDay = 1000 * 60 * 60 * 24
    const daysRemaining = Math.floor((notAfter.getTime() - now.getTime()) / msPerDay)
    const isExpired = daysRemaining < 0

    // Extrair CNPJ do Subject (OID 2.16.76.1.3.3 ou campo CN/serialNumber)
    let extractedCnpj = ''
    const subject = certBag.subject
    for (let i = 0; i < subject.attributes.length; i++) {
      const attr = subject.attributes[i]
      // OID ICP-Brasil CNPJ: 2.16.76.1.3.3
      if (attr.type === '2.16.76.1.3.3') {
        const rawVal = String(attr.value || '')
        const matchDigits = rawVal.replace(/\D/g, '')
        if (matchDigits.length >= 14) {
          extractedCnpj = matchDigits.slice(0, 14)
        }
      }
      // Alternativa: no CN (Common Name), formato: "RAZAO SOCIAL:00000000000000"
      if (!extractedCnpj && attr.name === 'commonName') {
        const cnVal = String(attr.value || '')
        const parts = cnVal.split(':')
        if (parts.length > 1) {
          const digits = parts[parts.length - 1].replace(/\D/g, '')
          if (digits.length === 14) extractedCnpj = digits
        }
      }
    }

    return {
      valid: !isExpired,
      isExpired,
      daysRemaining,
      notAfter: notAfter.toISOString(),
      notBefore: notBefore.toISOString(),
      extractedCnpj: extractedCnpj || '',
      subjectName: certBag.subject.getField('CN') ? certBag.subject.getField('CN').value : '',
    }
  } catch (err) {
    return {
      valid: false,
      error:
        'Falha ao decodificar certificado PFX (senha incorreta ou arquivo corrompido): ' +
        (err.message || String(err)),
    }
  }
}

module.exports = {
  readCertInfo,
}
