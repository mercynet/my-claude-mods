import type { EngineInterface, Register } from 'claude-code'

import { readConfig } from './doctor/options'
import { renderTable, statusText, toastText } from './doctor/report'
import { messageOf } from './doctor/result'
import { runChecks } from './doctor/run'
import type { CheckResult, Config, Ports } from './doctor/types'

const PREFLIGHT_DELAY_MS = 0

const portsOf = ($: EngineInterface): Ports => ({
  run: async (argv, init) => {
    const { exitCode, stdout, stderr } = await $.process.run(argv, init)
    return { exitCode, stdout, stderr }
  },
  exists: path => $.fs.exists(path),
  stat: async path => {
    const { kind, size } = await $.fs.stat(path)
    return { kind, size }
  },
  read: path => $.fs.read(path),
})

async function repoRoot($: EngineInterface, ports: Ports): Promise<string> {
  const session = await $.session.root()
  const probe = await ports.run(['git', 'rev-parse', '--show-toplevel'], { cwd: session, timeoutMs: 3000 }).catch(() => undefined)
  const top = probe?.exitCode === 0 ? probe.stdout.trim() : ''
  return top === '' ? session : top
}

async function inspect($: EngineInterface, config: Config): Promise<CheckResult[]> {
  const ports = portsOf($)
  const root = await repoRoot($, ports)
  return runChecks({ root, ports, config }, { after: (ms, fn) => $.clock.after(ms, fn) })
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'env',
      description: 'env-doctor: verifica o ambiente de desenvolvimento (só leitura) e mostra a correção de cada problema',
    })
    const started = await next(e)

    $.clock.after(PREFLIGHT_DELAY_MS, () => {
      void inspect($, config)
        .then(results => {
          $.ui.status(statusText(results))
          const toast = toastText(results)
          if (toast !== undefined) $.ui.toast(toast, { timeoutMs: 8000 })
        })
        .catch(error => $.ui.log(`env-doctor: preflight skipped (${messageOf(error)})`, { to: 'debug' }))
    })
    return started
  })

  on('command.run', { command: 'env' }, async $ => {
    try {
      const results = await inspect($, config)
      $.ui.status(statusText(results))
      return { text: renderTable(results) }
    } catch (error) {
      return { text: `env-doctor: verificação falhou (${messageOf(error)})` }
    }
  })
}
