export type Phase = 'A' | 'B' | 'C' | 'review'

export type TaskCount = { done: number; total: number }

export type Snapshot = {
  label: string
  tasks: TaskCount | null
  stateMtimeMs: number | null
  phase: Phase | null
}

declare module 'claude-code' {
  interface PluginState {
    'spec-band': {
      snapshot: Snapshot | null
      edits: number
    }
  }
}
