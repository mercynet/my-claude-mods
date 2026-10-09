import { describe, expect, test } from 'claude-code/testing'

import {
  MINUTE,
  NOW,
  OTHER_SESSION,
  ROOT,
  SESSION,
  edit,
  endSession,
  endTurn,
  file,
  graph,
  lastStatus,
  newWorld,
  panelOf,
  stand,
} from './world'

const lockKey = `lock:${ROOT}`
const lastKey = `last:${ROOT}`

describe('starting a run', () => {
  test('a finished turn with edits starts the command in the background and does not wait for it', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 38_000 } })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toEqual([{ argv: ['graphify', 'update', '.'], cwd: ROOT }])
    expect(lastStatus(world)).toBe('grafo: atualizando...')
    expect(store[lastKey]).toBeUndefined()
    expect(store[lockKey]).toEqual({ sessionId: SESSION, startedAt: NOW })
    expect(await panelOf($)).toContain('execução: em curso')

    await clock.advance(38_000)

    expect(lastStatus(world)).toBe('grafo ok (38s)')
    expect(store[lastKey]).toEqual({ startedAt: NOW, durationMs: 38_000, exitCode: 0, outcome: 'ok', edits: 1 })
    expect(store[lockKey]).toBeUndefined()
    const panel = await panelOf($)
    expect(panel).toContain('edições pendentes: nenhuma')
    expect(panel).toContain('execução: parada')

    await clock.advance(10_000)
    expect(lastStatus(world)).toBeUndefined()
    expect(world.toasts).toEqual([])
  })

  test('a turn without edits starts nothing', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    await endTurn($)

    expect(world.spawns).toHaveLength(0)
    expect(world.versionChecks).toBe(0)
  })

  test('the end of a subagent turn neither starts a run nor ends the main turn', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($, 'agent-1')
    await clock.settle()
    expect(world.spawns).toHaveLength(0)

    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(1)
  })

  test('an edit made while the command runs keeps the set dirty after it finishes', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 5_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    await edit($, file('src/b.ts'))
    await clock.advance(5_000)

    expect(lastStatus(world)).toBe('grafo ok (5s)')
    expect(await panelOf($)).toContain('edições pendentes: 2 (src/a.ts, src/b.ts)')
  })

  test('a configured command is run as given, without a shell', { options: { command: 'mytool refresh src' } }, async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns[0]?.argv).toEqual(['mytool', 'refresh', 'src'])
  })
})

describe('turn end budget', () => {
  test('the executable check runs in the background and never holds the turn end', async ($, on) => {
    const world = newWorld({ versionDelayMs: 5_000 })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)

    expect(world.versionChecks).toBe(1)
    expect(world.spawns).toHaveLength(0)
    expect(lastStatus(world)).toBe('grafo: atualizando...')

    await clock.advance(5_000)
    expect(world.spawns).toHaveLength(1)
  })
})

describe('interval gating', () => {
  test('inside the interval nothing starts, and a deferred check starts the run when it ends', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 1_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(1_000)
    expect(world.spawns).toHaveLength(1)

    await edit($, file('src/b.ts'))
    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(1)

    await clock.advance(5 * MINUTE - 1_000 - 1)
    expect(world.spawns).toHaveLength(1)
    await clock.advance(1)
    expect(world.spawns).toHaveLength(2)
  })

  test('the deferred check waits while a turn is in progress and the turn end takes over', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 1_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(1_000)
    await edit($, file('src/b.ts'))
    await endTurn($)

    await edit($, file('src/c.ts'))
    await clock.advance(5 * MINUTE)
    expect(world.spawns).toHaveLength(1)

    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(2)
  })

  test('a zero interval runs on every turn that has edits', { options: { minIntervalMinutes: 0 } }, async ($, on) => {
    const world = newWorld({ plan: { durationMs: 1_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(1_000)
    await edit($, file('src/b.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toHaveLength(2)
  })

  test('the interval counts from the start of the last run of any session', async ($, on) => {
    const world = newWorld()
    const store: Record<string, unknown> = {
      [lastKey]: { startedAt: NOW - 2 * MINUTE, durationMs: 1_000, exitCode: 0, outcome: 'ok', edits: 1 },
    }
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(0)

    await clock.advance(3 * MINUTE)
    expect(world.spawns).toHaveLength(1)
  })
})

describe('lock', () => {
  const fresh = (sessionId: string, age: number) => ({ [lockKey]: { sessionId, startedAt: NOW - age } })

  test('a live lock of another session blocks the run and keeps the edits', async ($, on) => {
    const world = newWorld()
    const store = fresh(OTHER_SESSION, MINUTE)
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toHaveLength(0)
    expect(await panelOf($)).toContain('edições pendentes: 1')
    expect(store[lockKey]).toEqual({ sessionId: OTHER_SESSION, startedAt: NOW - MINUTE })
  })

  test('a lock older than the timeout is stale and ignored', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world, fresh(OTHER_SESSION, 600_000 + 1_000))

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toHaveLength(1)
  })

  test('a recent lock of this very session without a run of ours is an orphan and ignored', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world, fresh(SESSION, 5_000))

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toHaveLength(1)
  })

  test('finishing a run never deletes a lock that belongs to another session', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 1_000 } })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    store[lockKey] = { sessionId: OTHER_SESSION, startedAt: NOW }
    await clock.advance(1_000)

    expect(store[lockKey]).toEqual({ sessionId: OTHER_SESSION, startedAt: NOW })
  })
})

describe('failures', () => {
  test('a failing command toasts the code and the first stderr line, keeps the status and does not retry on its own', async ($, on) => {
    const world = newWorld({
      plan: { durationMs: 3_000, code: 2, chunks: [{ stream: 'stderr', text: 'fatal: broken graph\nsecond line\n' }] },
    })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(3_000)

    expect(world.toasts).toEqual(['grafo: falhou (código 2): fatal: broken graph'])
    expect(lastStatus(world)).toBe('grafo: falhou')
    expect(store[lastKey]).toEqual({ startedAt: NOW, durationMs: 3_000, exitCode: 2, outcome: 'failed', edits: 1 })
    expect(store[lockKey]).toBeUndefined()
    const panel = await panelOf($)
    expect(panel).toContain('edições pendentes: 1')
    expect(panel).toContain('falha em aberto: sim')

    await clock.advance(30 * MINUTE)
    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(1)
    expect(lastStatus(world)).toBe('grafo: falhou')
  })

  test('a new edit after a failure allows one more attempt, and a success clears the failure', { options: { minIntervalMinutes: 0 } }, async ($, on) => {
    const world = newWorld({ plan: { code: 1 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    expect(world.toasts).toHaveLength(1)

    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(1)

    world.plan = { code: 0 }
    await edit($, file('src/b.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.spawns).toHaveLength(2)
    expect(lastStatus(world)).toMatch(/^grafo ok \(/)
    const panel = await panelOf($)
    expect(panel).not.toContain('falha em aberto')
    expect(panel).toContain('edições pendentes: nenhuma')
  })

  test('a signal ending the command is reported as a failure', async ($, on) => {
    const world = newWorld({ plan: { code: null, signal: 'SIGKILL' } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.toasts[0]).toContain('sinal SIGKILL')
  })

  test('a command that never finishes is killed at the timeout and counts as a failure', { options: { timeoutSeconds: 10 } }, async ($, on) => {
    const world = newWorld({ plan: { durationMs: 600_000 } })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    await clock.advance(9_999)
    expect(lastStatus(world)).toBe('grafo: atualizando...')

    await clock.advance(1)
    expect(world.toasts).toEqual(['grafo: falhou (tempo esgotado após 10s)'])
    expect(lastStatus(world)).toBe('grafo: falhou')
    expect(store[lastKey]).toEqual({ startedAt: NOW, durationMs: 10_000, exitCode: null, outcome: 'timeout', edits: 1 })
    expect(store[lockKey]).toBeUndefined()
  })

  test('a command that cannot start is a failure with its reason', async ($, on) => {
    const world = newWorld({ plan: { startError: 'spawn EACCES' } })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('grafo: falhou')
    expect(lastStatus(world)).toBe('grafo: falhou')
    expect(store[lockKey]).toBeUndefined()
  })
})

describe('missing executable', () => {
  test('one toast, nothing runs, and later turns stay quiet', async ($, on) => {
    const world = newWorld({ hasExecutable: false })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    await edit($, file('src/b.ts'))
    await endTurn($)
    await clock.settle()

    expect(world.toasts).toEqual(['graphify não encontrado no PATH; graph-sync desligado nesta sessão'])
    expect(world.versionChecks).toBe(1)
    expect(world.spawns).toHaveLength(0)
    expect(store[lockKey]).toBeUndefined()
    expect(await panelOf($)).toContain('executável: não encontrado')
  })

  test('/graph now checks again without a second toast and recovers when the tool appears', async ($, on) => {
    const world = newWorld({ hasExecutable: false })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()

    expect((await graph($, 'now')).text).toContain('não foi encontrado no PATH')
    expect(world.toasts).toHaveLength(1)

    world.hasExecutable = true
    expect((await graph($, 'now')).text).toContain('iniciada')
    await clock.settle()
    expect(world.spawns).toHaveLength(1)
    expect(await panelOf($)).not.toContain('executável: não encontrado')
  })
})

describe('session end', () => {
  test('ending the session stops a running command and releases the lock', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 60_000 } })
    const store: Record<string, unknown> = {}
    const clock = stand(on, world, store)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    expect(store[lockKey]).toBeDefined()

    await endSession($, 'other')
    await clock.advance(60_000)

    expect(lastStatus(world)).toBeUndefined()
    expect(store[lockKey]).toBeUndefined()
    expect(store[lastKey]).toBeUndefined()
  })

  test('a /clear leaves a running command alone', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 5_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    await endSession($, 'clear')
    await clock.advance(5_000)

    expect(lastStatus(world)).toBe('grafo ok (5s)')
  })
})
