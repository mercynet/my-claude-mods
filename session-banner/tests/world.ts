import type { On, RenderElement } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock, TestBody } from 'claude-code/testing'

export type Engine = Parameters<TestBody>[0]

export const PLUGIN = 'session-banner'
export const ROOT = '/srv/example/example-app'
export const HOME = '/srv/example'
export const ART_PATH = `${HOME}/.claude/banner.txt`
export const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)

export const ART = ['  ▄▀▀▄  █▀▀', ' █    █ █▀▀', '  ▀▄▄▀  ▀  '].join('\n')

export const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

export type World = {
  files: Map<string, string>
  broken: Set<string>
  env: Record<string, string>
  below: RenderElement | undefined
  cwd: string | Error
  rootCalls: number
  processCalls: number
  toasts: string[]
  logs: string[]
  registered: string[]
  reads: string[]
  frameWrites: number
}

export const newWorld = (overrides: Partial<World> = {}): World => ({
  files: new Map([[ART_PATH, ART]]),
  broken: new Set(),
  env: { HOME },
  below: undefined,
  cwd: ROOT,
  rootCalls: 0,
  processCalls: 0,
  toasts: [],
  logs: [],
  registered: [],
  reads: [],
  frameWrites: 0,
  ...overrides,
})

export function stand(on: On, world: World): MockClock {
  on('state.set', (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'frame') world.frameWrites += 1

    return next(e)
  })

  const clock = mock.clock(on, { now: NOW })
  mock.env(on, world.env)

  on('session.root', () => {
    world.rootCalls += 1

    return { value: ROOT }
  })
  on('session.cwd', () => (world.cwd instanceof Error ? { deny: world.cwd.message } : { value: world.cwd }))
  on('process.run', () => {
    world.processCalls += 1

    return { deny: 'no process may run' }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    if (e.to !== 'debug') world.logs.push(e.text)

    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    world.reads.push(e.path)
    if (world.broken.has(e.path)) return { deny: `EIO: ${e.path}` }
    const text = world.files.get(e.path)

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('command.register', (_$, e) => {
    world.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => world.below ?? { type: 'engine', ref: 0 })

  return clock
}

export const startSession = ($: Engine, isInteractive = true, cwd = ROOT) =>
  $.session.start({ cwd, surface: 'terminal', isInteractive })

export const startHeadless = ($: Engine, cwd = ROOT) => $.session.start({ cwd, surface: null, isInteractive: false })

export const submit = ($: Engine, text = 'go') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

export const finishTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

export const banner = ($: Engine) =>
  $.command.run({ command: 'banner', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

export const mountBand = ($: Engine, props: Record<string, unknown> = {}, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, ...props } })

export type Drawn = string | { type: string; props?: Record<string, unknown>; children?: Drawn[] }

export const asDrawn = (tree: unknown): Drawn => tree as Drawn

export function collect(node: Drawn, type: string, found: Exclude<Drawn, string>[] = []): Exclude<Drawn, string>[] {
  if (typeof node === 'string') return found
  if (node.type === type) found.push(node)
  node.children?.forEach(child => collect(child, type, found))

  return found
}

export const flatten = (node: Drawn): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(flatten).join('')

export const isEngineDrawn = async (ui: { drawn: () => Promise<unknown> }): Promise<boolean> =>
  (await ui.drawn() as { type?: string }).type === 'engine'

const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    buffer = (buffer << 6) | TABLE.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }

  return Uint8Array.from(bytes)
}

export type Cell = { glyph: string; fg: number; bg: number }

export function decodeCells(cells: string): Cell[] {
  const bytes = decodeBase64(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Cell[] = []
  for (let offset = 0; offset < bytes.length; offset += 12) {
    out.push({
      glyph: String.fromCodePoint(view.getUint32(offset, true)),
      fg: view.getUint32(offset + 4, true),
      bg: view.getUint32(offset + 8, true),
    })
  }

  return out
}

export type DrawnRaster = { columns: number; rows: number; cells: Cell[] }

export const rasterOf = (tree: unknown): DrawnRaster | undefined => {
  const node = collect(asDrawn(tree), 'Raster')[0]
  if (node === undefined) return undefined
  const props = node.props as { columns: number; rows: number; cells: string }

  return { columns: props.columns, rows: props.rows, cells: decodeCells(props.cells) }
}

export const cellAt = (raster: DrawnRaster, x: number, y: number): Cell => {
  const cell = raster.cells[y * raster.columns + x]
  if (cell === undefined) throw new Error(`no cell at ${x},${y}`)

  return cell
}
