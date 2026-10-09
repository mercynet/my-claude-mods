import { HISTORY_LIMIT } from './config'
import { mean } from './estimate'
import type { Mode, Reason } from './mode'
import type { CutSection, Drift } from './sections'
import type { Weights } from './weights'

export type ConversationRecord = {
  sessionId: string
  projectDir: string
  startedAt: number
  seq: string[]
  reads: number
  mode: Mode
  reason: Reason
  detail: string
  applied: boolean
  cut: CutSection[]
  missing: string[]
  drift: Drift[]
  savedBytes: number
  savedTokens: number
  isAgentsInText?: boolean
  firstRequestTokens?: number
  turnEndTokens?: number
  windowTokens?: number
  weights?: Weights
}

export type Settings = { applyCut: boolean }

export type Diag = { at: number; sessionId: string; note: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseSettings = (value: unknown): Settings => ({
  applyCut: isRecord(value) && value.applyCut === true,
})

export const parseHistory = (value: unknown): ConversationRecord[] =>
  Array.isArray(value) ? (value.filter(isRecord) as ConversationRecord[]) : []

export const parseDiag = (value: unknown): Diag | undefined => (isRecord(value) ? (value as Diag) : undefined)

export function patchHistory(
  history: readonly ConversationRecord[],
  sessionId: string,
  mutate: (record: ConversationRecord) => void,
  create?: () => ConversationRecord,
): { history: ConversationRecord[]; record: ConversationRecord } | undefined {
  const next = [...history]
  let record = next.find(item => item.sessionId === sessionId)
  if (record === undefined) {
    if (create === undefined) return undefined
    record = create()
    next.push(record)
  }
  mutate(record)
  return { history: next.slice(-HISTORY_LIMIT), record }
}

export type Group = { n: number; meanTokens?: number }

export type AbStats = { withoutCut: Group; withCut: Group }

const groupOf = (records: readonly ConversationRecord[]): Group => ({
  n: records.length,
  meanTokens: mean(records.map(record => record.firstRequestTokens ?? 0)),
})

export function abStats(history: readonly ConversationRecord[]): AbStats {
  const measured = history.filter(
    record => record.mode === 'lean' && record.firstRequestTokens !== undefined,
  )
  return {
    withoutCut: groupOf(measured.filter(record => !record.applied)),
    withCut: groupOf(measured.filter(record => record.applied)),
  }
}
