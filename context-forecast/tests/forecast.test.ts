import type { On, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]

const PLUGIN = 'context-forecast'
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 8,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 8 },
  view: {}
} as const

const PANE = {
  title: 'Previsão do contexto',
  isFocused: false,
  placement: 'dock',
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 40 },
  view: {}
} as const

type ToolAnswer = { text?: string; result?: unknown; isError?: boolean }

type Breakdown = {
  categories: { name: string; tokens: number; kind: string }[]
  memoryFiles: { path: string; tokens: number }[]
  autoCompactThreshold?: number
}

type World = {
  store?: Record<string, unknown>
  breakdown?: Breakdown
  tool?: (e: Record<string, unknown>) => ToolAnswer
  compact?: (e: { trigger: string; instructions?: string }) => unknown
  classify?: () => string | undefined
}

type Calls = {
  usage: (string | undefined)[]
  toasts: string[]
  compact: { trigger: string; instructions?: string }[]
  classify: { text: string; model?: string }[]
  opened: string[]
}

const BREAKDOWN: Breakdown = {
  categories: [
    { name: 'System prompt', tokens: 8_000, kind: 'used' },
    { name: 'System tools', tokens: 14_000, kind: 'used' },
    { name: 'MCP tools', tokens: 6_000, kind: 'used' },
    { name: 'Memory files', tokens: 12_000, kind: 'used' },
    { name: 'Messages', tokens: 76_000, kind: 'used' },
    { name: 'Free space', tokens: 70_000, kind: 'free' }
  ],
  memoryFiles: [
    { path: '/repo/CLAUDE.md', tokens: 1_000 },
    { path: '/repo/AGENTS.md', tokens: 9_000 }
  ]
}

const engine = (on: On, world: World = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const calls: Calls = { usage: [], toasts: [], compact: [], classify: [], opened: [] }

  const store: Record<string, unknown> = structuredClone(world.store ?? {})

  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = structuredClone(e.value)

    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', (_$, e) => {
    calls.usage.push(e.breakdown)

    return {
      value: {
        startedAt: 0,
        context: {
          window: 200_000,
          ...(e.breakdown !== undefined && world.breakdown !== undefined ? { breakdown: world.breakdown } : {})
        },
        rateLimits: []
      } as never
    }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const failsOnMarker = (input: Record<string, unknown>): ToolAnswer => ({ isError: JSON.stringify(input).includes('FAILS') })

  on('tool.call', (_$, e) => {
    const answer = (world.tool ?? failsOnMarker)(e as unknown as Record<string, unknown>)

    return {
      result: answer.result ?? {},
      text: answer.text ?? '',
      ...(answer.isError === true ? { isError: true } : {}),
      isReadOnly: false,
      ref: 0
    } as never
  })
  on('session.compact', (_$, e) => {
    const trigger = e.trigger ?? 'plugin'

    calls.compact.push({ trigger, ...(e.instructions === undefined ? {} : { instructions: e.instructions }) })

    return (world.compact ?? (() => ({ messages: SUMMARY, tokensBefore: 160_000, tokensAfter: 30_000 })))({ trigger, instructions: e.instructions }) as never
  })
  on('model.classify', (_$, e) => {
    calls.classify.push({ text: e.text, ...(e.options?.model === undefined ? {} : { model: e.options.model }) })

    return { value: world.classify?.() }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('ui.toast', (_$, e) => {
    calls.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    calls.opened.push(e.id)

    return { value: { isPlaced: true } }
  })

  return { clock, calls, store }
}

const measure = (
  $: Engine,
  tokens: number,
  percent = Math.round((tokens / 200_000) * 100),
  window = 200_000,
  extra: { rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]; cost?: { usd: number } } = {}
) =>
  $.session.measure({
    context: { tokens, window, percent },
    rateLimits: extra.rateLimits ?? [],
    ...(extra.cost === undefined ? {} : { cost: extra.cost }),
    changed: ['context', ...(extra.rateLimits === undefined ? [] : ['rateLimits' as const]), ...(extra.cost === undefined ? [] : ['cost' as const])]
  })

const startSession = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const endSession = ($: Engine, reason: 'clear' | 'other' = 'clear') =>
  $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'forecast', props: PANE })

type Drawn = string | { type: string; props?: Record<string, unknown>; children?: Drawn[] }

// Columns join their children by line, everything else inline, so a test reads the band the way it is read on screen.
const flatten = (node: Drawn): string =>
  typeof node === 'string'
    ? node
    : (node.children ?? []).map(flatten).join(node.type === 'Box' && node.props?.flexDirection === 'column' ? '\n' : '')

const screen = async (ui: { drawn: () => Promise<unknown> }) => flatten((await ui.drawn()) as Drawn)

const lines = async (ui: { drawn: () => Promise<unknown> }) => (await screen(ui)).split('\n')

const headline = async (ui: { drawn: () => Promise<unknown> }) => (await lines(ui))[0] ?? ''

const gaugeOf = (line: string) => /([█░│]{12})/.exec(line)?.[1]

const rowsOf = async (ui: { drawn: () => Promise<unknown> }) => ((await ui.drawn()) as { children: unknown[] }).children.length

const runCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'forecast', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const press = (ui: { press: (target: { key: string }) => Promise<unknown> }, key: string) => ui.press({ key })

const SUMMARY: SessionMessage[] = [{ role: 'assistant', text: 'summary', toolUses: [] }]

const MESSAGES: SessionMessage[] = [{ role: 'user', text: 'hello', toolUses: [] }]

const compactEvent = (trigger: 'manual' | 'auto' | 'precompute') => ({ trigger, messages: MESSAGES })

const heavy = ($: Engine, tokens = 160_000) => measure($, tokens, Math.round(tokens / 10_000), 1_000_000)

const sample = (tokens: number) => ({ tokens, window: 1_000_000, reason: 'clear', at: NOW - 86_400_000 })

describe('band', () => {
  test('draws nothing before the first measurement', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    expect(await screen(ui)).not.toContain('Limpo')
  })

  test('calm: a single line with the weather, a 12-cell gauge with one mark at heavy, the percentage and the tokens', async ($, on) => {
    engine(on, { breakdown: BREAKDOWN })
    const ui = await mountBand($)

    await heavy($, 160_000)

    expect(await rowsOf(ui)).toBe(1)
    expect(await screen(ui)).toBe('☁ Nublado ██░│░░░░░░░░ 16% · 160k/1M')
  })

  test('each usage range has its weather', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 36_000, 18)
    expect(await headline(ui)).toContain('Limpo')
    expect(await headline(ui)).toContain('36k/200k')

    await measure($, 50_000, 25)
    expect(await headline(ui)).toContain('Nublado')

    await measure($, 134_000, 67)
    expect(await headline(ui)).toContain('Chuva')
    expect(await headline(ui)).toContain('134k/200k')

    await measure($, 160_000, 80)
    expect(await headline(ui)).toContain('Tempestade')

    await measure($, 185_000, 92)
    expect(await headline(ui)).toContain('Compactar agora')

    await measure($, 20_000, 10)
    expect(await headline(ui)).toContain('Limpo')
  })

  test('the weather follows the absolute thresholds: on a 1M window 160k is no longer "Limpo"', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 40_000)
    expect(await headline(ui)).toContain('Limpo')

    await heavy($, 140_000)
    expect(await headline(ui)).toContain('Limpo')

    await heavy($, 160_000)
    expect(await headline(ui)).toContain('Nublado')

    await heavy($, 300_000)
    expect(await headline(ui)).toContain('Chuva')

    await heavy($, 650_000)
    expect(await headline(ui)).toContain('Tempestade')
    expect(await screen(ui)).toContain('contexto alto 650k')
  })

  test('the gauge has a fixed width and a single mark where heavy begins', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 160_000)
    expect(gaugeOf(await headline(ui))).toBe('██░│░░░░░░░░')

    await measure($, 100_000, 50)
    expect(gaugeOf(await headline(ui))).toHaveLength(12)
    expect((await headline(ui)).match(/│/g)).toHaveLength(1)
  })

  test('the line is right-aligned to the band width', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 100 } })

    await measure($, 36_000, 18)

    expect(await ui.drawn()).toMatchObject({
      type: 'Box',
      props: { width: 100, flexDirection: 'column', alignItems: 'flex-end' },
      children: [{ type: 'Text' }]
    })
  })

  test('draws on the desktop surface as well', async ($, on) => {
    engine(on)
    const ui = await mountBand($, 'desktop')

    await measure($, 36_000, 18)

    expect(await screen(ui)).toContain('Limpo')
  })
})

describe('what the band leaves out', () => {
  test('with nothing to say the band is one line whatever data there is: no delta, sparkline, breakdown, limits, cost or expand button', async ($, on) => {
    engine(on, { breakdown: BREAKDOWN })
    const ui = await mountBand($)

    for (const tokens of [20_000, 30_000, 40_000]) {
      await measure($, tokens, 20, 200_000, {
        rateLimits: [
          { kind: 'five_hour', percentUsed: 34, resetsAt: new Date(NOW + 72 * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: 12 }
        ],
        cost: { usd: 4.2 }
      })
    }

    expect(await rowsOf(ui)).toBe(1)
    expect(await screen(ui)).toBe('☼ Limpo ██░░░░│░░░░░ 20% · 40k/200k')
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('the turns-until-high projection and the full breakdown belong to the panel, never to the band', async ($, on) => {
    engine(on, { breakdown: BREAKDOWN })
    const ui = await mountBand($)

    for (const tokens of [500_000, 530_000, 560_000, 590_000]) await heavy($, tokens)

    expect(await screen(ui)).not.toContain('turnos até')
    expect((await runCommand($, 'why')).text).toContain('~2 turnos até 650k')
  })

  test('the summary breakdown is asked for on its own, the full one only by /forecast full', async ($, on) => {
    const { calls } = engine(on, { breakdown: BREAKDOWN })

    await startSession($)
    await measure($, 120_000, 60)
    await measure($, 130_000, 65)
    await mountBand($)

    expect(calls.usage.filter(detail => detail !== undefined)).toEqual(['summary', 'summary', 'summary'])
    expect(calls.usage).not.toContain('full')

    await runCommand($, 'full')

    expect(calls.usage).toContain('full')
    expect(calls.opened).toEqual(['forecast'])
  })

  test('no breakdown available breaks nothing', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 120_000, 60)

    expect(await screen(ui)).toContain('Chuva')
  })

  test('on a narrow terminal only the gauge goes away', async ($, on) => {
    engine(on)
    const at = async (columns: number) => {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'AbovePrompt',
        requestId: `band-${columns}`,
        props: { ...BAND, bodyColumns: columns }
      })

      return headline(ui)
    }

    await heavy($, 160_000)

    expect(await at(120)).toBe('☁ Nublado ██░│░░░░░░░░ 16% · 160k/1M')
    expect(await at(50)).toBe('☁ Nublado ██░│░░░░░░░░ 16% · 160k/1M')
    expect(await at(49)).toBe('☁ Nublado 16% · 160k/1M')
  })
})

describe('second line', () => {
  const resetsAt = new Date(NOW + 72 * 60_000).toISOString()

  test('warns before the auto-compact threshold so the manual compact (with its gate) can run first', async ($, on) => {
    engine(on, { breakdown: { ...BREAKDOWN, autoCompactThreshold: 167_000 } })
    const ui = await mountBand($)

    for (const tokens of [100_000, 130_000, 155_000]) await heavy($, tokens)

    expect(await rowsOf(ui)).toBe(2)
    expect((await lines(ui))[1]).toContain('▸ auto-compact perto')
    expect(await screen(ui)).toContain('faça /compact manual antes')
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  })

  test('warns when the 5h window is about to run out at the current pace', async ($, on) => {
    const { clock } = engine(on)
    const ui = await mountBand($)

    await measure($, 60_000, 30, 200_000, { rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt }] })
    expect(await rowsOf(ui)).toBe(1)

    await clock.advance(30 * 60_000)
    await measure($, 70_000, 35, 200_000, { rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt }] })

    expect((await lines(ui))[1]).toContain('▸ janela de 5h em 80% · reinicia em 42min · no ritmo atual esgota em ~20min')
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  })

  test('empty rate limits and an absent cost leave no text at all, and cost never reaches the band', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 60_000, 30, 200_000, { rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt }], cost: { usd: 1 } })
    await measure($, 70_000, 35, 200_000, { rateLimits: [] })

    expect(await screen(ui)).toBe('☁ Nublado ████░░│░░░░░ 35% · 70k/200k')
    expect(await screen(ui)).not.toContain('$')
  })

  test('the panel keeps what the band left out: limits with their gauges and the cost', async ($, on) => {
    engine(on)
    const pane = await mountPane($)

    await measure($, 60_000, 30, 200_000, {
      rateLimits: [
        { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
        { kind: 'five_hour', percentUsed: 34, resetsAt }
      ],
      cost: { usd: 4.2133 }
    })

    const shown = await screen(pane)

    expect(shown).toMatch(/5h\s+█+░+ 34% · reinicia em 1h12/)
    expect(shown).toMatch(/7d\s+█+░+ 12% · reinicia em 3d/)
    expect(shown).toContain('custo da sessão $4.21')
  })
})

describe('time to clear', () => {
  test('a commit on a heavy context warns with the reasons, only for that turn', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)

    expect(await rowsOf(ui)).toBe(2)
    expect((await lines(ui))[1]).toContain('▸ bom momento para /clear: git commit feito, contexto pesado 310k (limiar 300k)')
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()

    await heavy($, 320_000)

    expect(await screen(ui)).not.toContain('bom momento')
  })

  test('a commit on a light context is no reason to clear', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 40_000, 20)
    await bash($, 'git commit -m "x"')
    await measure($, 50_000, 25)

    expect(await screen(ui)).not.toContain('bom momento')
  })

  test('below the heavy mark not even a push or a commit together warns', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 100_000)
    await bash($, 'git commit -m "x" && git push')
    await heavy($, 160_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).toContain('Sem motivo para limpar agora')
  })

  test('a commit that fails does not count as a closed task', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 280_000)
    await bash($, 'git commit -m "FAILS"')
    await heavy($, 310_000)

    expect(await screen(ui)).not.toContain('bom momento')
    expect(await screen(ui)).not.toContain('git commit feito')
  })

  test('a STATE handoff commit is a strong checkpoint even on a light context', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 30_000, 15)
    await bash($, 'git commit -m "docs(e2): STATE handoff for card 2481"')
    await measure($, 36_000, 18)

    expect((await lines(ui))[1]).toContain('▸ bom momento para /clear: commit STATE handoff')
  })

  test('a green test suite is recorded but is too routine to warn on its own, a red one is not recorded', async ($, on) => {
    let output = 'Tests:    12 passed (30 assertions)'

    engine(on, { tool: () => ({ text: output }) })
    const ui = await mountBand($)

    await heavy($, 280_000)
    await bash($, 'vendor/bin/pest --filter Unit')
    await heavy($, 310_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).toContain('- suite de testes verde: +5')

    output = 'Tests:    1 failed, 11 passed'
    await heavy($, 315_000)
    await bash($, 'vendor/bin/pest')
    await heavy($, 320_000)

    expect((await runCommand($, 'why')).text).not.toContain('suite de testes verde')
  })

  test('a runner only the extraTestPattern option knows is recorded once it is set', { options: { extraTestPattern: '\\brun-suite\\b' } }, async ($, on) => {
    engine(on, { tool: () => ({ text: 'Tests:    3 passed' }) })
    await mountBand($)

    await heavy($, 280_000)
    await bash($, './bin/run-suite --fast')
    await heavy($, 310_000)

    expect((await runCommand($, 'why')).text).toContain('- suite de testes verde: +5')
  })

  test('a finished todo list and a finished task are checkpoints', async ($, on) => {
    let answer: ToolAnswer = {
      result: { oldTodos: [{ status: 'pending' }], newTodos: [{ status: 'completed' }] }
    }

    engine(on, { tool: () => answer })
    const ui = await mountBand($)

    await heavy($, 280_000)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed', activeForm: 'a' }] })
    await heavy($, 310_000)

    expect(await screen(ui)).toContain('lista de tarefas concluída')

    answer = { result: {} }
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await heavy($, 315_000)

    expect((await runCommand($, 'why')).text).toContain('- tarefa concluída: +10')
  })

  test('a turn that adds a lot of context is no reason to clear on its own', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 40_000)
    await heavy($, 240_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).toContain('Sem motivo para limpar agora')
  })

  test('the same tool failing four times in a row is a loop, and a success of that tool resets the count', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 60_000, 30)

    for (let i = 0; i < 4; i += 1) await bash($, 'make FAILS')

    expect(await screen(ui)).toContain('possível loop')
    expect(await screen(ui)).toContain('Bash falhou 4x seguidas')

    await bash($, 'ls')

    expect(await screen(ui)).not.toContain('possível loop')
  })

  test('failures of different tools do not add up to a loop', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await measure($, 60_000, 30)

    for (let i = 0; i < 3; i += 1) {
      await bash($, 'make FAILS')
      await $.tool.call({ tool: 'Edit', file_path: '/repo/FAILS.php', old_string: 'a', new_string: 'b' })
    }

    expect(await screen(ui)).not.toContain('possível loop')
  })

  const editFiveTimes = async ($: Engine, path: string) => {
    for (let i = 0; i < 5; i += 1) await $.tool.call({ tool: 'Edit', file_path: path, old_string: `a${i}`, new_string: `b${i}` })
  }

  test('editing the same file many times is not a loop while nothing is failing', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 280_000)
    await editFiveTimes($, '/repo/src/Invoice.php')
    await heavy($, 310_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).not.toContain('editado 5x')
  })

  test('the same file edited five times while something fails is a weaker loop signal: it warns only on a heavy context', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 60_000)
    await bash($, 'make FAILS')
    await editFiveTimes($, '/repo/src/Invoice.php')
    await heavy($, 70_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).toContain('- src/Invoice.php editado 5x: +25')

    await heavy($, 310_000)

    expect(await screen(ui)).toContain('src/Invoice.php editado 5x')
    expect(await screen(ui)).toContain('possível loop')
  })

  test('documents never count as a loop and a green suite clears the count', async ($, on) => {
    engine(on)

    await heavy($, 60_000)
    await bash($, 'make FAILS')
    await editFiveTimes($, '/repo/notes/x/STATE.md')
    await heavy($, 70_000)

    expect((await runCommand($, 'why')).text).not.toContain('editado 5x')

    await bash($, 'make FAILS')
    await editFiveTimes($, '/repo/src/Invoice.php')
    await heavy($, 80_000)

    expect((await runCommand($, 'why')).text).toContain('src/Invoice.php editado 5x')

    await bash($, 'vendor/bin/pest --filter Unit')
    await heavy($, 90_000)

    expect((await runCommand($, 'why')).text).not.toContain('editado 5x')
  })
})

describe('topic change', () => {
  const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  const warmUp = async ($: Engine) => {
    for (const tokens of [30_000, 40_000, 50_000, 60_000]) await measure($, tokens, Math.round(tokens / 2_000))
  }

  test('is off by default: no model call is ever made', async ($, on) => {
    const { calls } = engine(on, { classify: () => 'outro assunto' })

    await warmUp($)
    await submit($, 'primeiro pedido sobre faturas em atraso')
    await submit($, 'agora outro pedido sobre o relatório de vendas')

    expect(calls.classify).toEqual([])
  })

  test('when on, asks the cheap model and a different topic adds points to the warning', { options: { classifyTopic: true } }, async ($, on) => {
    const { calls } = engine(on, { classify: () => 'outro assunto' })
    const ui = await mountBand($)

    await warmUp($)
    await submit($, 'primeiro pedido sobre faturas em atraso')
    await submit($, 'agora outro pedido sobre o relatório de vendas')
    await measure($, 160_000, 80)

    expect(calls.classify).toHaveLength(1)
    expect(calls.classify[0]?.model).toBe('haiku')
    expect(calls.classify[0]?.text).toContain('faturas em atraso')
    expect(calls.classify[0]?.text).toContain('relatório de vendas')
    expect(await screen(ui)).toContain('mudança de assunto')
  })

  test('the same topic adds nothing, and the model is configurable', { options: { classifyTopic: true, topicModel: 'sonnet' } }, async ($, on) => {
    const { calls } = engine(on, { classify: () => 'mesmo assunto' })
    const ui = await mountBand($)

    await warmUp($)
    await submit($, 'primeiro pedido sobre faturas em atraso')
    await submit($, 'continua o pedido sobre faturas em atraso')
    await measure($, 160_000, 80)

    expect(calls.classify[0]?.model).toBe('sonnet')
    expect(await screen(ui)).not.toContain('mudança de assunto')
  })

  test('a small context or a short prompt never reaches the model', { options: { classifyTopic: true } }, async ($, on) => {
    const { calls } = engine(on, { classify: () => 'outro assunto' })

    await measure($, 10_000, 5)
    await submit($, 'primeiro pedido sobre faturas em atraso')
    await submit($, 'agora outro pedido sobre o relatório de vendas')

    await warmUp($)
    await submit($, 'sim')

    expect(calls.classify).toEqual([])
  })
})

describe('calibration across sessions', () => {
  const storedSamples = (...tokens: number[]) => ({ samples: tokens.map(sample) })

  test('with fewer than 5 samples the 300k/650k thresholds stand', async ($, on) => {
    engine(on, { store: storedSamples(100_000, 100_000, 100_000, 100_000) })
    const ui = await mountBand($)

    await startSession($)
    await heavy($, 110_000)

    expect(await screen(ui)).not.toContain('▸')
    expect((await runCommand($, 'why')).text).toContain('limiares padrão (4 de 5 amostras nesta janela para calibrar)')
  })

  test('with 5 or more samples the personal quartiles replace them and the warning says so', async ($, on) => {
    engine(on, { store: storedSamples(380_000, 400_000, 400_000, 400_000, 420_000) })
    const ui = await mountBand($)

    await startSession($)
    await heavy($, 410_000)

    expect(await screen(ui)).toContain('contexto alto 410k (limiar 400k, calibrado)')
    expect((await runCommand($, 'why')).text).toContain('limiares calibrados (5 amostras nesta janela, p25 400k, p75 400k)')
  })

  test('/clear records the size where it happened, ignoring tiny contexts', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await measure($, 180_000, 90)
    await endSession($, 'clear')

    expect(store.samples).toEqual([{ tokens: 180_000, window: 200_000, reason: 'clear', at: NOW }])

    await measure($, 5_000, 2)
    await endSession($, 'clear')

    expect(store.samples).toHaveLength(1)
  })

  test('leaving the session without a /clear records nothing', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await measure($, 180_000, 90)
    await endSession($, 'other')

    expect(store.samples).toBeUndefined()
  })

  test('a manual /compact records the size it started from, an auto-compact does not', async ($, on) => {
    const { store } = engine(on, { compact: () => ({ messages: SUMMARY, tokensBefore: 250_000, tokensAfter: 40_000 }) })

    await startSession($)
    await measure($, 250_000, 90, 1_000_000)
    await $.session.compact(compactEvent('auto'))

    expect(store.samples).toBeUndefined()

    await $.session.compact(compactEvent('manual'))

    expect(store.samples).toEqual([{ tokens: 250_000, window: 1_000_000, reason: 'compact', at: NOW }])
  })

  test('with calibration switched off nothing is recorded', { options: { calibrate: false } }, async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await measure($, 180_000, 90)
    await endSession($, 'clear')

    expect(store.samples).toBeUndefined()
  })
})

describe('clear and compact', () => {
  test('a /clear resets the stale warning at once instead of waiting for the next turn', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)

    expect(await screen(ui)).toContain('bom momento')

    await endSession($, 'clear')

    expect(await screen(ui)).not.toContain('bom momento')
    expect(await screen(ui)).not.toContain('310k')
  })

  test('the clear event of the classic hooks resets too', async ($, on) => {
    engine(on)
    const ui = await mountBand($)

    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)
    await $.classic.SessionStart({ source: 'clear' })

    expect(await screen(ui)).not.toContain('bom momento')
  })

  test('a compaction stays in the history as a marker without erasing it, and the panel says how the context fell', async ($, on) => {
    engine(on, { compact: () => ({ messages: SUMMARY, tokensBefore: 200_000, tokensAfter: 40_000 }) })

    await measure($, 100_000, 50)
    await measure($, 200_000, 100)
    await $.session.compact(compactEvent('manual'))
    await measure($, 40_000, 20)

    const shown = await screen(await mountPane($))

    expect(shown).toMatch(/#3\s+.*40k/)
    expect(shown).toContain('↓ compact manual a partir de 200k')
    expect(shown).toMatch(/#2\s+.*200k/)
    expect(shown).toMatch(/#1\s+.*100k/)
    expect(shown).toContain('-160k desde o compact')
  })

  test('an auto-compact is marked too and tells you the PreCompact gate did not see it', async ($, on) => {
    const { calls } = engine(on)

    await measure($, 100_000, 50)
    await measure($, 150_000, 75)
    await measure($, 180_000, 90)
    await $.session.compact(compactEvent('auto'))

    expect(await screen(await mountPane($))).toContain('↓ compact auto a partir de 160k')
    expect(calls.toasts.join(' ')).toContain('auto-compact correu sem passar pelo gate PreCompact manual')
  })

  test('a precompute compaction is ignored', async ($, on) => {
    const { calls } = engine(on)

    await measure($, 100_000, 50)
    await measure($, 150_000, 75)
    await measure($, 180_000, 90)
    await $.session.compact(compactEvent('precompute'))

    expect(await screen(await mountPane($))).not.toContain('↓')
    expect(calls.toasts).toEqual([])
  })
})

describe('compact action', () => {
  const heavyWithCommit = async ($: Engine) => {
    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)
  }

  test('the compact button asks for confirmation first, and cancelling compacts nothing', async ($, on) => {
    const { calls } = engine(on)
    const ui = await mountBand($)

    await heavyWithCommit($)
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()

    await press(ui, 'compact')
    expect(await screen(ui)).toContain('compactar preservando plano, card, branch e ficheiros tocados?')

    await press(ui, 'cancel')

    expect(calls.compact).toEqual([])
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  })

  test('confirming compacts with instructions that keep plan, card, branch and the touched files', async ($, on) => {
    const { calls, store } = engine(on)
    const ui = await mountBand($)

    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/Invoice.php', old_string: 'a', new_string: 'b' })
    await heavyWithCommit($)
    await press(ui, 'compact')
    await press(ui, 'confirm')

    expect(calls.compact).toHaveLength(1)
    expect(calls.compact[0]?.trigger).toBe('plugin')
    expect(calls.compact[0]?.instructions).toContain('plano')
    expect(calls.compact[0]?.instructions).toContain('card')
    expect(calls.compact[0]?.instructions).toContain('branch')
    expect(calls.compact[0]?.instructions).toContain('/repo/src/Invoice.php')
    expect(await screen(ui)).toContain('compactado: 160k -> 30k')
    expect((await screen(await mountPane($))).includes('↓ compact plugin a partir de 160k')).toBe(true)
    expect(store.samples).toEqual([{ tokens: 160_000, window: 1_000_000, reason: 'compact', at: NOW }])
  })

  test('a compaction vetoed by a hook shows its reason instead of failing silently', async ($, on) => {
    const reason = 'Update STATE.md before /compact so the compacted session keeps current decisions and next actions.'
    const { calls, store } = engine(on, { compact: () => ({ skip: reason }) })
    const ui = await mountBand($)

    await heavyWithCommit($)
    await press(ui, 'compact')
    await press(ui, 'confirm')

    expect(await screen(ui)).toContain(`compactação vetada: ${reason}`)
    expect(await screen(ui)).toContain('Atualize o STATE.md')
    expect(calls.toasts.join(' ')).toContain('compactação vetada')
    expect(await screen(ui)).not.toContain('↓')
    expect(store.samples).toBeUndefined()
  })

  test('a manual /compact vetoed by a hook is shown the same way', async ($, on) => {
    const { calls } = engine(on, { compact: () => ({ skip: 'STATE.md em falta' }) })
    const ui = await mountBand($)

    await heavyWithCommit($)
    await $.session.compact(compactEvent('manual'))

    expect(await screen(ui)).toContain('compactação vetada: STATE.md em falta')
    expect(calls.toasts.join(' ')).toContain('compactação vetada')
  })

  test('a compaction that is refused while a turn runs shows the reason', async ($, on) => {
    engine(on, {
      compact: () => {
        throw new Error('cannot compact while a turn is running')
      }
    })
    const ui = await mountBand($)

    await heavyWithCommit($)
    await press(ui, 'compact')
    await press(ui, 'confirm')

    expect(await screen(ui)).toContain('não foi possível compactar')
  })
})

describe('/forecast', () => {
  test('opens the pane', async ($, on) => {
    const { calls } = engine(on)

    const answer = await runCommand($, '')

    expect(answer.text).toBe('Painel da previsão do contexto aberto.')
    expect(calls.opened).toEqual(['forecast'])
  })

  test('why explains the current warning with the points of each reason', async ($, on) => {
    engine(on)

    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)

    const lines = ((await runCommand($, 'why')).text ?? '').split('\n')

    expect(lines[0]).toContain('Score 50/100')
    expect(lines).toContain('- git commit feito: +30')
    expect(lines).toContain('- contexto pesado 310k (limiar 300k): +20')
    expect(lines.some(line => line.includes('limiares padrão'))).toBe(true)
  })

  test('why before any measurement says there is nothing yet', async ($, on) => {
    engine(on)

    expect((await runCommand($, 'why')).text).toContain('Ainda sem medição')
  })

  test('the pane shows the breakdown, limits, thresholds, samples and the compact action', async ($, on) => {
    engine(on, { breakdown: BREAKDOWN, store: { samples: [sample(180_000), sample(210_000)] } })
    const ui = await mountPane($)

    await startSession($)
    await measure($, 120_000, 60, 200_000, { cost: { usd: 2.5 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 3_600_000).toISOString() }] })

    const shown = await screen(ui)

    expect(shown).toContain('Hora de limpar')
    expect(shown).toContain('O que pesa')
    expect(shown).toContain('Base fixa 40k (20%)')
    expect(shown).toContain('Conversa 76k (38%)')
    expect(shown).toMatch(/Mensagens\s+█+░* 76k 38%/)
    expect(shown).toContain('Memory files maiores AGENTS.md 9k, CLAUDE.md 1k')
    expect(shown).toContain('Limites de uso')
    expect(shown).toMatch(/5h\s+█+░* 40% · reinicia em 1h/)
    expect(shown).toContain('custo da sessão $2.50')
    expect(shown).toContain('Limiares')
    expect(shown).toContain('padrão (0 de 5 amostras nesta janela para calibrar)')
    expect(shown).toContain('Histórico')
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  })

  test('the pane before any measurement says so', async ($, on) => {
    engine(on)
    const ui = await mountPane($)

    expect(await screen(ui)).toContain('Ainda sem medição')
  })
})

describe('reviews and probes', () => {
  const read = ($: Engine, path: string) => $.tool.call({ tool: 'Read', file_path: path })

  const storedReview = (tokens: number, verdict: string | null) => ({
    at: NOW - 86_400_000,
    reason: 'clear',
    tokens,
    window: 1_000_000,
    verdict,
    probes: { warned: false, points: 0, reasons: [], errorRecent: null, errorEarlier: null, reread: null }
  })

  test('a clear stores what the mod saw, still without a verdict', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await heavy($, 280_000)
    await bash($, 'git commit -m "x"')
    await heavy($, 310_000)
    await endSession($, 'clear')

    expect(store.reviews).toHaveLength(1)
    expect((store.reviews as { probes: { reasons: string[] } }[])[0]?.probes.reasons[0]).toContain('git commit feito')
    expect(store.reviews).toMatchObject([
      { reason: 'clear', tokens: 310_000, window: 1_000_000, verdict: null, probes: { warned: true, points: 50, reread: null } }
    ])
  })

  test('a clear that the mod had not warned about is stored as not warned', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await heavy($, 100_000)
    await endSession($, 'clear')

    expect(store.reviews).toMatchObject([{ tokens: 100_000, probes: { warned: false, points: 0 } }])
  })

  test('leaving without a clear stores no review', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await heavy($, 310_000)
    await endSession($, 'other')

    expect(store.reviews).toBeUndefined()
  })

  test('a manual compact is reviewed too, an auto-compact is not', async ($, on) => {
    const { store } = engine(on, { compact: () => ({ messages: SUMMARY, tokensBefore: 250_000, tokensAfter: 40_000 }) })

    await startSession($)
    await measure($, 250_000, 25, 1_000_000)
    await $.session.compact(compactEvent('auto'))

    expect(store.reviews).toBeUndefined()

    await $.session.compact(compactEvent('manual'))

    expect(store.reviews).toMatchObject([{ reason: 'compact', tokens: 250_000, verdict: null }])
  })

  test('/forecast rate rates the latest clear, says what to type when the word is wrong, and keeps the other reviews', async ($, on) => {
    const { store } = engine(on, { store: { reviews: [storedReview(200_000, 'cedo')] } })

    await startSession($)
    await heavy($, 300_000)
    await endSession($, 'clear')

    expect((await runCommand($, 'rate')).text).toContain('Use: /forecast rate cedo | certo | tarde')
    expect((await runCommand($, 'rate talvez')).text).toContain('sem avaliação')
    expect((store.reviews as { verdict: string | null }[]).map(r => r.verdict)).toEqual(['cedo', null])

    expect((await runCommand($, 'rate certo')).text).toBe('Avaliação registada: certo, para o clear a 300k (30% da janela), o mod não tinha avisado.')
    expect((store.reviews as { verdict: string | null }[]).map(r => r.verdict)).toEqual(['cedo', 'certo'])
  })

  test('/forecast rate without any clear says there is nothing to rate', async ($, on) => {
    const { store } = engine(on)

    expect((await runCommand($, 'rate certo')).text).toBe('Ainda não há clear nem compact para avaliar.')
    expect(store.reviews).toBeUndefined()
  })

  test('the first turn after a clear asks for the rating, once', async ($, on) => {
    const { calls } = engine(on)

    await startSession($)
    await heavy($, 100_000)
    await endSession($, 'clear')

    await heavy($, 30_000)
    await heavy($, 40_000)

    expect(calls.toasts.filter(text => text.includes('Avalie o clear anterior'))).toHaveLength(1)
  })

  test('a clear rated before the first turn is not asked about', async ($, on) => {
    const { calls } = engine(on)

    await startSession($)
    await heavy($, 100_000)
    await endSession($, 'clear')
    await runCommand($, 'rate certo')
    await heavy($, 30_000)

    expect(calls.toasts.filter(text => text.includes('Avalie o clear anterior'))).toEqual([])
  })

  test('the files read in the first ten turns after a clear are compared with those read before, ignoring STATE.md', async ($, on) => {
    const { store } = engine(on)

    await startSession($)
    await read($, '/repo/src/A.php')
    await read($, '/repo/src/B.php')
    await read($, '/repo/STATE.md')
    await heavy($, 100_000)
    await endSession($, 'clear')

    expect(store.probe).toEqual({ reviewAt: NOW, before: ['/repo/src/A.php', '/repo/src/B.php', '/repo/STATE.md'] })

    await read($, '/repo/src/C.php')
    await read($, '/repo/src/A.php')
    await read($, '/repo/STATE.md')

    for (let i = 1; i <= 9; i += 1) await heavy($, 30_000 + i * 1_000)

    expect((store.reviews as { probes: { reread: number | null } }[])[0]?.probes.reread).toBe(null)
    expect(store.probe).not.toBe(null)

    await heavy($, 50_000)

    expect((store.reviews as { probes: { reread: number | null } }[])[0]?.probes.reread).toBe(0.5)
    expect(store.probe).toBe(null)
  })

  test('a probe left by a previous process resumes when the session starts, and a stale one is dropped', async ($, on) => {
    const { store } = engine(on, { store: { reviews: [{ ...storedReview(300_000, null), at: NOW - 3_600_000 }], probe: { reviewAt: NOW - 3_600_000, before: ['/repo/src/A.php'] } } })

    await startSession($)
    await read($, '/repo/src/A.php')

    for (let i = 1; i <= 10; i += 1) await heavy($, 30_000 + i * 1_000)

    expect((store.reviews as { probes: { reread: number | null } }[])[0]?.probes.reread).toBe(1)
  })

  test('a stale probe is ignored', async ($, on) => {
    const { store } = engine(on, { store: { reviews: [{ ...storedReview(300_000, null), at: NOW - 7 * 3_600_000 }], probe: { reviewAt: NOW - 7 * 3_600_000, before: ['/repo/src/A.php'] } } })

    await startSession($)
    await read($, '/repo/src/A.php')

    for (let i = 1; i <= 10; i += 1) await heavy($, 30_000 + i * 1_000)

    expect((store.reviews as { probes: { reread: number | null } }[])[0]?.probes.reread).toBe(null)
  })

  test('the error rate of the last turns before a clear is stored next to the five turns before them', async ($, on) => {
    const { store } = engine(on)

    await startSession($)

    for (let i = 1; i <= 10; i += 1) {
      await bash($, 'ls')

      if (i > 5) await bash($, 'make FAILS')
      else await bash($, 'ls -la')

      await heavy($, 30_000 + i * 1_000)
    }

    await endSession($, 'clear')

    expect(store.reviews).toMatchObject([{ probes: { errorRecent: 0.5, errorEarlier: 0 } }])
  })

  test('five clears rated certo replace every sample in the calibration, and /forecast why says so', async ($, on) => {
    const stored = [380_000, 400_000, 400_000, 400_000, 420_000].map(tokens => storedReview(tokens, 'certo'))

    engine(on, { store: { reviews: [storedReview(100_000, 'cedo'), ...stored], samples: [100_000, 100_000, 100_000, 100_000, 100_000].map(sample) } })
    const ui = await mountBand($)

    await startSession($)
    await heavy($, 410_000)

    const why = (await runCommand($, 'why')).text ?? ''

    expect(await screen(ui)).toContain('contexto alto 410k (limiar 400k, calibrado)')
    expect(why).toContain('avaliações: 6 de 6')
    expect(why).toContain('- certo: 5, mediana 400k')
    expect(why).toContain('limiares calibrados só com os clears avaliados como certo')
  })

  test('without enough ratings the samples keep calibrating and why explains how that changes', async ($, on) => {
    engine(on, { store: { reviews: [storedReview(300_000, 'certo')], samples: [90_000, 100_000, 100_000, 100_000, 120_000].map(sample) } })

    await startSession($)
    await heavy($, 110_000)

    const why = (await runCommand($, 'why')).text ?? ''

    expect(why).toContain('limiares calibrados (5 amostras nesta janela, p25 100k, p75 100k)')
    expect(why).toContain('com 5 avaliados como certo passam a usar só esses')
  })
})
