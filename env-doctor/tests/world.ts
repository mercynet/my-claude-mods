import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { COMPOSE_FILES } from '../hooks/doctor/compose'
import type { Scheduler } from '../hooks/doctor/run'
import type { Config, Context, Exec, Ports } from '../hooks/doctor/types'

export const ROOT = '/srv/example/example-app'

export const ok = (stdout = ''): Exec => ({ exitCode: 0, stdout, stderr: '' })
export const failed = (stderr: string, exitCode = 1): Exec => ({ exitCode, stdout: '', stderr })

export type Fake = {
  files: Map<string, string>
  dirs: Set<string>
  sizes: Map<string, number>
  responses: Map<string, Exec | Error>
  runs: string[][]
  reads: string[]
}

export const newFake = (): Fake => ({
  files: new Map(),
  dirs: new Set(),
  sizes: new Map(),
  responses: new Map(),
  runs: [],
  reads: [],
})

const at = (relative: string): string => `${ROOT}/${relative}`

export const addFile = (fake: Fake, relative: string, text = 'x'): void => {
  fake.files.set(at(relative), text)
}

export const addDir = (fake: Fake, relative: string): void => {
  fake.dirs.add(at(relative))
}

export const addCompose = (fake: Fake, services: readonly string[], running: readonly string[]): void => {
  addFile(fake, 'docker-compose.yml')
  fake.responses.set('docker compose config', ok(services.join('\n') + '\n'))
  fake.responses.set('docker compose ps', ok(running.join('\n') + '\n'))
}

export function portsOf(fake: Fake): Ports {
  return {
    run: async argv => {
      fake.runs.push([...argv])
      const response = fake.responses.get(argv.slice(0, 3).join(' '))
      if (response === undefined) throw new Error(`no response for ${argv.join(' ')}`)
      if (response instanceof Error) throw response
      return response
    },
    exists: async path => fake.files.has(path) || fake.dirs.has(path),
    stat: async path => {
      const text = fake.files.get(path)
      if (text !== undefined) return { kind: 'file', size: fake.sizes.get(path) ?? text.length }
      if (fake.dirs.has(path)) return { kind: 'dir', size: 0 }
      throw new Error(`ENOENT: ${path}`)
    },
    read: async path => {
      fake.reads.push(path)
      const text = fake.files.get(path)
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
  }
}

export const noConfig: Config = { emptyFiles: [], requiredPaths: [], ignoreServices: [] }

export const contextOf = (fake: Fake, config: Partial<Config> = {}): Context => ({
  root: ROOT,
  ports: portsOf(fake),
  config: { ...noConfig, ...config },
})

export const HEALTHY_TEXT = '<?php return ' + 'x'.repeat(200) + ';'

export type World = {
  fake: Fake
  statusLog: (string | undefined)[]
  toasts: string[]
  debugLog: string[]
  registered: string[]
  rootFails: boolean
  hangDocker: boolean
}

export const newWorld = (): World => ({
  fake: newFake(),
  statusLog: [],
  toasts: [],
  debugLog: [],
  registered: [],
  rootFails: false,
  hangDocker: false,
})

export function stand(on: On, world: World) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const { fake } = world

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => (world.rootFails ? { deny: 'no session root' } : { value: ROOT }))
  on('process.run', async (_$, e) => {
    fake.runs.push([...e.argv])
    if (e.argv[0] === 'git') return { value: { ...ok(`${ROOT}\n`), isStdoutTruncated: false, isStderrTruncated: false } }
    if (world.hangDocker) return new Promise<never>(() => undefined)
    const response = fake.responses.get(e.argv.slice(0, 3).join(' '))
    if (response === undefined) return { deny: `spawn ${e.argv[0]} ENOENT` }
    if (response instanceof Error) return { deny: response.message }
    return { value: { ...response, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_$, e) => ({ value: fake.files.has(e.path) || fake.dirs.has(e.path) }))
  on('fs.stat', (_$, e) => {
    const text = fake.files.get(e.path)
    if (text !== undefined) return { value: { kind: 'file' as const, size: text.length, mtimeMs: 0, isLink: false } }
    if (fake.dirs.has(e.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.read', (_$, e) => {
    const text = fake.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.status', (_$, e) => {
    world.statusLog.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLog.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => {
    world.registered.push(e.name)
    return { value: { command: e.name } }
  })
  return clock
}

export const schedulerOf = (clock: MockClock): Scheduler => ({
  after: (ms, fn) => {
    let isCancelled = false
    void clock.sleep(ms).then(() => {
      if (!isCancelled) fn()
    })
    return { cancel: () => { isCancelled = true } }
  },
})

export const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

export const env = ($: Engine, args = '') =>
  $.command.run({
    command: 'env',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

export const healthyWorld = (): World => {
  const world = newWorld()
  addCompose(world.fake, ['web', 'db', 'cache'], ['web', 'db', 'cache'])
  return world
}

export { COMPOSE_FILES }
