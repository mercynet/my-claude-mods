import { describe, expect, test } from 'claude-code/testing'

import type { ClearSample, HistoryEntry, LimitWindow, Review, Signal } from '../types'
import { summarizeBreakdown } from '../hooks/logic/breakdown'
import { buildInstructions, errorText, vetoText } from '../hooks/logic/compact'
import { compactNumber, duration, weatherBand, weatherFor } from '../hooks/logic/format'
import { gaugeSpans, limitColor } from '../hooks/logic/gauge'
import type { Span } from '../hooks/logic/gauge'
import { toTurnPoint, withMarker } from '../hooks/logic/history'
import { updateLimitWindows, projectWindow, windowWarning, autoCompactText } from '../hooks/logic/projection'
import {
  MAX_REVIEWS,
  errorRates,
  makeReview,
  ratedSamples,
  rateLatest,
  readProbe,
  readReviews,
  recordToolStat,
  rereadShare,
  reviewsSummary,
  withRead,
  withReread,
  withReview
} from '../hooks/logic/reviews'
import { assess, explainScore, scoreWarning } from '../hooks/logic/score'
import {
  bashCheckpoints,
  countsTowardLoop,
  nextFailures,
  pestPassed,
  testCommandPattern,
  todoCheckpoint,
  todoCounts,
  withEdit,
  withSignals
} from '../hooks/logic/signals'
import { appendSample, calibrate, defaultThresholds, median, quantile, readSamples } from '../hooks/logic/thresholds'
import { buildView, layoutFor, panelRows } from '../hooks/logic/view'
import type { ReadState } from '../hooks/logic/view'

const turn = (tokens: number, window = 200_000): HistoryEntry => ({
  kind: 'turn',
  tokens,
  window,
  percent: Math.round((tokens / window) * 100)
})

const marker: HistoryEntry = { kind: 'compact', origin: 'manual', before: 300_000 }

const sample = (tokens: number, reason: ClearSample['reason'] = 'clear', window = 1_000_000): ClearSample => ({
  tokens,
  window,
  reason,
  at: 1_700_000_000_000
})

const base = (overrides: Partial<Parameters<typeof assess>[0]> = {}) => ({
  history: [turn(40_000)],
  turns: 1,
  signals: [] as Signal[],
  failures: {},
  edited: [] as string[],
  thresholds: defaultThresholds(),
  ...overrides
})

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)

const plain = (spans: readonly Span[]): string => spans.map(span => span.text).join('')

const emptyState = (overrides: Partial<ReadState> = {}): ReadState => ({
  history: [turn(60_000)],
  turns: 1,
  signals: [],
  failures: {},
  edited: [],
  limits: [],
  cost: null,
  weight: null,
  samples: [],
  compaction: null,
  calibrate: true,
  ...overrides
})

describe('format', () => {
  test('weather bands: each usage range has its symbol, word and color', () => {
    expect(weatherFor(10)).toMatchObject({ word: 'Limpo', color: 'yellow' })
    expect(weatherFor(25)).toMatchObject({ word: 'Nublado', color: 'cyan' })
    expect(weatherFor(50)).toMatchObject({ word: 'Chuva', color: 'blue' })
    expect(weatherFor(75)).toMatchObject({ word: 'Tempestade', color: 'magenta' })
    expect(weatherFor(90)).toMatchObject({ word: 'Compactar agora', color: 'red' })
  })

  test('compact numbers and durations', () => {
    expect(compactNumber(134_000)).toBe('134k')
    expect(compactNumber(1_250_000)).toBe('1.3M')
    expect(duration(72 * 60_000)).toBe('1h12')
    expect(duration(35 * 60_000)).toBe('35min')
    expect(duration(51 * 3_600_000)).toBe('2d3h')
    expect(duration(10_000)).toBe('<1min')
  })
})

describe('calibration', () => {
  test('median of odd and even sets', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(null)
  })

  test('quartiles interpolate between neighbours', () => {
    expect(quantile([100, 200, 300, 400, 500], 0.25)).toBe(200)
    expect(quantile([100, 200, 300, 400], 0.75)).toBe(325)
    expect(quantile([], 0.5)).toBe(null)
  })

  test('with fewer than 5 samples the defaults stand and nothing is marked calibrated', () => {
    const thresholds = calibrate([sample(80_000), sample(90_000), sample(100_000), sample(110_000)], 1_000_000)

    expect(thresholds).toMatchObject({ heavy: 300_000, high: 650_000, calibrated: false, samples: 4 })
  })

  test('with 5 samples heavy is the personal p25 and high the p75, both marked calibrated', () => {
    const thresholds = calibrate([240_000, 530_000, 390_000, 300_000, 450_000].map(n => sample(n)), 1_000_000)

    expect(thresholds).toMatchObject({
      heavy: 300_000,
      high: 450_000,
      heavyPercent: 30,
      highPercent: 45,
      calibrated: true,
      samples: 5,
      quartiles: { p25: 300_000, p75: 450_000 }
    })
  })

  test('the calibrated heavy mark sits at or above the person p25, never at half the median', () => {
    const clears = [240_000, 300_000, 393_000, 450_000, 529_000].map(n => sample(n))
    const thresholds = calibrate(clears, 1_000_000)

    expect(thresholds.heavy).toBe(300_000)
  })

  test('calibration switched off keeps the defaults even with enough samples', () => {
    const samples = [1, 2, 3, 4, 5].map(n => sample(n * 100_000))

    expect(calibrate(samples, 1_000_000, false).calibrated).toBe(false)
  })

  test('the calibrated thresholds never drop below the floors, as shares of the window', () => {
    const thresholds = calibrate([12_000, 12_000, 12_000, 12_000, 12_000].map(n => sample(n)), 1_000_000)

    expect(thresholds.high).toBe(300_000)
    expect(thresholds.heavy).toBe(200_000)
  })

  test('samples from a 1M window do not calibrate a 200k window', () => {
    const fromBigWindow = [380_000, 420_000, 400_000, 390_000, 410_000].map(n => sample(n))
    const small = calibrate(fromBigWindow, 200_000)

    expect(small).toMatchObject({ calibrated: false, samples: 0, heavyPercent: 50, highPercent: 75 })
  })

  test('a 200k window calibrates from its own clears, in its own scale', () => {
    const clears = [120_000, 130_000, 140_000, 150_000, 160_000].map(n => sample(n, 'clear', 200_000))
    const mixed = [...clears, ...[400_000, 420_000].map(n => sample(n))]
    const thresholds = calibrate(mixed, 200_000)

    expect(thresholds).toMatchObject({ heavy: 130_000, high: 150_000, heavyPercent: 65, highPercent: 75, samples: 5 })
  })

  test('a late habit on a small window is capped below the full window', () => {
    const clears = [195_000, 196_000, 197_000, 198_000, 199_000].map(n => sample(n, 'clear', 200_000))
    const thresholds = calibrate(clears, 200_000)

    expect(thresholds.high).toBe(180_000)
    expect(thresholds.heavy).toBeLessThanOrEqual(thresholds.high)
  })

  test('only the last 30 samples count and tiny contexts are not recorded', () => {
    const many = Array.from({ length: 35 }, (_, i) => sample(100_000 + i))
    const recorded = appendSample(many, sample(150_000))

    expect(recorded).toHaveLength(30)
    expect(appendSample([], sample(5_000))).toEqual([])
  })

  test('stored samples are read defensively', () => {
    expect(readSamples('nope')).toEqual([])
    expect(readSamples([{ tokens: 1 }, null, sample(50_000)])).toEqual([sample(50_000)])
  })
})

describe('score', () => {
  test('a light context with nothing happening has no reasons and no warning', () => {
    const assessment = assess(base())

    expect(assessment).toMatchObject({ points: 0, level: 'none', reasons: [] })
    expect(scoreWarning(assessment)).toBe(null)
  })

  test('size alone: heavy is below the warning line, high crosses it', () => {
    expect(assess(base({ history: [turn(310_000, 1_000_000)] })).level).toBe('none')

    const high = assess(base({ history: [turn(660_000, 1_000_000)] }))

    expect(high.level).toBe('attention')
    expect(high.reasons[0]).toMatchObject({ code: 'size', points: 40 })
  })

  test('window nearly full is urgent on its own', () => {
    expect(assess(base({ history: [turn(185_000)] })).level).toBe('now')
  })

  test('commit on a light context is no reason to clear, on a heavy one it is', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }

    expect(assess(base({ signals: [commit] })).level).toBe('none')

    const heavy = assess(base({ history: [turn(310_000, 1_000_000)], signals: [commit] }))

    expect(heavy).toMatchObject({ points: 50, level: 'attention' })
    expect(scoreWarning(heavy)?.text).toContain('bom momento para /clear')
    expect(scoreWarning(heavy)?.text).toBe('bom momento para /clear: git commit feito, contexto pesado 310k (limiar 300k)')
  })

  test('below the heavy mark no finished task counts, however many there are', () => {
    const signals: Signal[] = [
      { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 },
      { turn: 1, kind: 'push', label: 'git push feito', points: 40 },
      { turn: 1, kind: 'todos', label: 'lista de tarefas concluída', points: 20 }
    ]
    const assessment = assess(base({ history: [turn(160_000, 1_000_000)], signals }))

    expect(assessment).toMatchObject({ points: 0, level: 'none', reasons: [] })
  })

  test('the heavy mark is the lower of the absolute threshold and the share of the window', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }

    expect(assess(base({ history: [turn(100_000)], signals: [commit] })).points).toBe(50)
    expect(assess(base({ history: [turn(90_000)], signals: [commit] })).points).toBe(0)
  })

  test('a STATE handoff commit is a strong checkpoint even on a light context', () => {
    const handoff: Signal = { turn: 1, kind: 'state-handoff', label: 'commit STATE handoff', points: 50 }

    expect(assess(base({ signals: [handoff] })).level).toBe('attention')
  })

  test('a checkpoint only counts in the turn it happened in', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }

    expect(assess(base({ history: [turn(310_000, 1_000_000)], turns: 2, signals: [commit] })).points).toBe(20)
  })

  test('checkpoints are capped so many of them cannot hide the other reasons', () => {
    const signals: Signal[] = [
      { turn: 1, kind: 'state-handoff', label: 'a', points: 50 },
      { turn: 1, kind: 'pr', label: 'b', points: 35 },
      { turn: 1, kind: 'push', label: 'c', points: 40 }
    ]
    const checkpoints = assess(base({ history: [turn(310_000, 1_000_000)], signals })).reasons.filter(r => r.code === 'checkpoint')

    expect(checkpoints.reduce((sum, r) => sum + r.points, 0)).toBe(60)
  })

  test('a commit plus a push on a heavy context is a good moment, not an alarm', () => {
    const signals: Signal[] = [
      { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 },
      { turn: 1, kind: 'push', label: 'git push feito', points: 40 }
    ]
    const assessment = assess(base({ history: [turn(353_000, 1_000_000)], signals }))
    const warning = scoreWarning(assessment)

    expect(assessment).toMatchObject({ points: 80, level: 'attention' })
    expect(warning?.color).toBe('green')
    expect(warning?.text).toBe('bom momento para /clear: git push feito, contexto pesado 353k (limiar 300k)')
  })

  test('the same checkpoints past the high mark are urgent', () => {
    const signals: Signal[] = [{ turn: 1, kind: 'push', label: 'git push feito', points: 40 }]
    const assessment = assess(base({ history: [turn(660_000, 1_000_000)], signals }))

    expect(assessment).toMatchObject({ points: 80, level: 'now' })
    expect(scoreWarning(assessment)).toMatchObject({ color: 'red', text: 'limpe ou compacte agora: contexto alto 660k (limiar 650k), git push feito' })
  })

  test('a loop with a checkpoint is urgent whatever the size', () => {
    let failures: Record<string, number> = {}

    for (let i = 0; i < 4; i += 1) failures = nextFailures(failures, 'Bash', true)

    const signals: Signal[] = [{ turn: 1, kind: 'state-handoff', label: 'commit STATE handoff', points: 50 }]

    expect(assess(base({ failures, signals })).level).toBe('now')
  })

  test('the explanation says why 70 points are not urgent without pressure', () => {
    const signals: Signal[] = [
      { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 },
      { turn: 1, kind: 'push', label: 'git push feito', points: 40 }
    ]
    const lines = explainScore(assess(base({ history: [turn(353_000, 1_000_000)], signals })))

    expect(lines[0]).toBe('Score 80/100 (aviso; urgente só com contexto alto ou loop).')
  })

  test('a turn that adds a lot of context is no reason to clear on its own', () => {
    const assessment = assess(base({ history: [turn(40_000, 1_000_000), turn(220_000, 1_000_000)] }))

    expect(assessment).toMatchObject({ points: 0, level: 'none', reasons: [] })
  })

  test('the same tool failing repeatedly is a loop, a success of that tool resets the count', () => {
    let failures: Record<string, number> = {}

    for (let i = 0; i < 4; i += 1) failures = nextFailures(failures, 'Bash', true)

    failures = nextFailures(failures, 'Read', false)

    const loop = assess(base({ failures }))

    expect(loop.level).toBe('attention')
    expect(loop.reasons[0]?.text).toBe('Bash falhou 4x seguidas')
    expect(scoreWarning(loop)?.text).toContain('possível loop')
    expect(nextFailures(failures, 'Bash', false)).toEqual({})
  })

  test('failures of different tools do not add up', () => {
    let failures: Record<string, number> = {}

    for (const tool of ['Bash', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit']) failures = nextFailures(failures, tool, true)

    expect(assess(base({ failures })).level).toBe('none')
  })

  test('the same file edited many times is a loop signal', () => {
    let edited: string[] = []
    let touched: string[] = []

    for (let i = 0; i < 5; i += 1) ({ edited, touched } = withEdit(edited, touched, '/repo/src/Invoice.php'))

    const assessment = assess(base({ edited }))

    expect(assessment.reasons[0]).toMatchObject({ code: 'loop', text: 'src/Invoice.php editado 5x', points: 25 })
    expect(touched).toEqual(['/repo/src/Invoice.php'])
  })

  test('an edit only counts toward the loop while something is failing, and never for documents', () => {
    expect(countsTowardLoop('/repo/src/Invoice.php', true)).toBe(true)
    expect(countsTowardLoop('/repo/src/Invoice.php', false)).toBe(false)
    expect(countsTowardLoop('/repo/notes/x/STATE.md', true)).toBe(false)
    expect(countsTowardLoop('/repo/notes.TXT', true)).toBe(false)
    expect(countsTowardLoop('/repo/docs/guide.mdx', true)).toBe(false)
  })

  test('a topic change adds points only in its own turn', () => {
    const topic: Signal = { turn: 1, kind: 'topic', label: 'mudança de assunto', points: 25 }

    expect(assess(base({ history: [turn(310_000, 1_000_000)], signals: [topic] })).points).toBe(45)
    expect(assess(base({ history: [turn(310_000, 1_000_000)], turns: 2, signals: [topic] })).points).toBe(20)
  })

  test('the calibrated threshold is named in the reason', () => {
    const thresholds = calibrate([400_000, 400_000, 400_000, 400_000, 400_000].map(n => sample(n)), 1_000_000)
    const assessment = assess(base({ history: [turn(410_000, 1_000_000)], thresholds }))

    expect(assessment.reasons[0]?.text).toBe('contexto alto 410k (limiar 400k, calibrado)')
  })

  test('the explanation lists every reason with its points and where the thresholds come from', () => {
    const lines = explainScore(assess(base({ history: [turn(310_000, 1_000_000)], signals: [{ turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }] })))

    expect(lines[0]).toContain('Score 50/100')
    expect(lines).toContain('- git commit feito: +30')
    expect(lines).toContain('- contexto pesado 310k (limiar 300k): +20')
    expect(lines.at(-1)).toContain('limiares padrão')
  })
})

describe('signals', () => {
  const ok = { isError: false, text: undefined, git: undefined }

  test('git commit, push and pull request commands are checkpoints', () => {
    expect(bashCheckpoints('git commit -m "x"', ok).map(s => s.kind)).toEqual(['commit'])
    expect(bashCheckpoints('git commit -m "x" && git push', ok).map(s => s.kind)).toEqual(['commit', 'push'])
    expect(bashCheckpoints('gh pr create --fill', ok).map(s => s.label)).toEqual(['PR criado'])
    expect(bashCheckpoints('gh pr merge 12', ok).map(s => s.label)).toEqual(['PR mesclado'])
  })

  test('a STATE handoff commit is the strong checkpoint', () => {
    const [signal] = bashCheckpoints('git commit -m "docs(e2): STATE handoff for card 2481"', ok)

    expect(signal).toMatchObject({ kind: 'state-handoff', points: 50 })
  })

  test('a failed command is no checkpoint', () => {
    expect(bashCheckpoints('git commit -m "x"', { ...ok, isError: true })).toEqual([])
  })

  test('the engine report of a git operation counts even when the command text was indirect', () => {
    expect(bashCheckpoints('./release.sh', { ...ok, git: { commit: { sha: 'abc' }, push: { branch: 'main' } } }).map(s => s.kind)).toEqual([
      'commit',
      'push'
    ])
  })

  test('a green run of a known test runner is a checkpoint, a red or unknown one is not', () => {
    const green = { ...ok, text: 'Tests:    12 passed (30 assertions)' }
    const runs = [
      'vendor/bin/pest --filter Foo',
      './vendor/bin/phpunit tests/Unit',
      'cd app && pytest -q',
      'python3 -m pytest tests',
      'npm test',
      'pnpm run test',
      'npx jest --ci',
      'yarn vitest run',
      'go test ./...',
      'cargo test --lib'
    ]

    for (const command of runs) expect(bashCheckpoints(command, green).map(s => s.kind)).toEqual(['pest'])

    expect(bashCheckpoints('vendor/bin/pest', { ...ok, text: 'Tests:    1 failed, 11 passed' })).toEqual([])
    expect(bashCheckpoints('vendor/bin/pest', { ...ok, text: '⨯ it does a thing' })).toEqual([])
    expect(bashCheckpoints('go test ./...', { ...ok, text: 'FAIL\texample.com/pkg\t0.1s' })).toEqual([])
    expect(bashCheckpoints('ls', green)).toEqual([])
  })

  test('naming a runner is not running it', () => {
    const green = { ...ok, text: 'Tests:    12 passed (30 assertions)' }

    for (const command of ['pip install pytest', 'echo go test', 'npm install jest', 'git log --grep=cargo']) {
      expect(bashCheckpoints(command, green)).toEqual([])
    }
  })

  test('an extra test pattern adds a runner, and an empty or invalid one changes nothing', () => {
    const green = { ...ok, text: 'Tests:    12 passed (30 assertions)' }
    const custom = './bin/run-suite --fast'

    expect(bashCheckpoints(custom, green)).toEqual([])
    expect(bashCheckpoints(custom, green, testCommandPattern('\\brun-suite\\b')).map(s => s.kind)).toEqual(['pest'])
    expect(bashCheckpoints(custom, green, testCommandPattern('   '))).toEqual([])
    expect(bashCheckpoints(custom, green, testCommandPattern('run-suite('))).toEqual([])
    expect(bashCheckpoints('pytest -q', green, testCommandPattern('run-suite('))).toHaveLength(1)
  })

  test('pest output without a summary line is judged by its failure markers', () => {
    expect(pestPassed(undefined)).toBe(true)
    expect(pestPassed('all good')).toBe(true)
    expect(pestPassed('FAILED  Tests\\Unit\\X')).toBe(false)
  })

  test('todo lists: all done is a strong signal, one more done a weak one, no progress none', () => {
    const list = (...statuses: string[]) => statuses.map(status => ({ status }))
    const done = todoCounts({ oldTodos: list('pending', 'completed'), newTodos: list('completed', 'completed') })
    const partial = todoCounts({ oldTodos: list('pending', 'pending'), newTodos: list('completed', 'pending') })
    const none = todoCounts({ oldTodos: list('pending'), newTodos: list('pending') })

    expect(todoCheckpoint(done)?.kind).toBe('todos')
    expect(todoCheckpoint(partial)?.kind).toBe('task')
    expect(todoCheckpoint(none)).toBe(null)
    expect(todoCounts('nope')).toBe(null)
  })

  test('one signal per kind per turn', () => {
    const drafts = [{ kind: 'commit' as const, label: 'git commit feito', points: 30 }]
    const once = withSignals([], 3, drafts)

    expect(withSignals(once, 3, drafts)).toHaveLength(1)
    expect(withSignals(once, 4, drafts)).toHaveLength(2)
  })
})

describe('limits', () => {
  const resetsAt = new Date(NOW + 72 * 60_000).toISOString()

  test('an empty list of limits clears the windows instead of breaking', () => {
    const before = updateLimitWindows([], [{ kind: 'five_hour', percentUsed: 30, resetsAt }], NOW)

    expect(updateLimitWindows(before, [], NOW)).toEqual([])
  })

  test('samples accumulate inside one window and restart when the window resets', () => {
    const first = updateLimitWindows([], [{ kind: 'five_hour', percentUsed: 30, resetsAt }], NOW)
    const second = updateLimitWindows(first, [{ kind: 'five_hour', percentUsed: 40, resetsAt }], NOW + 600_000)
    const reset = updateLimitWindows(second, [{ kind: 'five_hour', percentUsed: 2, resetsAt: new Date(NOW + 6 * 3_600_000).toISOString() }], NOW + 700_000)

    expect(second[0]?.samples).toHaveLength(2)
    expect(reset[0]?.samples).toHaveLength(1)
  })

  test('projection by pace: exhausts before the reset when the pace is too high', () => {
    const window: LimitWindow = {
      kind: 'five_hour',
      percentUsed: 80,
      resetsAt,
      samples: [
        { at: NOW - 1_800_000, percent: 50 },
        { at: NOW, percent: 80 }
      ]
    }
    const projection = projectWindow(window, NOW)

    expect(projection.exhaustsFirst).toBe(true)
    expect(Math.round((projection.exhaustsInMs ?? 0) / 60_000)).toBe(20)
    expect(windowWarning(window, NOW)?.text).toBe('janela de 5h em 80% · reinicia em 1h12 · no ritmo atual esgota em ~20min')
  })

  test('a single reading has no pace, so only the percentage can warn', () => {
    const window: LimitWindow = { kind: 'five_hour', percentUsed: 60, resetsAt, samples: [{ at: NOW, percent: 60 }] }

    expect(projectWindow(window, NOW).exhaustsInMs).toBe(null)
    expect(windowWarning(window, NOW)).toBe(null)
    expect(windowWarning({ ...window, percentUsed: 92 }, NOW)?.color).toBe('red')
  })

  test('a window with no reset time still reports its percentage', () => {
    const window: LimitWindow = { kind: 'seven_day', percentUsed: 85, resetsAt: null, samples: [] }

    expect(windowWarning(window, NOW)?.text).toBe('janela de 7d em 85%')
  })
})

describe('breakdown', () => {
  const breakdown = {
    categories: [
      { name: 'System prompt', tokens: 8_000, kind: 'used' },
      { name: 'System tools', tokens: 14_000, kind: 'used' },
      { name: 'MCP tools', tokens: 6_000, kind: 'used' },
      { name: 'Memory files', tokens: 12_000, kind: 'used' },
      { name: 'Messages', tokens: 76_000, kind: 'used' },
      { name: 'Free space', tokens: 70_000, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'Deferred tools', tokens: 9_000, kind: 'deferred' }
    ],
    memoryFiles: [
      { path: '/repo/CLAUDE.md', tokens: 1_000 },
      { path: '/repo/AGENTS.md', tokens: 9_000 }
    ],
    autoCompactThreshold: 167_000
  }

  test('separates the fixed baseline from the growth of the conversation and ignores free space', () => {
    const weight = summarizeBreakdown(breakdown, 'summary')

    expect(weight).toMatchObject({ base: 40_000, conversation: 76_000, autoCompactAt: 167_000, detail: 'summary' })
    expect(weight.rows.map(r => r.key)).toEqual(['messages', 'tools', 'memory', 'system'])
    expect(weight.rows.map(r => r.label)).toEqual(['Mensagens', 'Tools/MCP', 'Memory files', 'System prompt'])
  })

  test('an empty breakdown has no rows and no auto-compact threshold', () => {
    const weight = summarizeBreakdown({ categories: [], memoryFiles: [] }, 'summary')

    expect(weight.rows).toEqual([])
    expect(weight.autoCompactAt).toBe(null)
  })

  test('the auto-compact warning appears close to the threshold and says the gate covers only the manual one', () => {
    const history = [turn(100_000), turn(130_000), turn(150_000)]

    expect(autoCompactText(150_000, 167_000, history)).toContain('faça /compact manual antes')
    expect(autoCompactText(60_000, 167_000, [turn(50_000), turn(60_000)])).toBe(null)
    expect(autoCompactText(150_000, null, history)).toBe(null)
  })
})

describe('weather band', () => {
  const defaults = defaultThresholds()

  test('on a 1M window the absolute thresholds raise the band that the percentage would call "Limpo"', () => {
    expect(weatherFor(14).word).toBe('Limpo')
    expect(weatherBand(140_000, 14, defaults).word).toBe('Limpo')
    expect(weatherBand(160_000, 16, defaults).word).toBe('Nublado')
    expect(weatherBand(300_000, 30, defaults).word).toBe('Chuva')
    expect(weatherBand(650_000, 65, defaults).word).toBe('Tempestade')
    expect(weatherBand(50_000, 5, defaults).word).toBe('Limpo')
  })

  test('the worse of the two bands wins: a 200k window at 80% stays "Tempestade"', () => {
    expect(weatherBand(160_000, 80, defaults).word).toBe('Tempestade')
    expect(weatherBand(185_000, 92, defaults).word).toBe('Compactar agora')
  })

  test('calibrated thresholds move the absolute bands', () => {
    const calibrated = calibrate([200_000, 200_000, 300_000, 400_000, 400_000].map(n => sample(n)), 1_000_000)

    expect(calibrated).toMatchObject({ heavy: 200_000, high: 400_000 })
    expect(weatherBand(210_000, 21, calibrated).word).toBe('Chuva')
    expect(weatherBand(400_000, 40, calibrated).word).toBe('Tempestade')
  })
})

describe('gauge', () => {
  test('a fixed-width gauge fills from the left and puts a mark where each threshold begins', () => {
    const spans = gaugeSpans(0.135, 16, 'cyan', [
      { at: 0.15, color: 'yellow' },
      { at: 0.3, color: 'red' }
    ])

    expect(plain(spans)).toBe('██│░│░░░░░░░░░░░')
    expect(spans.filter(span => span.text === '│').map(span => span.color)).toEqual(['yellow', 'red'])
    expect(spans[0]).toMatchObject({ text: '██', color: 'cyan' })
  })

  test('a mark at or past the end of the scale is left out, and a tiny usage still shows one cell', () => {
    expect(plain(gaugeSpans(0.01, 8, 'cyan', [{ at: 1.5, color: 'red' }]))).toBe('█░░░░░░░')
    expect(plain(gaugeSpans(0, 8, 'cyan'))).toBe('░░░░░░░░')
    expect(plain(gaugeSpans(1.4, 8, 'cyan'))).toBe('████████')
  })

  test('the limit gauges turn from green to yellow to red with the percentage', () => {
    expect(limitColor(30)).toBe('green')
    expect(limitColor(60)).toBe('yellow')
    expect(limitColor(85)).toBe('red')
  })
})

describe('layout', () => {
  test('the gauge is the only thing a narrow terminal takes away from the band', () => {
    expect(layoutFor(120)).toEqual({ gauge: true })
    expect(layoutFor(50)).toEqual({ gauge: true })
    expect(layoutFor(49)).toEqual({ gauge: false })
  })
})

describe('view', () => {
  const resetsAt = new Date(NOW + 72 * 60_000).toISOString()
  const limits: LimitWindow[] = [
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString(), samples: [] },
    { kind: 'five_hour', percentUsed: 34, resetsAt, samples: [] }
  ]
  const weight = summarizeBreakdown(
    {
      categories: [
        { name: 'System prompt', tokens: 8_000, kind: 'used' },
        { name: 'MCP tools', tokens: 20_000, kind: 'used' },
        { name: 'Memory files', tokens: 12_000, kind: 'used' },
        { name: 'Messages', tokens: 72_000, kind: 'used' }
      ],
      memoryFiles: [{ path: '/repo/AGENTS.md', tokens: 9_000 }]
    },
    'summary'
  )
  const headline = (state: ReadState, columns = 120) => plain(buildView(state, NOW, columns)?.headline ?? [])

  test('no turn measured yet gives no view', () => {
    expect(buildView(emptyState({ history: [] }), NOW)).toBe(null)
  })

  test('calm: one line with the weather, a 12-cell gauge with a single mark at heavy, the percentage and the tokens', () => {
    const state = emptyState({ history: [turn(160_000, 1_000_000)] })
    const view = buildView(state, NOW)

    expect(headline(state)).toBe('☁ Nublado ██░│░░░░░░░░ 16% · 160k/1M')
    expect(view?.weather.word).toBe('Nublado')
    expect(view?.headline[0]).toMatchObject({ color: 'cyan', bold: true })
    expect(view?.note).toBe(null)
  })

  test('the band never carries the delta, a sparkline, the breakdown, the limits or the cost', () => {
    const history = [turn(100_000, 1_000_000), turn(130_000, 1_000_000), turn(160_000, 1_000_000)]
    const state = emptyState({ history, weight, limits, cost: 4.2 })
    const text = headline(state)

    expect(text).toBe('☁ Nublado ██░│░░░░░░░░ 16% · 160k/1M')
    expect(buildView(state, NOW)?.note).toBe(null)
  })

  test('on a narrow terminal only the gauge goes away', () => {
    const state = emptyState({ history: [turn(160_000, 1_000_000)] })

    expect(headline(state, 49)).toBe('☁ Nublado 16% · 160k/1M')
    expect(headline(state, 40)).toBe('☁ Nublado 16% · 160k/1M')
    expect(headline(state, 50)).toContain('██░│')
  })

  test('the second line exists only with a reason: a score warning, a window about to end or an auto-compact close by', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }
    const scoreView = buildView(emptyState({ history: [turn(310_000, 1_000_000)], signals: [commit] }), NOW)
    const tight: LimitWindow = { kind: 'five_hour', percentUsed: 92, resetsAt, samples: [] }
    const windowView = buildView(emptyState({ limits: [tight] }), NOW)
    const history = [turn(100_000, 1_000_000), turn(130_000, 1_000_000), turn(155_000, 1_000_000)]
    const autoView = buildView(emptyState({ history, turns: 3, weight: { ...weight, autoCompactAt: 167_000 } }), NOW)

    expect(scoreView?.note).toEqual({
      text: 'bom momento para /clear: git commit feito, contexto pesado 310k (limiar 300k)',
      color: 'green',
      hasButton: true
    })
    expect(windowView?.note?.text).toBe('janela de 5h em 92% · reinicia em 1h12')
    expect(autoView?.note?.text).toContain('auto-compact perto')
    expect(buildView(emptyState({ limits, cost: 4.2, weight }), NOW)?.note).toBe(null)
  })

  test('the second line is one sentence: the first reason wins and the others are counted', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }
    const tight: LimitWindow = { kind: 'five_hour', percentUsed: 92, resetsAt, samples: [] }
    const view = buildView(emptyState({ history: [turn(310_000, 1_000_000)], signals: [commit], limits: [tight] }), NOW)

    expect(view?.note?.text).toBe('bom momento para /clear: git commit feito, contexto pesado 310k (limiar 300k) (+1)')
    expect(view?.warnings.map(w => w.source)).toEqual(['score', 'window'])
  })

  test('the turns-until-high projection stays out of the band and in the explanation', () => {
    const history = [500_000, 530_000, 560_000, 590_000].map(n => turn(n, 1_000_000))
    const view = buildView(emptyState({ history, turns: 4 }), NOW)

    expect(view?.warnings.find(w => w.source === 'projection')?.text).toBe('~2 turnos até 650k')
    expect(view?.note).toBe(null)
  })

  test('the feedback on the person\'s own compact takes the second line, with the button only while there is a reason', () => {
    const commit: Signal = { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 }
    const compaction = { state: 'vetoed' as const, text: 'compactação vetada: STATE.md em falta', at: NOW }
    const withReason = buildView(emptyState({ history: [turn(310_000, 1_000_000)], signals: [commit], compaction }), NOW)
    const calm = buildView(emptyState({ compaction: { ...compaction, state: 'done', text: 'compactado: 160k -> 30k' } }), NOW)
    const stale = buildView(emptyState({ compaction: { ...compaction, at: NOW - 11 * 60_000 } }), NOW)

    expect(withReason?.note).toEqual({ text: 'compactação vetada: STATE.md em falta', color: 'yellow', hasButton: true })
    expect(calm?.note).toEqual({ text: 'compactado: 160k -> 30k', color: 'green', hasButton: false })
    expect(stale?.note).toBe(null)
  })

  test('two reports of the same compaction merge into one marker', () => {
    const once = withMarker([turn(300_000)], { kind: 'compact', origin: 'manual', before: null })
    const twice = withMarker(once, { kind: 'compact', origin: 'auto', before: 300_000 })

    expect(twice.filter(e => e.kind === 'compact')).toEqual([{ kind: 'compact', origin: 'auto', before: 300_000 }])
  })

  test('the panel has the score gauge with reasons by points, bars per category, limits with mini gauges, a history chart and the samples', () => {
    const state = emptyState({
      history: [turn(100_000, 1_000_000), marker, turn(130_000, 1_000_000), turn(310_000, 1_000_000)],
      turns: 3,
      signals: [{ turn: 3, kind: 'commit', label: 'git commit feito', points: 30 }],
      weight,
      limits: [{ ...limits[1]!, percentUsed: 92 }],
      cost: 4.2133,
      samples: [sample(180_000, 'clear'), sample(210_000, 'compact')],
      compaction: { state: 'vetoed', text: 'compactação vetada: STATE.md em falta', at: NOW }
    })
    const view = buildView(state, NOW, 100)
    const rows = view ? panelRows(view, state, NOW, 100) : []
    const text = rows.map(plain).join('\n')

    expect(text).toContain('Hora de limpar  ')
    expect(text).toContain('50/100')
    expect(text.indexOf('git commit feito')).toBeLessThan(text.indexOf('contexto pesado'))
    expect(text).toContain('Base fixa 40k (4%) + Conversa 72k (7%)')
    expect(text).toMatch(/Mensagens\s+█+░* 72k 7%/)
    expect(text).toContain('Memory files maiores AGENTS.md 9k')
    expect(text).toMatch(/5h\s+█+░+ 92% · reinicia em 1h12/)
    expect(text).toContain('custo da sessão $4.21')
    expect(text).toContain('padrão (2 de 5 amostras nesta janela para calibrar)')
    expect(text).toMatch(/#3\s+█+.*310k 31%/)
    expect(text).toContain('↓ compact manual a partir de 300k')
    expect(text).toContain('compactação vetada: STATE.md em falta')
    expect(rows.flat().find(span => span.text === ' 92%')?.color).toBe('red')
  })

  test('without limits or cost the panel says so', () => {
    const state = emptyState()
    const view = buildView(state, NOW)
    const text = (view ? panelRows(view, state, NOW, 100) : []).map(plain).join('\n')

    expect(text).toContain('sem leitura')
    expect(text).toContain('custo: indisponível')
  })

  test('a measured context converts to a turn point and an unmeasured one does not', () => {
    expect(toTurnPoint({ tokens: 36_000, window: 200_000 })).toEqual({ kind: 'turn', tokens: 36_000, window: 200_000, percent: 18 })
    expect(toTurnPoint({ window: 200_000 })).toBe(null)
  })
})

describe('compact', () => {
  test('the instructions keep plan, card, branch and the touched files', () => {
    const text = buildInstructions(['/repo/a.php', '/repo/b.php'])

    expect(text).toContain('plano')
    expect(text).toContain('card')
    expect(text).toContain('branch')
    expect(text).toContain('/repo/a.php, /repo/b.php')
  })

  test('only the last 15 touched files are named', () => {
    const files = Array.from({ length: 20 }, (_, i) => `/repo/f${i}.php`)
    const text = buildInstructions(files)

    expect(text).not.toContain('/repo/f4.php')
    expect(text).toContain('/repo/f19.php')
  })

  test('a veto shows its reason and hints at STATE.md when that is the reason', () => {
    expect(vetoText('Update STATE.md before /compact')).toBe('compactação vetada: Update STATE.md before /compact Atualize o STATE.md e tente de novo.')
    expect(vetoText('other')).toBe('compactação vetada: other')
  })

  test('a rejection says why and hints when a turn is running', () => {
    expect(errorText(new Error('cannot compact while a turn is running'))).toContain('só dá para compactar entre turnos')
    expect(errorText('boom')).toBe('não foi possível compactar: boom')
  })
})

describe('reviews', () => {
  const review = (overrides: Partial<Review> = {}): Review => ({
    at: NOW,
    reason: 'clear',
    tokens: 400_000,
    window: 1_000_000,
    verdict: null,
    probes: { warned: false, points: 0, reasons: [], errorRecent: null, errorEarlier: null, reread: null },
    ...overrides
  })

  test('tool calls are counted per turn and only the last ten turns are kept', () => {
    let stats = recordToolStat([], 1, false)

    stats = recordToolStat(stats, 1, true)
    stats = recordToolStat(stats, 2, false)

    expect(stats).toEqual([
      { turn: 1, calls: 2, errors: 1 },
      { turn: 2, calls: 1, errors: 0 }
    ])

    for (let turn = 3; turn <= 14; turn += 1) stats = recordToolStat(stats, turn, false)

    expect(stats).toHaveLength(10)
    expect(stats[0]?.turn).toBe(5)
  })

  test('the error rate of the last five turns is read against the five before, and needs ten calls to mean anything', () => {
    const stats = Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, calls: 2, errors: i >= 5 ? 1 : 0 }))

    expect(errorRates(stats, 10)).toEqual({ recent: 0.5, earlier: 0 })
    expect(errorRates([{ turn: 10, calls: 4, errors: 4 }], 10)).toEqual({ recent: null, earlier: null })
  })

  test('reads keep the latest position of a file and at most 60 files', () => {
    expect(withRead(['/a', '/b'], '/a')).toEqual(['/b', '/a'])

    const many = Array.from({ length: 70 }, (_, i) => `/f${i}`).reduce<string[]>((reads, path) => withRead(reads, path), [])

    expect(many).toHaveLength(60)
    expect(many.at(-1)).toBe('/f69')
  })

  test('re-reading is the share of files read again, never counting instructions and handoff files', () => {
    const before = ['/repo/src/A.php', '/repo/src/B.php', '/repo/STATE.md']

    expect(rereadShare(before, ['/repo/src/C.php', '/repo/src/A.php', '/repo/STATE.md', '/repo/CLAUDE.md'])).toBe(0.5)
    expect(rereadShare(before, ['/repo/STATE.md', '/srv/u/.claude/projects/x/memory/note.md'])).toBe(null)
    expect(rereadShare(before, [])).toBe(null)
  })

  test('a review keeps what the mod saw: whether it warned, the points, three reasons and the error rates', () => {
    const assessment = assess(
      base({
        history: [turn(310_000, 1_000_000)],
        signals: [
          { turn: 1, kind: 'commit', label: 'git commit feito', points: 30 },
          { turn: 1, kind: 'todos', label: 'lista de tarefas concluída', points: 20 }
        ]
      })
    )
    const stats = Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, calls: 2, errors: i >= 5 ? 1 : 0 }))
    const made = makeReview({ at: NOW, reason: 'clear', tokens: 310_000, window: 1_000_000, assessment, stats, turns: 10 })

    expect(made).toMatchObject({ at: NOW, reason: 'clear', tokens: 310_000, window: 1_000_000, verdict: null })
    expect(made.probes).toMatchObject({ warned: true, points: 70, errorRecent: 0.5, errorEarlier: 0, reread: null })
    expect(made.probes.reasons).toHaveLength(3)
    expect(made.probes.reasons[0]).toBe('git commit feito')
  })

  test('a quiet context is stored as not warned', () => {
    const made = makeReview({ at: NOW, reason: 'compact', tokens: 90_000, window: 1_000_000, assessment: assess(base()), stats: [], turns: 1 })

    expect(made.probes).toMatchObject({ warned: false, points: 0, reasons: [], errorRecent: null })
  })

  test('only the last 60 reviews are kept and the re-reading lands on the review it belongs to', () => {
    const many = Array.from({ length: 65 }, (_, i) => review({ at: i }))
    const kept = many.reduce<Review[]>((all, r) => withReview(all, r), [])

    expect(kept).toHaveLength(MAX_REVIEWS)
    expect(kept[0]?.at).toBe(5)

    const settled = withReread([review({ at: 1 }), review({ at: 2 })], 2, 0.25)

    expect(settled.map(r => r.probes.reread)).toEqual([null, 0.25])
  })

  test('rating changes only the latest review, and an unknown word changes nothing and says what to type', () => {
    const first = review({ at: 1, verdict: 'cedo' })
    const second = review({ at: 2 })

    expect(rateLatest([], 'certo')).toEqual({ reviews: [], text: 'Ainda não há clear nem compact para avaliar.' })

    const invalid = rateLatest([first, second], 'talvez')

    expect(invalid.reviews).toEqual([first, second])
    expect(invalid.text).toContain('sem avaliação')
    expect(invalid.text).toContain('Use: /forecast rate cedo | certo | tarde')

    const valid = rateLatest([first, second], ' Certo ')

    expect(valid.reviews.map(r => r.verdict)).toEqual(['cedo', 'certo'])
    expect(valid.text).toBe('Avaliação registada: certo, para o clear a 400k (40% da janela), o mod não tinha avisado.')
  })

  test('with fewer than 5 clears rated "certo" every sample calibrates, with 5 only those do', () => {
    const everything = [sample(100_000), sample(110_000)]
    const right = (tokens: number) => review({ tokens, verdict: 'certo' })
    const four = [380_000, 400_000, 400_000, 420_000].map(right)

    expect(ratedSamples(everything, four)).toEqual(everything)

    const five = [...four, right(400_000), review({ tokens: 120_000, verdict: 'cedo' }), review({ tokens: 900_000, verdict: 'tarde' })]
    const used = ratedSamples(everything, five)

    expect(used.map(u => u.tokens)).toEqual([380_000, 400_000, 400_000, 420_000, 400_000])
    expect(calibrate(used, 1_000_000)).toMatchObject({ high: 400_000, calibrated: true })
  })

  test('the summary counts each verdict with its median size and how often the mod had warned', () => {
    const lines = reviewsSummary([
      review({ tokens: 200_000, verdict: 'cedo' }),
      review({ tokens: 380_000, verdict: 'certo', probes: { ...review().probes, warned: true, points: 50 } }),
      review({ tokens: 420_000, verdict: 'certo' }),
      review({ tokens: 700_000 })
    ])

    expect(lines[0]).toBe('avaliações: 3 de 4 (/forecast rate cedo|certo|tarde)')
    expect(lines).toContain('- cedo: 1, mediana 200k')
    expect(lines).toContain('- certo: 2, mediana 400k')
    expect(lines).toContain('- o mod tinha avisado em 1 de 3 avaliados')
    expect(lines.at(-1)).toContain('com 5 avaliados como certo')
    expect(reviewsSummary([])).toEqual([])
  })

  test('stored reviews and probes are read defensively', () => {
    const good = review({ verdict: 'tarde' })

    expect(readReviews('nope')).toEqual([])
    expect(readReviews([good, null, { at: 1 }, { ...good, verdict: 'nunca' }, { ...good, reason: 'other' }, { ...good, probes: null }])).toEqual([good])
    expect(readReviews([{ ...good, probes: { warned: 'yes', points: 'x', reasons: [1, 'a'] } }])[0]?.probes).toEqual({
      warned: false,
      points: 0,
      reasons: ['a'],
      errorRecent: null,
      errorEarlier: null,
      reread: null
    })
    expect(readProbe({ reviewAt: NOW - 3_600_000, before: ['/a', 3] }, NOW)).toEqual({ reviewAt: NOW - 3_600_000, before: ['/a'], after: [] })
    expect(readProbe({ reviewAt: NOW - 7 * 3_600_000, before: [] }, NOW)).toBe(null)
    expect(readProbe(null, NOW)).toBe(null)
  })
})
