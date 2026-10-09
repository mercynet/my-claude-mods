import type { HistoryEntry, Signal, TurnPoint } from '../../types'

import { compactNumber, shortPath } from './format'
import { isTurnPoint } from './projection'
import type { Thresholds } from './thresholds'

export const POINTS = {
  heavy: 20,
  high: 40,
  critical: 70,
  checkpointsMax: 60,
  failures: 40,
  repeatedEdits: 25
} as const

export const ATTENTION_LIMIT = 40
export const NOW_LIMIT = 70
export const REPEATED_FAILURES = 4
export const REPEATED_EDITS = 5
export const CRITICAL_WINDOW_PERCENT = 90

export type ReasonCode = 'size' | 'checkpoint' | 'loop' | 'topic'

export type Reason = { code: ReasonCode; text: string; points: number }

export type Level = 'none' | 'attention' | 'now'

export type Assessment = { points: number; level: Level; reasons: Reason[]; thresholds: Thresholds }

export type ScoreInput = {
  history: readonly HistoryEntry[]
  turns: number
  signals: readonly Signal[]
  failures: Readonly<Record<string, number>>
  edited: readonly string[]
  thresholds: Thresholds
}

const calibratedSuffix = (thresholds: Thresholds): string => (thresholds.calibrated ? ', calibrado' : '')

const isHeavy = (point: TurnPoint, thresholds: Thresholds): boolean =>
  point.tokens >= thresholds.heavy || point.percent >= thresholds.heavyPercent

// Below the heavy mark a finished task is not a reason to clear: the person did so in 5% of those turns.
// An explicit STATE handoff is the person saying so, whatever the size.
const countedSignals = (
  signals: readonly Signal[],
  last: TurnPoint | undefined,
  thresholds: Thresholds
): readonly Signal[] =>
  last !== undefined && isHeavy(last, thresholds) ? signals : signals.filter(s => s.kind === 'state-handoff')

const sizeReason = (point: TurnPoint, thresholds: Thresholds): Reason | null => {
  if (point.percent >= CRITICAL_WINDOW_PERCENT) {
    return { code: 'size', text: `janela quase cheia (${point.percent}%)`, points: POINTS.critical }
  }

  if (point.tokens >= thresholds.high) {
    return {
      code: 'size',
      text: `contexto alto ${compactNumber(point.tokens)} (limiar ${compactNumber(thresholds.high)}${calibratedSuffix(thresholds)})`,
      points: POINTS.high
    }
  }

  if (point.percent >= thresholds.highPercent) {
    return { code: 'size', text: `contexto alto, ${point.percent}% da janela`, points: POINTS.high }
  }

  if (point.tokens >= thresholds.heavy) {
    return {
      code: 'size',
      text: `contexto pesado ${compactNumber(point.tokens)} (limiar ${compactNumber(thresholds.heavy)}${calibratedSuffix(thresholds)})`,
      points: POINTS.heavy
    }
  }

  if (point.percent >= thresholds.heavyPercent) {
    return { code: 'size', text: `contexto pesado, ${point.percent}% da janela`, points: POINTS.heavy }
  }

  return null
}

const checkpointReasons = (signals: readonly Signal[], turns: number): Reason[] => {
  const ofTurn = signals.filter(s => s.turn === turns && s.kind !== 'topic')
  const unique = ofTurn.filter((s, i) => ofTurn.findIndex(other => other.kind === s.kind) === i)
  const reasons: Reason[] = []
  let remaining: number = POINTS.checkpointsMax

  for (const signal of unique.sort((a, b) => b.points - a.points)) {
    const points = Math.min(signal.points, remaining)

    if (points > 0) reasons.push({ code: 'checkpoint', text: signal.label, points })

    remaining -= points
  }

  return reasons
}

const topicReason = (signals: readonly Signal[], turns: number): Reason | null => {
  const signal = signals.find(s => s.turn === turns && s.kind === 'topic')

  return signal === undefined ? null : { code: 'topic', text: signal.label, points: signal.points }
}

const loopReasons = (failures: Readonly<Record<string, number>>, edited: readonly string[]): Reason[] => {
  const reasons: Reason[] = []
  const worst = Object.entries(failures).sort((a, b) => b[1] - a[1])[0]

  if (worst !== undefined && worst[1] >= REPEATED_FAILURES) {
    reasons.push({ code: 'loop', text: `${worst[0]} falhou ${worst[1]}x seguidas`, points: POINTS.failures })
  }

  const counts = new Map<string, number>()

  for (const path of edited) counts.set(path, (counts.get(path) ?? 0) + 1)

  const mostEdited = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]

  if (mostEdited !== undefined && mostEdited[1] >= REPEATED_EDITS) {
    reasons.push({
      code: 'loop',
      text: `${shortPath(mostEdited[0])} editado ${mostEdited[1]}x`,
      points: POINTS.repeatedEdits
    })
  }

  return reasons
}

// A finished task says the moment is good, not that the context is in trouble: urgency needs the size past
// the high mark or a loop, otherwise a commit plus a push on any heavy context would read as an alarm.
const hasPressure = (reasons: readonly Reason[]): boolean =>
  reasons.some(reason => reason.code === 'loop' || (reason.code === 'size' && reason.points >= POINTS.high))

export const assess = (input: ScoreInput): Assessment => {
  const last = input.history.filter(isTurnPoint).at(-1)
  const reasons = [
    ...(last === undefined ? [] : [sizeReason(last, input.thresholds)]),
    ...checkpointReasons(countedSignals(input.signals, last, input.thresholds), input.turns),
    ...loopReasons(input.failures, input.edited),
    topicReason(input.signals, input.turns)
  ]
    .filter((reason): reason is Reason => reason !== null)
    .sort((a, b) => b.points - a.points)

  const points = Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0))
  const level: Level =
    points >= NOW_LIMIT && hasPressure(reasons) ? 'now' : points >= ATTENTION_LIMIT ? 'attention' : 'none'

  return { points, level, reasons, thresholds: input.thresholds }
}

export type ScoreWarning = { text: string; color: string }

const SHOWN_REASONS = 2

const headline = (assessment: Assessment): string => {
  if (assessment.reasons.some(r => r.code === 'loop')) return 'possível loop, considere /clear'
  if (assessment.level === 'now') return 'limpe ou compacte agora'
  if (assessment.reasons.some(r => r.code === 'checkpoint')) return 'bom momento para /clear'

  return 'considere limpar'
}

// One short sentence for the band; the points of each reason are what `/forecast why` is for.
export const scoreWarning = (assessment: Assessment): ScoreWarning | null => {
  if (assessment.level === 'none') return null

  const shown = assessment.reasons.slice(0, SHOWN_REASONS).map(r => r.text)
  const color =
    assessment.reasons.some(r => r.code === 'loop') || assessment.level === 'now'
      ? 'red'
      : assessment.reasons.some(r => r.code === 'checkpoint')
        ? 'green'
        : 'yellow'

  return { text: `${headline(assessment)}: ${shown.join(', ')}`, color }
}

export const explainScore = (assessment: Assessment): string[] => {
  const { thresholds } = assessment
  const origin = thresholds.calibrated
    ? `limiares calibrados (${thresholds.samples} amostras nesta janela, p25 ${compactNumber(Math.round(thresholds.quartiles?.p25 ?? 0))}, p75 ${compactNumber(Math.round(thresholds.quartiles?.p75 ?? 0))}): pesado ${compactNumber(thresholds.heavy)}, alto ${compactNumber(thresholds.high)}`
    : `limiares padrão (${thresholds.samples} de 5 amostras nesta janela para calibrar): pesado ${compactNumber(thresholds.heavy)}, alto ${compactNumber(thresholds.high)}`

  if (assessment.reasons.length === 0) {
    return [`Sem motivo para limpar agora: score 0 de ${ATTENTION_LIMIT} necessários.`, origin]
  }

  const verdict =
    assessment.level === 'none'
      ? `abaixo de ${ATTENTION_LIMIT}: sem aviso`
      : assessment.level === 'attention'
        ? assessment.points >= NOW_LIMIT
          ? `aviso; urgente só com contexto alto ou loop`
          : `aviso a partir de ${ATTENTION_LIMIT}`
        : `urgente a partir de ${NOW_LIMIT}`

  return [
    `Score ${assessment.points}/100 (${verdict}).`,
    ...assessment.reasons.map(r => `- ${r.text}: +${r.points}`),
    origin
  ]
}
