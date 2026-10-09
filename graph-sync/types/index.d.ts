export type DirtySet = {
  edits: number
  paths: string[]
}

export type RunFailure = {
  edits: number
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'graph-sync': {
      dirty: DirtySet | null
      failure: RunFailure | null
      missing: boolean
    }
  }
}
