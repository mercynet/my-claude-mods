import type { Signal, SignalKind } from '../../types'

export type SignalDraft = { kind: SignalKind; label: string; points: number }

const MAX_EDITED = 20
const MAX_TOUCHED = 30

// Weights follow how often each signal preceded a real clear over 70 recorded sessions (base rate 8.8%):
// push 3.0x, commit 1.9x, green suite 0.3x. A green suite is routine here, not a stopping point.
export const SIGNAL_POINTS = {
  stateHandoff: 50,
  pr: 35,
  commit: 30,
  push: 40,
  todos: 20,
  pest: 5,
  task: 10,
  topic: 25
} as const

const DOCUMENT = /\.(md|mdx|txt)$/i

const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
const PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\b/
const PULL_REQUEST = /\bgh\s+pr\s+(create|merge)\b/
const HANDOFF = /state[^\n]{0,40}handoff|handoff[^\n]{0,40}state/i
const COMMAND_START = /(?:^|[;&|]\s*)/.source

const DEFAULT_TEST_COMMANDS = [
  /\bvendor\/bin\/(?:pest|phpunit)\b/.source,
  COMMAND_START + /(?:(?:python3?\s+-m|poetry\s+run|uv\s+run)\s+)?(?:pytest|pest|phpunit)\b/.source,
  COMMAND_START + /(?:npx\s+|(?:pnpm|yarn)\s+(?:exec\s+)?)?(?:jest|vitest)\b/.source,
  COMMAND_START + /(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?test\b/.source,
  COMMAND_START + /(?:go|cargo)\s+test\b/.source
]

const isValidPattern = (source: string): boolean => {
  try {
    new RegExp(source)

    return true
  } catch {
    return false
  }
}

// A typo in the user pattern is dropped instead of thrown: it must not break the Bash hook.
export const testCommandPattern = (extra = ''): RegExp => {
  const sources = DEFAULT_TEST_COMMANDS.map(source => `(?:${source})`)
  const own = extra.trim()

  if (own !== '' && isValidPattern(own)) sources.push(`(?:${own})`)

  return new RegExp(sources.join('|'), 'm')
}

const DEFAULT_TEST_PATTERN = testCommandPattern()
const PEST_SUMMARY = /^\s*Tests:\s*(.*)$/m
const PEST_FAILURE = /⨯|\bFAILED\b|\bFAIL\b|\bFatal error\b|\bfailed\b|\berrored\b/

export type GitOperation = { commit?: unknown; push?: unknown; pr?: { action?: string } }

export type BashOutcome = { isError: boolean; text: string | undefined; git: GitOperation | undefined }

export const pestPassed = (text: string | undefined): boolean => {
  if (text === undefined) return true

  const summary = PEST_SUMMARY.exec(text)?.[1]

  return summary === undefined ? !PEST_FAILURE.test(text) : !PEST_FAILURE.test(summary)
}

const firstOfEachKind = (drafts: SignalDraft[]): SignalDraft[] =>
  drafts.filter((draft, i) => drafts.findIndex(other => other.kind === draft.kind) === i)

// A task closed successfully (commit, push, PR, green suite) is the best point to clear: what would be lost
// is already in the repository. `gitOperation` is what the engine saw happen, the regex is what was asked for.
export const bashCheckpoints = (
  command: string,
  outcome: BashOutcome,
  testPattern: RegExp = DEFAULT_TEST_PATTERN
): SignalDraft[] => {
  if (outcome.isError) return []

  const found: SignalDraft[] = []
  const pr = PULL_REQUEST.exec(command)?.[1] ?? outcome.git?.pr?.action

  if (COMMIT.test(command) || outcome.git?.commit !== undefined) {
    found.push(
      HANDOFF.test(command)
        ? { kind: 'state-handoff', label: 'commit STATE handoff', points: SIGNAL_POINTS.stateHandoff }
        : { kind: 'commit', label: 'git commit feito', points: SIGNAL_POINTS.commit }
    )
  }

  if (PUSH.test(command) || outcome.git?.push !== undefined) {
    found.push({ kind: 'push', label: 'git push feito', points: SIGNAL_POINTS.push })
  }

  if (pr !== undefined && ['create', 'merge', 'created', 'merged'].includes(pr)) {
    found.push({ kind: 'pr', label: pr.startsWith('merge') ? 'PR mesclado' : 'PR criado', points: SIGNAL_POINTS.pr })
  }

  if (testPattern.test(command) && pestPassed(outcome.text)) {
    found.push({ kind: 'pest', label: 'suite de testes verde', points: SIGNAL_POINTS.pest })
  }

  return firstOfEachKind(found)
}

export type TodoCounts = { before: number; after: number; total: number }

export const todoCounts = (result: unknown): TodoCounts | null => {
  if (typeof result !== 'object' || result === null) return null

  const { oldTodos, newTodos } = result as { oldTodos?: unknown; newTodos?: unknown }

  if (!Array.isArray(newTodos)) return null

  const completed = (list: unknown): number =>
    Array.isArray(list) ? list.filter(todo => (todo as { status?: unknown }).status === 'completed').length : 0

  return { before: completed(oldTodos), after: completed(newTodos), total: newTodos.length }
}

export const todoCheckpoint = (counts: TodoCounts | null): SignalDraft | null => {
  if (counts === null || counts.total === 0) return null
  if (counts.after === counts.total && counts.after > counts.before) {
    return { kind: 'todos', label: 'lista de tarefas concluída', points: SIGNAL_POINTS.todos }
  }

  return counts.after > counts.before
    ? { kind: 'task', label: 'tarefa concluída', points: SIGNAL_POINTS.task }
    : null
}

export const taskCheckpoint = (status: string | undefined): SignalDraft | null =>
  status === 'completed' ? { kind: 'task', label: 'tarefa concluída', points: SIGNAL_POINTS.task } : null

export const gitOperationOf = (result: unknown): GitOperation | undefined =>
  typeof result === 'object' && result !== null ? (result as { gitOperation?: GitOperation }).gitOperation : undefined

// Counted per tool: a success of another tool (reading a file between two `make` attempts) does not undo
// the loop; only a success of the tool itself resets it.
export const nextFailures = (
  current: Readonly<Record<string, number>>,
  tool: string,
  failed: boolean
): Record<string, number> => {
  if (failed) return { ...current, [tool]: (current[tool] ?? 0) + 1 }

  return Object.fromEntries(Object.entries(current).filter(([name]) => name !== tool))
}

// Editing the same file many times is only a loop while something is failing: STATE.md and specs are
// rewritten on purpose (a sixth of the repeated-edit alerts came from one handoff file alone), and a file edited
// through a passing test run is progress.
export const countsTowardLoop = (path: string, hasOpenFailure: boolean): boolean =>
  hasOpenFailure && !DOCUMENT.test(path)

export const withEdit = (
  edited: readonly string[],
  touched: readonly string[],
  path: string
): { edited: string[]; touched: string[] } => ({
  edited: [...edited, path].slice(-MAX_EDITED),
  touched: [...touched.filter(known => known !== path), path].slice(-MAX_TOUCHED)
})

export const withSignals = (current: readonly Signal[], turn: number, drafts: readonly SignalDraft[]): Signal[] => {
  const alreadyHas = (kind: SignalKind): boolean => current.some(s => s.turn === turn && s.kind === kind)

  return [...current, ...drafts.filter(draft => !alreadyHas(draft.kind)).map(draft => ({ ...draft, turn }))]
}
