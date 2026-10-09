import { describe, expect, mock, test } from 'claude-code/testing'

import { runChecks } from '../hooks/doctor/run'
import type { Check, Context } from '../hooks/doctor/types'
import { contextOf, newFake, schedulerOf } from './world'

const instant = (id: string, reason = 'done'): Check => ({ id, run: async () => ({ id, status: 'ok', reason }) })

describe('runChecks', () => {
  test('results keep the order of the checks', async (_$, on) => {
    const scheduler = schedulerOf(mock.clock(on))

    const results = await runChecks(contextOf(newFake()), scheduler, [instant('a'), instant('b')])

    expect(results.map(entry => entry.id)).toEqual(['a', 'b'])
  })

  test('a check that throws becomes a skipped result, never an exception', async (_$, on) => {
    const scheduler = schedulerOf(mock.clock(on))
    const boom: Check = {
      id: 'boom',
      run: async () => {
        throw new Error('exploded')
      },
    }

    const results = await runChecks(contextOf(newFake()), scheduler, [boom, instant('b')])

    expect(results[0]).toEqual({ id: 'boom', status: 'skipped', reason: 'verificação falhou: exploded' })
    expect(results[1]?.status).toBe('ok')
  })

  test('the budget cuts a check that never answers and keeps the finished ones', async (_$, on) => {
    const clock = mock.clock(on)
    const scheduler = schedulerOf(clock)
    const stuck: Check = { id: 'stuck', run: () => new Promise(() => undefined) }
    const ctx: Context = contextOf(newFake())

    const pending = runChecks(ctx, scheduler, [instant('fast'), stuck], 8000)
    await clock.advance(7999)
    let isDone = false
    void pending.then(() => {
      isDone = true
    })
    await clock.settle()
    expect(isDone).toBe(false)

    await clock.advance(1)
    const results = await pending

    expect(results).toEqual([
      { id: 'fast', status: 'ok', reason: 'done' },
      { id: 'stuck', status: 'skipped', reason: 'sem resposta em 8s' },
    ])
  })

  test('finishing early cancels the budget timer', async (_$, on) => {
    const clock = mock.clock(on)
    const inner = schedulerOf(clock)
    let isCancelled = false
    let isFired = false
    const scheduler = {
      after: (ms: number, fn: () => void) => {
        const timer = inner.after(ms, () => {
          isFired = true
          fn()
        })
        return {
          cancel: () => {
            isCancelled = true
            timer.cancel()
          },
        }
      },
    }

    await runChecks(contextOf(newFake()), scheduler, [instant('a')])
    await clock.advance(10_000)

    expect(isCancelled).toBe(true)
    expect(isFired).toBe(false)
  })
})
