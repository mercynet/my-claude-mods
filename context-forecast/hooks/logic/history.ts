import type { CompactMarker, HistoryEntry, TurnPoint } from '../../types'

import { isCompactMarker, isTurnPoint } from './projection'

export const MAX_ENTRIES = 24
export const VISIBLE_ENTRIES = 12

export type MeasuredContext = { tokens?: number; window: number; percent?: number }

export const toTurnPoint = (context: MeasuredContext): TurnPoint | null => {
  if (context.tokens === undefined || !context.window) return null

  return {
    kind: 'turn',
    tokens: context.tokens,
    window: context.window,
    percent: context.percent ?? Math.round((context.tokens / context.window) * 100)
  }
}

export const lastTurnPoint = (history: readonly HistoryEntry[]): TurnPoint | undefined =>
  history.filter(isTurnPoint).at(-1)

export const isRepeat = (history: readonly HistoryEntry[], point: TurnPoint): boolean => {
  const last = history.at(-1)

  return last !== undefined && isTurnPoint(last) && last.tokens === point.tokens && last.window === point.window
}

export const withPoint = (history: readonly HistoryEntry[], point: TurnPoint): HistoryEntry[] =>
  [...history, point].slice(-MAX_ENTRIES)

// A compaction does not erase the history: it becomes a marker between the turns. Two reports of the same
// event (the compaction event and the session restart) merge into the last marker.
export const withMarker = (history: readonly HistoryEntry[], marker: CompactMarker): HistoryEntry[] => {
  const last = history.at(-1)
  const base = last !== undefined && isCompactMarker(last) ? history.slice(0, -1) : history

  return [...base, marker].slice(-MAX_ENTRIES)
}
