import type {
  EngineInterface,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  Timer,
  ToolCallInput,
} from 'claude-code'

import type { DirtySet, RunFailure } from '../types'

import {
  EDIT_TOOLS,
  GRAPH_DIR,
  MIN_DEFER_MS,
  OUTPUT_LIMIT,
  STATUS_OK_MS,
  STORE_DIAG,
  TOAST_FAILURE_MS,
  VERSION,
  VERSION_CHECK_MS,
} from './graph/config'
import { addEdit, isOpen } from './graph/dirty'
import { STATUS_FAILED, STATUS_RUNNING, USAGE, failureText, panelText, statusOk } from './graph/format'
import { parseOptions } from './graph/options'
import type { GraphSyncOptions } from './graph/options'
import { isWatched, relativeTo, toPosix } from './graph/paths'
import { isLockLive, lastKey, lockKey, parseLast, parseLock } from './graph/records'
import type { LastRun, RunOutcome } from './graph/records'

const dirtyRef = { plugin: 'graph-sync', key: 'dirty' } as const
const failureRef = { plugin: 'graph-sync', key: 'failure' } as const
const missingRef = { plugin: 'graph-sync', key: 'missing' } as const

type Attempt =
  | { kind: 'started' }
  | { kind: 'inert'; why: string }
  | { kind: 'missing' }
  | { kind: 'busy' }
  | { kind: 'clean' }
  | { kind: 'blocked' }
  | { kind: 'waiting'; remainingMs: number }

type ActiveRun = {
  id: number
  startedAt: number
  cancel: () => void
}

type Finished = {
  outcome: RunOutcome
  exitCode: number | null
  detail: string
}

type Output = { stderr: string; stdout: string }

type Runtime = {
  cfg: GraphSyncOptions
  root: string | null | undefined
  active: ActiveRun | null
  isTurnActive: boolean
  isExecutableVerified: boolean
  runCounter: number
  deferred: Timer | undefined
  statusTimer: Timer | undefined
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const capped = (text: string): string => (text.length > OUTPUT_LIMIT ? text.slice(0, OUTPUT_LIMIT) : text)

async function drain(
  stream: AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult>,
  onChunk: (chunk: ProcessSpawnChunk) => void,
): Promise<ProcessSpawnResult> {
  for (;;) {
    const step = await stream.next()
    if (step.done) return step.value
    onChunk(step.value)
  }
}

async function report($: EngineInterface, error: unknown): Promise<void> {
  try {
    await $.store.set(STORE_DIAG, { at: await $.clock.now(), text: messageOf(error).slice(0, 300) })
  } catch {
    return
  }
}

async function resolveRoot($: EngineInterface, rt: Runtime): Promise<string | null> {
  if (rt.root !== undefined) return rt.root
  try {
    const base = await $.session.root()
    const result = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: base })
    const top = result.exitCode === 0 ? toPosix(result.stdout.trim()) : ''
    rt.root = top === '' ? null : top
  } catch {
    rt.root = null
  }
  return rt.root
}

const hasGraph = ($: EngineInterface, top: string): Promise<boolean> => $.fs.exists(`${top}/${GRAPH_DIR}`)

async function readDirty($: EngineInterface): Promise<DirtySet | null> {
  const held = (await $.state.get(dirtyRef)).value
  return isOpen(held) ? held : null
}

async function releaseLock($: EngineInterface, top: string): Promise<void> {
  const lock = parseLock(await $.store.get(lockKey(top)))
  if (lock !== undefined && lock.sessionId === (await $.session.id())) await $.store.delete(lockKey(top))
}

async function verifyExecutable($: EngineInterface, rt: Runtime, top: string, isForced: boolean): Promise<boolean> {
  if (rt.isExecutableVerified) return true
  const name = rt.cfg.argv[0] ?? ''
  try {
    await $.process.run([name, '--version'], { cwd: top, timeoutMs: VERSION_CHECK_MS })
    rt.isExecutableVerified = true
    await $.state.set(missingRef, false)
    return true
  } catch {
    const wasMissing = (await $.state.get(missingRef)).value === true
    await $.state.set(missingRef, true)
    if (!wasMissing && !isForced) $.ui.toast(`${name} não encontrado no PATH; graph-sync desligado nesta sessão`)
    return false
  }
}

function scheduleDeferred($: EngineInterface, rt: Runtime, ms: number): void {
  rt.deferred?.cancel()
  rt.deferred = $.clock.after(Math.max(ms, MIN_DEFER_MS), () => {
    rt.deferred = undefined
    if (rt.isTurnActive) return
    void attempt($, rt, false).catch(error => report($, error))
  })
}

async function conclude(
  $: EngineInterface,
  rt: Runtime,
  top: string,
  run: ActiveRun,
  startEdits: number,
  finished: Finished,
  output: Output,
): Promise<void> {
  if (rt.active?.id !== run.id) return
  rt.active = null

  const now = await $.clock.now()
  const durationMs = Math.max(0, now - run.startedAt)
  const record: LastRun = {
    startedAt: run.startedAt,
    durationMs,
    exitCode: finished.exitCode,
    outcome: finished.outcome,
    edits: startEdits,
  }
  await $.store.set(lastKey(top), record)
  await releaseLock($, top)

  const held = await readDirty($)
  if (finished.outcome === 'ok') {
    if (held !== null && held.edits === startEdits) await $.state.set(dirtyRef, null)
    await $.state.set(failureRef, null)
    $.ui.status(statusOk(durationMs))
    rt.statusTimer = $.clock.after(STATUS_OK_MS, () => {
      if (rt.active === null) $.ui.status(undefined)
    })
    return
  }

  const failure: RunFailure = { edits: held?.edits ?? 0, at: now }
  await $.state.set(failureRef, failure)
  $.ui.status(STATUS_FAILED)
  $.ui.toast(
    failureText({
      outcome: finished.outcome,
      exitCode: finished.exitCode,
      detail: finished.detail,
      durationMs,
      stderr: output.stderr,
      stdout: output.stdout,
    }),
    { timeoutMs: TOAST_FAILURE_MS },
  )
}

async function abandon($: EngineInterface, rt: Runtime, top: string, run: ActiveRun): Promise<void> {
  if (rt.active?.id !== run.id) return
  rt.active = null
  await releaseLock($, top)
  $.ui.status(undefined)
}

function launch($: EngineInterface, rt: Runtime, top: string, startedAt: number, startEdits: number): void {
  rt.runCounter += 1
  rt.statusTimer?.cancel()

  let stream: AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> | undefined
  let deadline: Timer | undefined
  const kill = (): void => {
    void stream?.return({ code: null, signal: 'SIGTERM' }).catch(() => undefined)
  }
  const run: ActiveRun = {
    id: rt.runCounter,
    startedAt,
    cancel: () => {
      deadline?.cancel()
      kill()
    },
  }
  rt.active = run
  $.ui.status(STATUS_RUNNING)

  void (async () => {
    if (!(await verifyExecutable($, rt, top, false))) {
      await abandon($, rt, top, run)
      return
    }
    if (rt.active?.id !== run.id) return

    const output: Output = { stderr: '', stdout: '' }
    const running = $.process.spawn({ argv: rt.cfg.argv, cwd: top })
    stream = running
    const timeout = new Promise<'timeout'>(resolve => {
      deadline = $.clock.after(rt.cfg.timeoutMs, () => resolve('timeout'))
    })

    let finished: Finished
    try {
      const winner = await Promise.race([
        drain(running, chunk => {
          output[chunk.stream] = capped(output[chunk.stream] + chunk.text)
        }),
        timeout,
      ])
      if (winner === 'timeout') {
        kill()
        finished = { outcome: 'timeout', exitCode: null, detail: '' }
      } else {
        finished = { outcome: winner.code === 0 ? 'ok' : 'failed', exitCode: winner.code, detail: winner.signal ?? '' }
      }
    } catch (error) {
      finished = { outcome: 'error', exitCode: null, detail: messageOf(error) }
    }
    deadline?.cancel()
    await conclude($, rt, top, run, startEdits, finished, output)
  })().catch(async error => {
    await report($, error)
    await abandon($, rt, top, run).catch(() => undefined)
  })
}

async function begin($: EngineInterface, rt: Runtime, top: string, isForced: boolean): Promise<Attempt> {
  if (rt.active !== null) return { kind: 'busy' }

  const now = await $.clock.now()
  const sessionId = await $.session.id()
  const lock = parseLock(await $.store.get(lockKey(top)))
  if (lock !== undefined && isLockLive(lock, now, sessionId, false, rt.cfg.timeoutMs)) return { kind: 'busy' }

  if (isForced && !(await verifyExecutable($, rt, top, true))) return { kind: 'missing' }

  const startEdits = (await readDirty($))?.edits ?? 0
  await $.store.set(lockKey(top), { sessionId, startedAt: now })
  launch($, rt, top, now, startEdits)
  return { kind: 'started' }
}

async function attempt($: EngineInterface, rt: Runtime, isForced: boolean): Promise<Attempt> {
  const top = await resolveRoot($, rt)
  if (top === null) return { kind: 'inert', why: 'fora de um repositório git' }
  if (!(await hasGraph($, top))) return { kind: 'inert', why: `sem ${GRAPH_DIR} em ${top}` }

  if (!isForced) {
    if ((await $.state.get(missingRef)).value === true) return { kind: 'missing' }

    const dirty = await readDirty($)
    if (dirty === null) return { kind: 'clean' }

    const failure = (await $.state.get(failureRef)).value
    if (failure !== null && failure !== undefined && dirty.edits <= failure.edits) return { kind: 'blocked' }

    const last = parseLast(await $.store.get(lastKey(top)))
    const now = await $.clock.now()
    const since = last === undefined ? Infinity : now - last.startedAt
    if (last !== undefined && rt.cfg.minIntervalMs > 0 && since >= 0 && since < rt.cfg.minIntervalMs) {
      const remainingMs = rt.cfg.minIntervalMs - since
      scheduleDeferred($, rt, remainingMs)
      return { kind: 'waiting', remainingMs }
    }
  }
  return begin($, rt, top, isForced)
}

async function observe($: EngineInterface, rt: Runtime, e: ToolCallInput): Promise<void> {
  rt.isTurnActive = true
  if (!EDIT_TOOLS.has(String(e.tool))) return
  const file = (e as { file_path?: unknown }).file_path
  if (typeof file !== 'string') return

  const top = await resolveRoot($, rt)
  if (top === null) return
  const relative = relativeTo(top, file)
  if (relative === undefined || !isWatched(relative, rt.cfg.extensions)) return
  if (!(await hasGraph($, top))) return

  await $.state.set(dirtyRef, addEdit(await readDirty($), relative))
}

async function afterTurn($: EngineInterface, rt: Runtime, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined) return
  rt.isTurnActive = false
  await attempt($, rt, false)
}

async function runNow($: EngineInterface, rt: Runtime): Promise<string> {
  const result = await attempt($, rt, true)
  switch (result.kind) {
    case 'started':
      return `graph-sync: atualização iniciada em segundo plano (${rt.cfg.command}). O estado fica em /graph.`
    case 'busy':
      return 'graph-sync: já há uma atualização em curso neste repositório.'
    case 'missing':
      return `graph-sync: ${rt.cfg.argv[0] ?? 'o comando'} não foi encontrado no PATH.`
    case 'inert':
      return `graph-sync inativo: ${result.why}.`
    default:
      return 'graph-sync: nada a fazer.'
  }
}

async function panel($: EngineInterface, rt: Runtime): Promise<string> {
  const top = await resolveRoot($, rt)
  const base = {
    version: VERSION,
    command: rt.cfg.command,
    now: await $.clock.now(),
    minIntervalMs: rt.cfg.minIntervalMs,
    timeoutMs: rt.cfg.timeoutMs,
    extensions: [...rt.cfg.extensions],
  }
  const inert = (inertWhy: string): string =>
    panelText({ ...base, root: top, inertWhy, dirty: null, hasFailure: false, isMissing: false })

  if (top === null) return inert('fora de um repositório git')
  if (!(await hasGraph($, top))) return inert(`sem ${GRAPH_DIR} em ${top}`)

  const failure = (await $.state.get(failureRef)).value
  return panelText({
    ...base,
    root: top,
    runningSince: rt.active?.startedAt,
    dirty: await readDirty($),
    last: parseLast(await $.store.get(lastKey(top))),
    hasFailure: failure !== null && failure !== undefined,
    isMissing: (await $.state.get(missingRef)).value === true,
  })
}

async function shutdown($: EngineInterface, rt: Runtime): Promise<void> {
  rt.deferred?.cancel()
  rt.deferred = undefined
  rt.statusTimer?.cancel()
  const run = rt.active
  if (run === null) return
  rt.active = null
  run.cancel()
  if (rt.root !== null && rt.root !== undefined) await releaseLock($, rt.root)
  $.ui.status(undefined)
}

export const register: Register = (on, options) => {
  const rt: Runtime = {
    cfg: parseOptions(options),
    root: undefined,
    active: null,
    isTurnActive: false,
    isExecutableVerified: false,
    runCounter: 0,
    deferred: undefined,
    statusTimer: undefined,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'graph',
      description: 'graph-sync: estado da atualização do grafo de código; now força uma atualização',
      argumentHint: '[status|now]',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await observe($, rt, e).catch(error => report($, error))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await afterTurn($, rt, e.agentId).catch(error => report($, error))
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') await shutdown($, rt).catch(error => report($, error))
    return next(e)
  })

  on('command.run', { command: 'graph' }, async ($, e) => {
    const subcommand = e.args.trim().toLowerCase()
    if (subcommand === '' || subcommand === 'status') return { text: await panel($, rt) }
    if (subcommand === 'now') return { text: await runNow($, rt) }
    return { text: USAGE }
  })
}
