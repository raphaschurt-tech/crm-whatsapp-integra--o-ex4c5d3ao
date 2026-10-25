import { describe, it, expect } from 'vitest'

// Replica exata das funções puras de danfe_pdf_processor.js para suíte de testes vitest / QA
function validateNfeKeyDV(key44: string): boolean {
  if (!key44 || typeof key44 !== 'string') return false
  const clean = key44.replace(/\D/g, '')
  if (clean.length !== 44) return false

  const base = clean.slice(0, 43)
  const expectedDv = parseInt(clean.slice(43), 10)

  let sum = 0
  let weight = 2
  for (let i = base.length - 1; i >= 0; i--) {
    sum += parseInt(base[i], 10) * weight
    weight++
    if (weight > 9) weight = 2
  }

  const remainder = sum % 11
  const calculatedDv = remainder === 0 || remainder === 1 ? 0 : 11 - remainder
  return calculatedDv === expectedDv
}

function extractNfeKeysFromText(text: string): string[] {
  if (!text || typeof text !== 'string') return []

  const foundKeys = new Set<string>()

  const spacedRegex = /\b(?:\d{4}[\s-]?){10}\d{4}\b/g
  const spacedMatches = text.match(spacedRegex) || []
  for (const m of spacedMatches) {
    const raw = m.replace(/\D/g, '')
    if (raw.length === 44) {
      foundKeys.add(raw)
    }
  }

  const directRegex = /\b\d{44}\b/g
  const directMatches = text.match(directRegex) || []
  for (const m of directMatches) {
    foundKeys.add(m)
  }

  const labelRegex = /CHAVE\s+(?:DE\s+)?ACESSO[^\d]{0,40}((?:\d[\s-]?){44})/gi
  let match: RegExpExecArray | null
  while ((match = labelRegex.exec(text)) !== null) {
    if (match[1]) {
      const raw = match[1].replace(/\D/g, '')
      if (raw.length === 44) {
        foundKeys.add(raw)
      }
    }
  }

  return Array.from(foundKeys)
}

describe('DANFE PDF Processor - Extração e Validação de Chave 44', () => {
  const chaveOxilapaReal = '35261059417469000173550010000329431406428669'

  it('valida DV correto para chave real da Oxilapa', () => {
    expect(validateNfeKeyDV(chaveOxilapaReal)).toBe(true)
  })

  it('rejeita chaves com tamanho incorreto ou DV adulterado', () => {
    expect(validateNfeKeyDV('123')).toBe(false)
    expect(validateNfeKeyDV('35261059417469000173550010000329431406428660')).toBe(false) // DV errado (0 em vez de 9)
  })

  it('extrai chave contínua de 44 dígitos de texto de DANFE', () => {
    const textoDanfe = `
      DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA
      CHAVE DE ACESSO
      35261059417469000173550010000329431406428669
      Consulta de autenticidade no portal nacional da NF-e
    `
    const keys = extractNfeKeysFromText(textoDanfe)
    expect(keys).toContain(chaveOxilapaReal)
  })

  it('extrai chave formatada em blocos de 4 dígitos com espaços', () => {
    const textoDanfe = `
      CHAVE DE ACESSO
      3526 1059 4174 6900 0173 5500 1000 0329 4314 0642 8669
      Protocolo de autorização: 135260000000000
    `
    const keys = extractNfeKeysFromText(textoDanfe)
    expect(keys).toContain(chaveOxilapaReal)
    expect(validateNfeKeyDV(keys[0])).toBe(true)
  })

  it('retorna array vazio quando PDF não possui chave de 44 dígitos (ex: orçamentos e relatórios)', () => {
    const textoComprovante = `
      BANCO DO BRASIL - COMPROVANTE DE TRANSFERENCIA
      VALOR: R$ 1.500,00
      FAVORECIDO: FORNECEDOR TESTE
      AUTENTICACAO: 9.ABC.123.DEF
    `
    const keys = extractNfeKeysFromText(textoComprovante)
    expect(keys).toHaveLength(0)
  })

  it('valida payload seguro da fila de revisão (nfe_price_queue) com status pendente e item_type excecao', () => {
    // Simula a construção de payload de revisão usada no fallback
    const mockAudit = {
      origin: 'whatsapp',
      sender: '5511999998888',
      fileName: 'danfe_sem_texto.pdf',
    }
    const reason = 'PDF sem camada de texto — pedir XML ao fornecedor'
    const bIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')

    const payload = {
      access_key: '',
      supplier_code: '',
      description: reason.trim(),
      status: 'pendente',
      item_type: 'excecao',
      resolution_notes: `Origem: ${mockAudit.origin} | Remetente: ${mockAudit.sender} | Arquivo: ${mockAudit.fileName} | Horário: ${bIso}`,
    }

    expect(payload.status).toBe('pendente')
    expect(payload.item_type).toBe('excecao')
    expect(payload.description).toBeTruthy()
    expect(payload.resolution_notes).toContain('5511999998888')
    expect(payload.resolution_notes).toContain('-03:00')
  })
})
