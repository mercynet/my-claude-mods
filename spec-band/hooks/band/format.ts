import type { Phase, TaskCount } from '../../types'

export type BandView = { text: string; isStale: boolean }

export type ViewInput = {
  label: string
  tasks: TaskCount | null
  stateFile: string
  ageMs: number | null
  phase: Phase | null
  edits: number
  staleAfterEdits: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatAge(ageMs: number): string {
  if (ageMs < MINUTE) return 'agora'
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} min`
  if (ageMs < 2 * DAY) return `${Math.floor(ageMs / HOUR)} h`
  return `${Math.floor(ageMs / DAY)} d`
}

export function buildView(input: ViewInput): BandView {
  const segments = [input.label]
  if (input.tasks !== null) segments.push(`tarefas ${input.tasks.done}/${input.tasks.total}`)
  if (input.ageMs !== null) segments.push(`STATE ${formatAge(Math.max(0, input.ageMs))}`)
  if (input.phase !== null) segments.push(`fase ${input.phase}`)

  const isStale = input.ageMs !== null && input.edits >= input.staleAfterEdits
  if (isStale) {
    const noun = input.edits === 1 ? 'edição' : 'edições'
    segments.push(`${input.stateFile} sem atualizar há ${input.edits} ${noun}`)
  }

  return { text: segments.join(' · '), isStale }
}
