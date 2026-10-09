export type ModeOverride = { sessionId: string; mode: 'full' | 'lean' }

export type ActiveCut = {
  sessionId: string
  projectDir: string
  titles: string[]
  isReminded: boolean
  setAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'lean-context': {
      override: ModeOverride | null
      active: ActiveCut | null
      proposed: { sessionId: string } | null
    }
  }
}
