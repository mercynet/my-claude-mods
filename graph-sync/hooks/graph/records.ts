export type RunOutcome = 'ok' | 'failed' | 'timeout' | 'error'

export type LastRun = {
  startedAt: number
  durationMs: number
  exitCode: number | null
  outcome: RunOutcome
  edits: number
}

export type Lock = {
  sessionId: string
  startedAt: number
}

export const lockKey = (root: string): string => `lock:${root}`

export const lastKey = (root: string): string => `last:${root}`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const OUTCOMES: readonly RunOutcome[] = ['ok', 'failed', 'timeout', 'error']

export function parseLock(raw: unknown): Lock | undefined {
  if (!isRecord(raw)) return undefined
  return typeof raw.sessionId === 'string' && typeof raw.startedAt === 'number'
    ? { sessionId: raw.sessionId, startedAt: raw.startedAt }
    : undefined
}

export function parseLast(raw: unknown): LastRun | undefined {
  if (!isRecord(raw)) return undefined
  const { startedAt, durationMs, exitCode, outcome, edits } = raw
  if (typeof startedAt !== 'number' || typeof durationMs !== 'number' || typeof edits !== 'number') return undefined
  if (!OUTCOMES.includes(outcome as RunOutcome)) return undefined
  return {
    startedAt,
    durationMs,
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    outcome: outcome as RunOutcome,
    edits,
  }
}

export function isLockLive(lock: Lock, now: number, sessionId: string, hasOwnRun: boolean, timeoutMs: number): boolean {
  if (lock.sessionId === sessionId && !hasOwnRun) return false
  const age = now - lock.startedAt
  return age >= 0 && age < timeoutMs
}
