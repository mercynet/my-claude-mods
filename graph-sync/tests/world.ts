import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export const ROOT = '/srv/example/example-app'
export const SESSION = 'session-1'
export const OTHER_SESSION = 'session-2'
export const NOW = 1_700_000_000_000
export const MINUTE = 60_000

export type SpawnPlan = {
  chunks?: readonly { stream: 'stdout' | 'stderr'; text: string }[]
  code?: number | null
  signal?: string | null
  durationMs?: number
  startError?: string
}

export type World = {
  root: string
  git: { exitCode: number; stdout: string } | 'unavailable'
  hasGraph: boolean
  hasExecutable: boolean
  plan: SpawnPlan
  spawns: { argv: readonly string[]; cwd: string | undefined }[]
  versionChecks: number
  versionDelayMs: number
  statusLog: (string | undefined)[]
  toasts: string[]
}

export const newWorld = (overrides: Partial<World> = {}): World => ({
  root: ROOT,
  git: { exitCode: 0, stdout: `${ROOT}\n` },
  hasGraph: true,
  hasExecutable: true,
  plan: {},
  spawns: [],
  versionChecks: 0,
  versionDelayMs: 0,
  statusLog: [],
  toasts: [],
  ...overrides,
})

export const lastStatus = (world: World): string | undefined => world.statusLog[world.statusLog.length - 1]

export function stand(on: On, world: World, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })

  on('store.get', (_$, e) => ({ value: store[e.key] === undefined ? undefined : structuredClone(store[e.key]) }))
  on('store.set', (_$, e) => {
    store[e.key] = structuredClone(e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: world.root }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.exists', (_$, e) => ({ value: world.hasGraph && e.path.endsWith('/graphify-out') }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      if (world.git === 'unavailable') return { deny: 'git not found' }
      return {
        value: {
          exitCode: world.git.exitCode,
          stdout: world.git.stdout,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    world.versionChecks += 1
    if (world.versionDelayMs > 0) await clock.sleep(world.versionDelayMs)
    if (!world.hasExecutable) return { deny: `spawn ${e.argv[0]} ENOENT` }
    return { value: { exitCode: 0, stdout: '1.0.0', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* (_$, e) {
    world.spawns.push({ argv: e.argv, cwd: e.cwd })
    if (world.plan.startError !== undefined) throw new Error(world.plan.startError)
    for (const chunk of world.plan.chunks ?? []) yield chunk
    if ((world.plan.durationMs ?? 0) > 0) await clock.sleep(world.plan.durationMs ?? 0)
    return { value: { code: world.plan.code === undefined ? 0 : world.plan.code, signal: world.plan.signal ?? null } }
  })
  on('ui.status', (_$, e) => {
    world.statusLog.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: '', isReadOnly: false, ref: 0 }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  return clock
}

export const edit = ($: Engine, file: string) => $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })

export const write = ($: Engine, file: string) => $.tool.call({ tool: 'Write', file_path: file, content: 'x' })

export const multiEdit = ($: Engine, file: string) => $.tool.call({ tool: 'MultiEdit', file_path: file, edits: [] } as never)

export const read = ($: Engine, file: string) => $.tool.call({ tool: 'Read', file_path: file })

export const endTurn = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })

export const graph = ($: Engine, args = '') =>
  $.command.run({
    command: 'graph',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

export const panelOf = async ($: Engine): Promise<string> => (await graph($)).text ?? ''

export const endSession = ($: Engine, reason: 'clear' | 'other') =>
  $.session.end({ reason, sessionId: SESSION, resume: { id: SESSION } })

export const file = (relative: string): string => `${ROOT}/${relative}`
