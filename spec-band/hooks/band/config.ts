export const DEFAULT_SPECS_DIR = 'specs/_active'

export const DEFAULT_TASKS_FILE = 'tasks.md'

export const DEFAULT_STATE_FILE = 'STATE.md'

export const DEFAULT_STALE_AFTER_EDITS = 15

export const GIT_TIMEOUT_MS = 5000

export const LABEL_MAX = 24

export type BandOptions = {
  specsDir: string
  tasksFile: string
  stateFile: string
  staleAfterEdits: number
}

const isSafeRelative = (value: string): boolean =>
  value !== '' && !value.startsWith('/') && !value.includes('..') && !value.includes('\\') && !/[\x00-\x1f]/.test(value)

const textOption = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/\/+$/, '')
  return isSafeRelative(trimmed) ? trimmed : fallback
}

const countOption = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

export function parseOptions(raw: Readonly<Record<string, unknown>>): BandOptions {
  return {
    specsDir: textOption(raw.specsDir, DEFAULT_SPECS_DIR),
    tasksFile: textOption(raw.tasksFile, DEFAULT_TASKS_FILE),
    stateFile: textOption(raw.stateFile, DEFAULT_STATE_FILE),
    staleAfterEdits: countOption(raw.staleAfterEdits, DEFAULT_STALE_AFTER_EDITS),
  }
}
