import { describe, expect } from 'claude-code/testing'

import { ROOT, addSpec, compact, compose, contextInput, lean, newWorld, stand, submit, test } from './world'

describe('escalation from lean to full', () => {
  test('a spec created mid-conversation sends one reminder listing the omitted sections', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())

    await submit($, 'first prompt')
    addSpec(world, 'feature-x')
    await submit($, 'second prompt')
    await submit($, 'third prompt')

    expect(world.submittedContexts[0]).toBeUndefined()
    expect(world.submittedContexts[1]).toHaveLength(1)
    expect(world.submittedContexts[1]?.[0]).toContain('changed from lean to full')
    expect(world.submittedContexts[1]?.[0]).toContain('Section C')
    expect(world.submittedContexts[1]?.[0]).toContain('Section A')
    expect(world.submittedContexts[2]).toBeUndefined()
  })

  test('/lean mode full also triggers the single reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())

    await lean($, 'mode full')
    await submit($, 'next prompt')
    await submit($, 'another prompt')

    expect(world.submittedContexts[0]?.[0]).toContain('override')
    expect(world.submittedContexts[1]).toBeUndefined()
  })

  test('no reminder while the conversation is still lean', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())

    await submit($, 'one')
    await submit($, 'two')

    expect(world.submittedContexts).toEqual([undefined, undefined])
  })

  test('in simulation nothing was omitted, so a spec brings no reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await $.prompt.context(contextInput())

    addSpec(world, 'feature-x')
    await submit($, 'prompt')

    expect(world.submittedContexts[0]).toBeUndefined()
  })

  test('a unreadable spec folder mid-conversation counts as full and reminds', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())

    world.git = { exitCode: 128, stdout: '' }
    await submit($, 'prompt')

    expect(world.submittedContexts[0]?.[0]).toContain('unknown-branch')
  })

  test('a prompt dropped by another hook does not use up the reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    world.dropNextSubmit = true
    await submit($, 'dropped')
    await submit($, 'kept')

    expect(world.submittedContexts[0]).toHaveLength(1)
    expect(world.submittedContexts[1]).toHaveLength(1)
  })

  test('a later context read in full mode keeps the pending reminder, since it may be a subagent', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    await $.prompt.context(contextInput())
    await submit($, 'next prompt')

    expect(world.submittedContexts[0]?.[0]).toContain('changed from lean to full')
  })

  test('after a compaction the context is rendered again, so the pending reminder is dropped', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    await compact($)
    await $.prompt.context(contextInput())
    await submit($, 'after compaction')

    expect(world.submittedContexts[0]).toBeUndefined()
  })

  test('a compaction followed by a lean read arms a fresh reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')
    await submit($, 'first escalation')

    await compact($)
    world.dirs.delete(`${ROOT}/specs/_active/feature-x`)
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')
    await submit($, 'second escalation')

    expect(world.submittedContexts[0]).toHaveLength(1)
    expect(world.submittedContexts[1]).toHaveLength(1)
  })

  test('a skipped compaction keeps the pending reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    world.skipCompaction = true
    await compact($)
    await submit($, 'prompt')

    expect(world.submittedContexts[0]).toHaveLength(1)
  })

  test('a subagent compaction does not touch the main conversation reminder', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    await compact($, 'agent-7')
    await submit($, 'prompt')

    expect(world.submittedContexts[0]).toHaveLength(1)
  })
})

describe('prompt.compose', () => {
  test('adds the mode section only while a cut is applied', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    expect((await compose($)).sections.map(section => section.id)).toEqual(['intro'])

    await $.prompt.context(contextInput())
    expect((await compose($)).sections.map(section => section.id)).toEqual(['intro'])

    await lean($, 'apply')
    await $.prompt.context(contextInput())
    const sections = (await compose($)).sections

    expect(sections.at(-1)).toMatchObject({ id: 'lean-context:mode', scope: 'session' })
    expect(sections.at(-1)?.text).toContain('Section A')
  })

  test('the section stays while the main context lacks the sections and goes once a compaction renders it whole', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    await $.prompt.context(contextInput())
    expect((await compose($)).sections.map(section => section.id)).toContain('lean-context:mode')

    await compact($)
    await $.prompt.context(contextInput())
    expect((await compose($)).sections.map(section => section.id)).toEqual(['intro'])
  })
})

describe('measurement', () => {
  const step = {
    turnId: 't1',
    index: 0,
    model: 'test-model',
    messageCount: 1,
  }

  const response = (tokens: { input: number; read: number; created: number }) => ({
    turnId: 't1',
    index: 0,
    answer: '',
    toolUses: [],
    stopReason: 'end_turn' as const,
    usage: {
      input_tokens: tokens.input,
      output_tokens: 10,
      cache_read_input_tokens: tokens.read,
      cache_creation_input_tokens: tokens.created,
      model: 'test-model',
    },
  })

  const drain = async (stream: AsyncGenerator<unknown, unknown>): Promise<void> => {
    let next = await stream.next()
    while (next.done !== true) next = await stream.next()
  }

  test('the first request of the first turn records its real input tokens', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    on('turn.step', async function* () {
      return response({ input: 1200, read: 20000, created: 9800 })
    })
    await $.prompt.context(contextInput())

    await drain($.turn.step(step))

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('1o pedido real: 31 000 tokens')
  })

  test('a later turn does not overwrite the first request measure', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    on('turn.step', async function* () {
      return response({ input: 1000, read: 0, created: 0 })
    })
    await $.prompt.context(contextInput())

    world.turns = 3
    await drain($.turn.step(step))

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('1o pedido real: ainda nao medido')
  })

  test('the end of the first turn records the context size and the weight breakdown once', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await $.prompt.context(contextInput())

    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('fim do 1o turno: 31 000 tokens')
    expect(panel).toContain('skills: 25/25 listadas, 3 100 tokens')
    expect(panel).toContain('mcp context7: 2/2 ferramentas carregadas, 1 200 tokens')
    expect(panel).toContain('mcp example-mcp: 0/1 ferramentas carregadas')
    expect(panel).toContain('memoria AGENTS.md (Project): 8 600 tokens')
  })

  test('the breakdown is asked for once per conversation, not on every turn', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await $.prompt.context(contextInput())

    await $.turn.complete({ answer: 'one', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    world.turns = 2
    await $.turn.complete({ answer: 'two', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
    world.turns = 3
    await $.turn.complete({ answer: 'three', durationMs: 5, isAborted: false, turnId: 't3', reason: 'answer' })

    expect(world.breakdownCalls).toBe(1)
  })

  test('without a recorded conversation nothing is measured', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('esta conversa: sem registo')
  })

  test('the observed order of prompt.submit and prompt.context is kept for the live check', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    await submit($, 'first')
    await $.prompt.context(contextInput())

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('ordem observada dos eventos: prompt.submit > prompt.context')
  })
})

describe('history and A/B', () => {
  test('/lean reset clears the history but keeps the apply setting', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())

    await lean($, 'reset')

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('esta conversa: sem registo')
    expect(panel).toContain('corte: APLICADO')
  })

  test('measured lean conversations with and without the cut feed the A/B averages', async ($, on) => {
    const world = newWorld({ sessionId: 'a' })
    stand(on, world)
    on('turn.step', async function* () {
      return {
        turnId: 't',
        index: 0,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: {
          input_tokens: world.sessionId === 'cut' ? 27000 : 31000,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          model: 'm',
        },
      }
    })
    const measure = async (sessionId: string): Promise<void> => {
      world.sessionId = sessionId
      await $.prompt.context(contextInput())
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
      let next = await stream.next()
      while (next.done !== true) next = await stream.next()
    }

    await measure('plain-1')
    await measure('plain-2')
    await lean($, 'apply')
    await measure('cut')

    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('sem corte n=2 media=31 000')
    expect(panel).toContain('com corte n=1 media=27 000')
    expect(panel).toContain('Veredicto')
  })
})
