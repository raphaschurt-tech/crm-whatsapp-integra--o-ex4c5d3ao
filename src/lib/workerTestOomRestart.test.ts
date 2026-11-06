/**
 * Teste hermético que executa o script worker-dfe/test-oom-restart.js
 * e garante que todas as provas passam com 0 falhas e veredito final OK.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

describe('Worker DF-e - test-oom-restart.js', () => {
  it('executa node test-oom-restart.js com sucesso (0 falhas)', () => {
    const scriptPath = path.resolve(__dirname, '../../worker-dfe/test-oom-restart.js')
    const res = spawnSync(process.execPath, [scriptPath], {
      cwd: path.dirname(scriptPath),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    })

    const stdout = res.stdout || ''
    const stderr = res.stderr || ''
    const combinedOutput = `${stdout}\n${stderr}`

    console.log('[VITEST WORKER TEST-OOM-RESTART OUTPUT]\n', stdout)
    if (stderr) {
      console.warn('[VITEST WORKER TEST-OOM-RESTART STDERR]\n', stderr)
    }

    expect(combinedOutput).toContain('TODAS AS PROVAS PASSARAM ✔')
    expect(combinedOutput).not.toContain('VERIFICAÇÃO(ÕES) FALHARAM')
    expect(combinedOutput).not.toContain('VEREDITO: PROVAS INTERROMPIDAS')
    expect(res.status).toBe(0)
  })
})
