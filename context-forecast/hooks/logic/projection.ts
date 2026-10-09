import type { CompactMarker, HistoryEntry, LimitSample, LimitWindow, TurnPoint } from '../../types'

import { compactNumber, duration } from './format'

export const isTurnPoint = (entry: HistoryEntry): entry is TurnPoint => entry.kind === 'turn'

export const isCompactMarker = (entry: HistoryEntry): entry is CompactMarker => entry.kind === 'compact'

export const turnPointsOf = (history: readonly HistoryEntry[]): TurnPoint[] => history.filter(isTurnPoint)

// How many turns until `target` tokens, at the average pace of the last turns that grew.
export const turnsUntil = (history: readonly HistoryEntry[], target: number): number | null => {
  const recent = turnPointsOf(history).slice(-6)
  const now = recent.at(-1)
  const growth = recent.flatMap((p, i) => (i === 0 ? [] : [p.tokens - recent[i - 1]!.tokens])).filter(d => d > 0)

  if (now === undefined || growth.length === 0) return null

  const average = growth.reduce((sum, d) => sum + d, 0) / growth.length

  return Math.max(0, Math.ceil((target - now.tokens) / average))
}

const MAX_LIMIT_SAMPLES = 12
const MIN_RATE_INTERVAL_MS = 60_000

export type MeasuredLimit = { kind: string; percentUsed: number; resetsAt?: string }

export const updateLimitWindows = (
  previous: readonly LimitWindow[],
  measured: readonly MeasuredLimit[],
  now: number
): LimitWindow[] =>
  measured.map(limit => {
    const resetsAt = limit.resetsAt ?? null
    const before = previous.find(w => w.kind === limit.kind)
    const sameWindow = before !== undefined && before.resetsAt === resetsAt && limit.percentUsed >= before.percentUsed
    const sample: LimitSample = { at: now, percent: limit.percentUsed }
    const samples = sameWindow ? [...before.samples, sample].slice(-MAX_LIMIT_SAMPLES) : [sample]

    return { kind: limit.kind, percentUsed: limit.percentUsed, resetsAt, samples }
  })

export const limitLabel = (kind: string): string => {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'gasto'

  return kind
}

export type WindowProjection = { resetsInMs: number | null; exhaustsInMs: number | null; exhaustsFirst: boolean }

export const projectWindow = (window: LimitWindow, now: number): WindowProjection => {
  const resetAt = window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt)
  const resetsInMs = Number.isNaN(resetAt) ? null : Math.max(0, resetAt - now)
  const first = window.samples[0]
  const last = window.samples.at(-1)
  const interval = first === undefined || last === undefined ? 0 : last.at - first.at
  const growth = first === undefined || last === undefined ? 0 : last.percent - first.percent

  if (interval < MIN_RATE_INTERVAL_MS || growth <= 0) {
    return { resetsInMs, exhaustsInMs: null, exhaustsFirst: false }
  }

  const exhaustsInMs = ((100 - window.percentUsed) / growth) * interval

  return { resetsInMs, exhaustsInMs, exhaustsFirst: resetsInMs !== null && exhaustsInMs < resetsInMs }
}

export type WindowWarning = { text: string; color: string }

const WARN_PERCENT = 80
const WARN_PERCENT_WITH_PACE = 50
const CRITICAL_PERCENT = 90

export const windowWarning = (window: LimitWindow, now: number): WindowWarning | null => {
  const { resetsInMs, exhaustsInMs, exhaustsFirst } = projectWindow(window, now)
  const critical = window.percentUsed >= CRITICAL_PERCENT
  const high = window.percentUsed >= WARN_PERCENT

  if (!critical && !high && !(exhaustsFirst && window.percentUsed >= WARN_PERCENT_WITH_PACE)) return null

  const parts = [`janela de ${limitLabel(window.kind)} em ${Math.round(window.percentUsed)}%`]

  if (resetsInMs !== null) parts.push(`reinicia em ${duration(resetsInMs)}`)
  if (exhaustsFirst && exhaustsInMs !== null) parts.push(`no ritmo atual esgota em ~${duration(exhaustsInMs)}`)

  return { text: parts.join(' · '), color: critical || exhaustsFirst ? 'red' : 'yellow' }
}

export const autoCompactText = (tokens: number, limit: number | null, history: readonly HistoryEntry[]): string | null => {
  if (limit === null || tokens <= 0) return null

  const turnsLeft = turnsUntil(history, limit)
  const remaining = limit - tokens
  const close = tokens >= limit * 0.9 || (turnsLeft !== null && turnsLeft <= 3)

  if (!close) return null

  return `auto-compact perto (~${compactNumber(Math.max(0, remaining))} até ${compactNumber(limit)}): faça /compact manual antes, o gate PreCompact só cobre o manual`
}
