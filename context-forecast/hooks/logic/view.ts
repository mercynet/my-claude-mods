import type {
  ClearSample,
  CompactionStatus,
  ContextWeight,
  HistoryEntry,
  LimitWindow,
  Signal,
  TurnPoint
} from '../../types'

import { rowColor } from './breakdown'
import { compactNumber, duration, money, signedNumber, weatherBand } from './format'
import type { Weather } from './format'
import { gaugeSpans, limitColor } from './gauge'
import type { GaugeMark, Span } from './gauge'
import { VISIBLE_ENTRIES, lastTurnPoint } from './history'
import {
  autoCompactText,
  isCompactMarker,
  isTurnPoint,
  limitLabel,
  projectWindow,
  turnsUntil,
  windowWarning
} from './projection'
import { assess, explainScore, scoreWarning } from './score'
import type { Assessment, Level } from './score'
import { calibrate } from './thresholds'
import type { Thresholds } from './thresholds'

export type ReadState = {
  history: readonly HistoryEntry[]
  turns: number
  signals: readonly Signal[]
  failures: Readonly<Record<string, number>>
  edited: readonly string[]
  limits: readonly LimitWindow[]
  cost: number | null
  weight: ContextWeight | null
  samples: readonly ClearSample[]
  compaction: CompactionStatus | null
  calibrate: boolean
}

export type Warning = { source: 'score' | 'window' | 'auto-compact' | 'projection'; text: string; color: string }

// The one place a narrow terminal changes the band: the gauge leaves and the text stays.
export type Layout = { gauge: boolean }

export const layoutFor = (columns: number): Layout => ({ gauge: columns >= 50 })

// The second line of the band: why there is something to look at, and whether a compact button goes with it.
export type Note = { text: string; color: string; hasButton: boolean }

export type View = {
  weather: Weather
  tokens: number
  window: number
  percent: number
  layout: Layout
  headline: Span[]
  note: Note | null
  warnings: Warning[]
  assessment: Assessment
  thresholds: Thresholds
}

const GAUGE_WIDTH = 12
const HORIZON_TURNS = 6
const RECENT_COMPACTION_MS = 10 * 60_000
const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']
const COMPACT_MARKER = '↓'

const lastTurnDelta = (history: readonly HistoryEntry[]): Span[] | null => {
  const indices = history.flatMap((entry, i) => (isTurnPoint(entry) ? [i] : []))
  const previousIndex = indices.at(-2)
  const currentIndex = indices.at(-1)

  if (previousIndex === undefined || currentIndex === undefined) return null

  const current = history[currentIndex]
  const previous = history[previousIndex]

  if (current === undefined || previous === undefined || !isTurnPoint(current) || !isTurnPoint(previous)) return null

  const compacted = history.slice(previousIndex + 1, currentIndex).some(isCompactMarker)

  return [
    { text: signedNumber(current.tokens - previous.tokens) },
    { text: compacted ? ' desde o compact' : ' no último turno', dim: true }
  ]
}

// The scale of a gauge is the window; the marks sit where the thresholds begin to matter, so the person
// sees how far the problem is. A threshold past the window (300k on a 200k window) cannot be drawn.
const thresholdMarks = (thresholds: Thresholds, window: number): GaugeMark[] => {
  const heavy = Math.min(thresholds.heavy, (window * thresholds.heavyPercent) / 100)
  const high = Math.min(thresholds.high, (window * thresholds.highPercent) / 100)

  return [
    { at: heavy / window, color: 'yellow' },
    { at: high / window, color: 'red' }
  ]
}

const orderedLimits = (limits: readonly LimitWindow[]): LimitWindow[] =>
  [...limits].sort((a, b) => {
    const ia = LIMIT_ORDER.indexOf(a.kind)
    const ib = LIMIT_ORDER.indexOf(b.kind)

    return (ia === -1 ? LIMIT_ORDER.length : ia) - (ib === -1 ? LIMIT_ORDER.length : ib)
  })

const compactionColor = (state: CompactionStatus['state']): string =>
  state === 'done' ? 'green' : state === 'error' ? 'red' : 'yellow'

// Feedback on the person's own compact comes first; otherwise the first reason wins and the rest wait in `/forecast why`.
const noteFor = (warnings: readonly Warning[], compaction: CompactionStatus | null, now: number): Note | null => {
  const candidates = warnings.filter(warning => warning.source !== 'projection')
  const first = candidates[0]
  const extra = candidates.length - 1

  if (compaction !== null && now - compaction.at <= RECENT_COMPACTION_MS) {
    return { text: compaction.text, color: compactionColor(compaction.state), hasButton: first !== undefined }
  }

  return first === undefined
    ? null
    : { text: `${first.text}${extra > 0 ? ` (+${extra})` : ''}`, color: first.color, hasButton: true }
}

export const buildView = (state: ReadState, now: number, columns = 120): View | null => {
  const point = lastTurnPoint(state.history)

  if (point === undefined) return null

  const layout = layoutFor(columns)
  const thresholds = calibrate(state.samples, point.window, state.calibrate)
  const assessment = assess({
    history: state.history,
    turns: state.turns,
    signals: state.signals,
    failures: state.failures,
    edited: state.edited,
    thresholds
  })
  const weather = weatherBand(point.tokens, point.percent, thresholds)
  const target = Math.min(thresholds.high, (point.window * thresholds.highPercent) / 100)
  const turnsLeft = point.tokens >= target ? null : turnsUntil(state.history, target)
  const warnings: Warning[] = []
  const fromScore = scoreWarning(assessment)

  if (fromScore !== null) warnings.push({ source: 'score', ...fromScore })

  for (const window of orderedLimits(state.limits)) {
    const warning = windowWarning(window, now)

    if (warning !== null) warnings.push({ source: 'window', ...warning })
  }

  const autoCompact = autoCompactText(point.tokens, state.weight?.autoCompactAt ?? null, state.history)

  if (autoCompact !== null) warnings.push({ source: 'auto-compact', text: autoCompact, color: 'yellow' })

  if (turnsLeft !== null && turnsLeft > 0 && turnsLeft <= HORIZON_TURNS) {
    warnings.push({
      source: 'projection',
      text: `~${turnsLeft} ${turnsLeft === 1 ? 'turno' : 'turnos'} até ${compactNumber(target)}`,
      color: weather.color
    })
  }

  const headline: Span[] = [{ text: `${weather.symbol} ${weather.word}`, color: weather.color, bold: true }]

  if (layout.gauge) {
    const heavyMark = thresholdMarks(thresholds, point.window).slice(0, 1)

    headline.push({ text: ' ' }, ...gaugeSpans(point.tokens / point.window, GAUGE_WIDTH, weather.color, heavyMark))
  }

  headline.push({ text: ` ${point.percent}% · ${compactNumber(point.tokens)}/${compactNumber(point.window)}` })

  return {
    weather,
    tokens: point.tokens,
    window: point.window,
    percent: point.percent,
    layout,
    headline,
    note: noteFor(warnings, state.compaction, now),
    warnings,
    assessment,
    thresholds
  }
}

export type Row = Span[]

const clamp = (n: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, n))

const percentOfWindow = (tokens: number, window: number): number => (window === 0 ? 0 : Math.round((tokens / window) * 100))

const levelColor = (level: Level): string => (level === 'now' ? 'red' : level === 'attention' ? 'yellow' : 'green')

const REASON_COLORS: Record<string, string> = {
  size: 'magenta',
  checkpoint: 'green',
  loop: 'red',
  topic: 'blue'
}

const header = (text: string): Row => [{ text, bold: true }]

const BLANK: Row = [{ text: '' }]

const scoreRows = (assessment: Assessment, barWidth: number): Row[] => [
  [
    { text: 'Hora de limpar  ', bold: true },
    ...gaugeSpans(assessment.points / 100, barWidth, levelColor(assessment.level), [
      { at: 0.4, color: 'yellow' },
      { at: 0.7, color: 'red' }
    ]),
    { text: ` ${assessment.points}/100` }
  ],
  ...(assessment.reasons.length === 0
    ? [[{ text: '  nenhum motivo agora', dim: true }]]
    : assessment.reasons.map(reason => [
        { text: `  +${reason.points}`.padStart(5) + ' ' },
        { text: '█'.repeat(Math.max(1, Math.round(reason.points / 10))), color: REASON_COLORS[reason.code] ?? 'white' },
        { text: ` ${reason.text}` }
      ]))
]

const weightRows = (weight: ContextWeight | null, window: number, barWidth: number): Row[] => {
  if (weight === null) return [[{ text: '  ainda sem medição: aparece depois do primeiro turno', dim: true }]]

  const largest = Math.max(1, ...weight.rows.map(row => row.tokens))
  const note = weight.detail === 'full' ? 'contagem completa pela API' : 'estimativa local; /forecast full conta com a API'
  const rows: Row[] = [
    [
      { text: '  Base fixa ', dim: true },
      { text: `${compactNumber(weight.base)} (${percentOfWindow(weight.base, window)}%)` },
      { text: ' + Conversa ', dim: true },
      { text: `${compactNumber(weight.conversation)} (${percentOfWindow(weight.conversation, window)}%)` }
    ],
    ...weight.rows.map(row => [
      { text: `  ${row.label.padEnd(14)}`, dim: true },
      ...gaugeSpans(row.tokens / largest, barWidth, rowColor(row.key)),
      { text: ` ${compactNumber(row.tokens)}` },
      { text: ` ${percentOfWindow(row.tokens, window)}%`, dim: true }
    ])
  ]

  if (weight.memory.length > 0) {
    rows.push([
      { text: '  Memory files maiores ', dim: true },
      { text: weight.memory.map(file => `${file.name} ${compactNumber(file.tokens)}`).join(', ') }
    ])
  }

  rows.push([{ text: `  (${note})`, dim: true }])

  return rows
}

const limitRows = (state: ReadState, now: number, barWidth: number): Row[] => {
  const rows: Row[] =
    state.limits.length === 0
      ? [[{ text: '  sem leitura (conta sem limites ou ainda sem resposta)', dim: true }]]
      : orderedLimits(state.limits).map(window => {
          const { resetsInMs, exhaustsInMs, exhaustsFirst } = projectWindow(window, now)
          const color = limitColor(window.percentUsed)
          const spans: Span[] = [
            { text: `  ${limitLabel(window.kind).padEnd(5)}`, dim: true },
            ...gaugeSpans(window.percentUsed / 100, barWidth, color),
            { text: ` ${Math.round(window.percentUsed)}%`, color }
          ]

          if (resetsInMs !== null) spans.push({ text: ' · reinicia em ', dim: true }, { text: duration(resetsInMs) })
          if (exhaustsInMs !== null) {
            spans.push(
              { text: ' · ritmo atual esgota em ~', dim: true },
              { text: duration(exhaustsInMs), ...(exhaustsFirst ? { color: 'red' } : {}) },
              ...(exhaustsFirst ? [{ text: ' (antes de reiniciar)', dim: true }] : [])
            )
          }

          return spans
        })

  rows.push(
    state.cost === null
      ? [{ text: '  custo: indisponível', dim: true }]
      : [{ text: '  custo da sessão ', dim: true }, { text: money(state.cost) }]
  )

  return rows
}

const historyRows = (state: ReadState, thresholds: Thresholds, barWidth: number): Row[] => {
  const visible = state.history.slice(-VISIBLE_ENTRIES)
  let turnNumber = state.turns + 1

  return [...visible].reverse().flatMap((entry): Row[] => {
    if (!isTurnPoint(entry)) {
      return [
        [
          { text: `  ${COMPACT_MARKER} compact ${entry.origin}`, color: 'green', bold: true },
          ...(entry.before === null ? [] : [{ text: ` a partir de ${compactNumber(entry.before)}`, dim: true }])
        ]
      ]
    }

    turnNumber = Math.max(1, turnNumber - 1)

    return [
      [
        { text: `  #${turnNumber}`.padEnd(6), dim: true },
        ...turnBar(entry, thresholds, barWidth),
        { text: ` ${compactNumber(entry.tokens)}` },
        { text: ` ${entry.percent}%`, dim: true }
      ]
    ]
  })
}

const turnBar = (entry: TurnPoint, thresholds: Thresholds, barWidth: number): Span[] =>
  gaugeSpans(entry.tokens / entry.window, barWidth, weatherBand(entry.tokens, entry.percent, thresholds).color, thresholdMarks(thresholds, entry.window))

const dateOf = (instant: number): string => new Date(instant).toISOString().slice(0, 10)

export const panelRows = (view: View, state: ReadState, now: number, columns: number): Row[] => {
  const { thresholds, assessment } = view
  const barWidth = clamp(columns - 46, 8, 24)
  const thresholdsText = thresholds.calibrated
    ? `calibrados: ${thresholds.samples} amostras nesta janela, p25 ${compactNumber(Math.round(thresholds.quartiles?.p25 ?? 0))} · p75 ${compactNumber(Math.round(thresholds.quartiles?.p75 ?? 0))}`
    : `padrão (${thresholds.samples} de 5 amostras nesta janela para calibrar${state.calibrate ? '' : '; calibração desligada'})`
  const lastSamples = state.samples.slice(-5)
  const compaction = state.compaction
  const compactionColor = compaction?.state === 'done' ? 'green' : compaction?.state === 'error' ? 'red' : 'yellow'
  const delta = lastTurnDelta(state.history)

  return [
    [
      { text: `${view.weather.symbol} ${view.weather.word}`, color: view.weather.color, bold: true },
      { text: '  ' },
      ...gaugeSpans(view.tokens / view.window, barWidth, view.weather.color, thresholdMarks(thresholds, view.window)),
      { text: `  ${view.percent}% · ${compactNumber(view.tokens)}/${compactNumber(view.window)}` }
    ],
    ...(delta === null ? [] : [delta]),
    BLANK,
    ...scoreRows(assessment, barWidth),
    BLANK,
    header('O que pesa'),
    ...weightRows(state.weight, view.window, barWidth),
    BLANK,
    header('Limites de uso'),
    ...limitRows(state, now, barWidth),
    BLANK,
    header('Limiares'),
    [{ text: `  Pesado ${compactNumber(thresholds.heavy)} · Alto ${compactNumber(thresholds.high)} · ${thresholdsText}` }],
    ...(lastSamples.length === 0
      ? [[{ text: '  sem amostras: registo ao fazer /clear ou /compact', dim: true }]]
      : lastSamples.map(sample => [
          { text: `  ${dateOf(sample.at)}  ${sample.reason.padEnd(7)} `, dim: true },
          { text: `${compactNumber(sample.tokens)} de ${compactNumber(sample.window)}` }
        ])),
    BLANK,
    header('Histórico'),
    ...historyRows(state, thresholds, barWidth),
    ...(compaction === null ? [] : [BLANK, [{ text: compaction.text, color: compactionColor }]])
  ]
}

export const explanation = (view: View): string => {
  const extras = view.warnings.filter(w => w.source !== 'score').map(w => `- ${w.text}`)

  return [...explainScore(view.assessment), ...extras].join('\n')
}
