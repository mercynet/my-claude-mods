import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { proposalFor, verdictOf } from '../hooks/lean/proposal'
import type { ConversationRecord } from '../hooks/lean/records'
import { AGENTS_TEXT, ROOT, addSpec, contextInput, lean, newWorld, stand, test } from './world'

const OTHER = '/srv/example/other-project'

const REAL_SIZED_TEXT = AGENTS_TEXT.replace(
  'Body of section C.',
  `Body of section C.\n${'Extra detail for section C. '.repeat(120)}`,
)

const past = (index: number, firstRequestTokens: number, overrides: Partial<ConversationRecord> = {}): ConversationRecord => ({
  sessionId: `past-${index}`,
  projectDir: ROOT,
  startedAt: 1_600_000_000_000 + index,
  seq: [],
  reads: 1,
  mode: 'lean',
  reason: 'no-spec',
  detail: 'sem spec ativa',
  applied: false,
  cut: [],
  missing: [],
  drift: [],
  savedBytes: 4000,
  savedTokens: 1000,
  firstRequestTokens,
  ...overrides,
})

const finishTurn = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId, reason: 'answer' })

const openConversation = ($: Engine) => $.prompt.context(contextInput(REAL_SIZED_TEXT))

describe('proposal to apply the cut', () => {
  test('three simulated lean conversations with a material gain bring one toast and one transcript line', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [past(1, 2000), past(2, 2200), past(3, 1800)] })
    await openConversation($)

    await finishTurn($, 't1')
    await finishTurn($, 't2')

    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('/lean apply')
    expect(world.toasts[0]).toContain('/lean dismiss')
    expect(world.toasts[0]).toContain('3 conversas')
    expect(world.transcript).toEqual(world.toasts)
  })

  test('conversations measured in another project do not count towards this one', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [1, 2, 3].map(index => past(index, 2000, { projectDir: OTHER })) })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toEqual([])
  })

  test('two samples are not enough', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [past(1, 2000), past(2, 2000)] })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toEqual([])
  })

  test('a negligible or modest gain stays silent', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [past(1, 100000), past(2, 120000), past(3, 110000)] })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toEqual([])
  })

  test('nothing is proposed once the cut is already applied', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [past(1, 2000), past(2, 2000), past(3, 2000)], settings: { applyCut: true } })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toEqual([])
  })

  test('a project without the specs marker never gets a proposal', async ($, on) => {
    const world = newWorld({ dirs: new Set() })
    stand(on, world, { history: [past(1, 2000), past(2, 2000), past(3, 2000)] })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toEqual([])
  })

  test('a conversation with an active spec still proposes from the past simulated ones', async ($, on) => {
    const world = newWorld()
    addSpec(world, 'feature-x')
    stand(on, world, { history: [past(1, 2000), past(2, 2000), past(3, 2000)] })
    await openConversation($)

    await finishTurn($, 't1')

    expect(world.toasts).toHaveLength(1)
  })
})

describe('/lean dismiss', () => {
  test('silences the proposal in later conversations of the same project', async ($, on) => {
    const world = newWorld()
    stand(on, world, { history: [past(1, 2000), past(2, 2000), past(3, 2000)] })
    await openConversation($)
    await finishTurn($, 't1')
    expect(world.toasts).toHaveLength(1)

    const reply = await lean($, 'dismiss')
    expect(reply.text).toContain('proposta recusada')

    world.sessionId = 'session-2'
    await openConversation($)
    await finishTurn($, 't2')

    expect(world.toasts).toHaveLength(1)
  })
})

describe('proposalFor', () => {
  const history = [past(1, 2000), past(2, 2000), past(3, 2000)]

  test('a refusal holds while the gain stays within the resurface margin', () => {
    const dismissed = { [ROOT]: { at: 1, share: 0.48 } }

    expect(proposalFor(history, ROOT, false, dismissed)).toBeUndefined()
  })

  test('the proposal comes back when the gain rises past the resurface margin', () => {
    const dismissed = { [ROOT]: { at: 1, share: 0.3 } }

    expect(proposalFor(history, ROOT, false, dismissed)?.share).toBe(0.5)
  })

  test('a refusal made without any measurement never resurfaces on its own', () => {
    const dismissed = { [ROOT]: { at: 1, share: 1 } }

    expect(proposalFor(history, ROOT, false, dismissed)).toBeUndefined()
  })

  test('a refusal in one project does not silence another', () => {
    const dismissed = { [OTHER]: { at: 1, share: 1 } }

    expect(proposalFor(history, ROOT, false, dismissed)?.projectDir).toBe(ROOT)
  })

  test('a negative saving reads as negligible', () => {
    expect(verdictOf(-0.1)).toBe('negligible')
    expect(verdictOf(0.08)).toBe('modest')
    expect(verdictOf(0.12)).toBe('material')
  })
})
