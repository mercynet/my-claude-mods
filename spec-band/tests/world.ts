import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

export type Engine = Parameters<TestBody>[0]

export const PLUGIN = 'spec-band'
export const ROOT = '/srv/example/example-app'
export const BRANCH = '42-example-feature'
export const SPECS = `${ROOT}/specs/_active`
export const SPEC_DIR = `${SPECS}/${BRANCH}`
export const TASKS = `${SPEC_DIR}/tasks.md`
export const STATE = `${SPEC_DIR}/STATE.md`
export const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
export const MINUTE = 60_000

export const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 8,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 8 },
  view: {},
} as const

export type World = {
  git: { exitCode: number; stdout: string } | 'unavailable'
  dirs: Set<string>
  files: Map<string, { text: string; mtimeMs: number }>
  broken: Set<string>
  toolFails: boolean
  invalidations: number
}

export const TASKS_TEXT = ['# Tasks', '', '- [x] first', '- [x] second', '- [ ] third', '* [X] fourth', '- [ ] fifth'].join('\n')

export const STATE_TEXT = ['# STATE', '', 'Active spec: `001-example.md` - Phase B; one step left.', '', '## Decisions', '- note'].join('\n')

export const newWorld = (overrides: Partial<World> = {}): World => ({
  git: { exitCode: 0, stdout: `${BRANCH}\n` },
  dirs: new Set([SPECS, SPEC_DIR]),
  files: new Map([
    [TASKS, { text: TASKS_TEXT, mtimeMs: NOW - 90 * MINUTE }],
    [STATE, { text: STATE_TEXT, mtimeMs: NOW - 3 * MINUTE }],
  ]),
  broken: new Set(),
  toolFails: false,
  invalidations: 0,
  ...overrides,
})

export function stand(on: On, world: World): void {
  mock.clock(on, { now: NOW })

  on('session.root', () => ({ value: ROOT }))
  on('process.run', (_$, e) => {
    if (world.git === 'unavailable') return { deny: `git not found for ${e.argv.join(' ')}` }

    return {
      value: {
        exitCode: world.git.exitCode,
        stdout: world.git.stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('fs.stat', (_$, e) => {
    if (world.broken.has(e.path)) return { deny: `EIO: ${e.path}` }
    if (world.dirs.has(e.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    const file = world.files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }

    return { value: { kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    if (world.broken.has(e.path)) return { deny: `EIO: ${e.path}` }
    const file = world.files.get(e.path)

    return file === undefined ? { deny: `ENOENT: ${e.path}` } : { value: file.text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('tool.call', () => ({
    result: {},
    text: '',
    isReadOnly: false,
    ref: 0,
    ...(world.toolFails ? { isError: true } : {}),
  }) as never)
}

export const startSession = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

export const finishTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

export const submit = ($: Engine, text = 'go') =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

export const edit = ($: Engine, path: string, tool: 'Edit' | 'Write' = 'Edit') =>
  tool === 'Edit'
    ? $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
    : $.tool.call({ tool: 'Write', file_path: path, content: 'x' })

export const touch = (world: World, path: string, mtimeMs: number): void => {
  const file = world.files.get(path)
  if (file !== undefined) world.files.set(path, { ...file, mtimeMs })
}

export const mountBand = ($: Engine, props: Record<string, unknown> = {}, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, ...props } })

type Drawn = string | { type: string; props?: Record<string, unknown>; children?: Drawn[] }

const flatten = (node: Drawn): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(flatten).join('')

export const screen = async (ui: { drawn: () => Promise<unknown> }): Promise<string> =>
  flatten((await ui.drawn()) as Drawn)

export const isEngineDrawn = async (ui: { drawn: () => Promise<unknown> }): Promise<boolean> =>
  (await ui.drawn() as { type?: string }).type === 'engine'
