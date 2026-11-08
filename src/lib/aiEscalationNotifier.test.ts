/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import vm from 'vm'

describe('AI Escalation Notifier - Fase 7', () => {
  const hookFilePath = path.resolve(__dirname, '../../pocketbase/hooks/ai_escalation_notifier.js')

  const loadNotifierInContext = (customHttpSend?: any, customApp?: any) => {
    const sandbox: Record<string, any> = {
      console: console,
      Date: Date,
      Map: Map,
      String: String,
      Number: Number,
      Boolean: Boolean,
      JSON: JSON,
      encodeURIComponent: encodeURIComponent,
      $http: {
        send: customHttpSend || (() => ({ statusCode: 200, body: '{"ok":true}' })),
      },
      $app: customApp || null,
      globalThis: {},
    }
    sandbox.globalThis = sandbox

    const code = fs.readFileSync(hookFilePath, 'utf8')
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox)

    return sandbox.globalThis.__aiEscalationNotifier
  }

  it('arquivo ai_escalation_notifier.js existe e exporta helpers em globalThis.__aiEscalationNotifier', () => {
    const notifier = loadNotifierInContext()
    expect(notifier).toBeDefined()
    expect(notifier.TARGET_ESCALATION_PHONE).toBe('5511947518805')
    expect(typeof notifier.formatBrasiliaTime).toBe('function')
    expect(typeof notifier.formatPhoneDisplay).toBe('function')
    expect(typeof notifier.buildNotificationMessage).toBe('function')
    expect(typeof notifier.checkDedupe).toBe('function')
    expect(typeof notifier.notifyEscalation).toBe('function')
  })

  it('formata mensagem curta em tom de alerta interno com cliente, telefone, motivo, assunto e horário', () => {
    const notifier = loadNotifierInContext()
    const msg = notifier.buildNotificationMessage({
      customerName: 'Raphael Schurt',
      phone: '5511947518805',
      reason: 'reclamacao',
      subject: 'peça com prazo estourado',
      timeStr: '11:48',
    })

    expect(msg).toBe(
      '🔔 ESCALADA — Cliente Raphael Schurt ((11) 94751-8805) | Motivo: reclamacao | Assunto: peça com prazo estourado | 11:48',
    )
  })

  it('formata mensagem quando o cliente não tem nome cadastrado (usa apenas telefone formatado)', () => {
    const notifier = loadNotifierInContext()
    const msg = notifier.buildNotificationMessage({
      customerName: '',
      phone: '11988887777',
      reason: 'comando_atendente',
      subject: '/atendente',
      timeStr: '14:20',
    })

    expect(msg).toBe(
      '🔔 ESCALADA — Cliente (11) 98888-7777 | Motivo: comando_atendente | Assunto: /atendente | 14:20',
    )
  })

  it('deduplica escaladas no mesmo ciclo de 5 minutos para o mesmo telefone+motivo', () => {
    const notifier = loadNotifierInContext()
    const p = '5511999990000'
    const r = 'reclamacao'

    // 1ª vez: permitido
    const firstCall = notifier.checkDedupe(p, r)
    expect(firstCall).toBe(true)

    // 2ª vez imediata: bloqueado pelo dedupe
    const secondCall = notifier.checkDedupe(p, r)
    expect(secondCall).toBe(false)

    // Outro motivo no mesmo telefone: permitido
    const diffReason = notifier.checkDedupe(p, 'nota')
    expect(diffReason).toBe(true)

    // Outro telefone com o mesmo motivo: permitido
    const diffPhone = notifier.checkDedupe('5511888881111', r)
    expect(diffPhone).toBe(true)
  })

  it('notifyEscalation executa chamada HTTP para a Z-API no número 5511947518805', () => {
    let capturedRequest: any = null
    const customHttp = (req: any) => {
      capturedRequest = req
      return { statusCode: 200, body: '{"sent":true}' }
    }

    const mockApp = {
      findRecordsByFilter: (col: string) => {
        if (col === 'settings') {
          return [
            {
              getString: (k: string) => {
                if (k === 'zapi_instance_id') return 'INST123'
                if (k === 'zapi_token') return 'TOK456'
                if (k === 'zapi_client_token') return 'CLITOK789'
                return ''
              },
            },
          ]
        }
        if (col === 'customers') {
          return [
            {
              getString: (k: string) => (k === 'name' ? 'João da Silva' : ''),
            },
          ]
        }
        return []
      },
    }

    const notifier = loadNotifierInContext(customHttp, mockApp)
    const result = notifier.notifyEscalation({
      $app: mockApp,
      phone: '5511977776666',
      reason: 'nota',
      incomingText: 'Minha NF-e veio com valor errado',
    })

    expect(result.sent).toBe(true)
    expect(capturedRequest).toBeDefined()
    expect(capturedRequest.url).toContain('/instances/INST123/token/TOK456/send-text')
    expect(capturedRequest.headers['Client-Token']).toBe('CLITOK789')

    const bodyParsed = JSON.parse(capturedRequest.body)
    expect(bodyParsed.phone).toBe('5511947518805')
    expect(bodyParsed.message).toContain('🔔 ESCALADA — Cliente João da Silva')
    expect(bodyParsed.message).toContain('Motivo: nota')
    expect(bodyParsed.message).toContain('Minha NF-e veio com valor errado')
  })

  it('notifyEscalation tolera falha de rede/HTTP sem lançar exceção', () => {
    const errorHttp = () => {
      throw new Error('Connection timeout to api.z-api.io')
    }

    const mockApp = {
      findRecordsByFilter: () => [
        {
          getString: () => 'ANY_VAL',
        },
      ],
    }

    const notifier = loadNotifierInContext(errorHttp, mockApp)
    const result = notifier.notifyEscalation({
      $app: mockApp,
      phone: '5511955554444',
      reason: 'cobranca',
      incomingText: 'boleto vencido',
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('Connection timeout to api.z-api.io')
  })
})
