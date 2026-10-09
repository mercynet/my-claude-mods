import type { CheckResult, Status } from './types'

export const result = (id: string, status: Status, reason: string, fix?: string): CheckResult =>
  fix === undefined ? { id, status, reason } : { id, status, reason, fix }

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const firstLine = (text: string, limit = 120): string => {
  const line = text.split(/\r?\n/).find(candidate => candidate.trim() !== '') ?? ''
  return line.length > limit ? `${line.slice(0, limit - 3)}...` : line.trim()
}
