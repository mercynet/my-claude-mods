export type TurnPoint = { kind: 'turn'; tokens: number; window: number; percent: number }

export type CompactMarker = { kind: 'compact'; origin: 'manual' | 'auto' | 'plugin'; before: number | null }

export type HistoryEntry = TurnPoint | CompactMarker

export type SignalKind = 'commit' | 'push' | 'pr' | 'pest' | 'state-handoff' | 'todos' | 'task' | 'topic'

// `turn` is the turn (counted since the session started) the signal belongs to: it only counts while it is the last measured one.
export type Signal = { turn: number; kind: SignalKind; label: string; points: number }

export type ClearSample = { tokens: number; window: number; reason: 'clear' | 'compact'; at: number }

export type Verdict = 'cedo' | 'certo' | 'tarde'

// What the mod saw at the moment of a clear or compact, kept so the person's later verdict can be checked against it.
export type Probes = {
  warned: boolean
  points: number
  reasons: string[]
  errorRecent: number | null
  errorEarlier: number | null
  reread: number | null
}

export type Review = {
  at: number
  reason: 'clear' | 'compact'
  tokens: number
  window: number
  verdict: Verdict | null
  probes: Probes
}

export type ToolStat = { turn: number; calls: number; errors: number }

export type RereadProbe = { reviewAt: number; before: string[]; after: string[] }

export type LimitSample = { at: number; percent: number }

export type LimitWindow = { kind: string; percentUsed: number; resetsAt: string | null; samples: LimitSample[] }

export type WeightRow = { key: string; label: string; tokens: number }

export type WeightFile = { name: string; tokens: number }

export type ContextWeight = {
  detail: 'summary' | 'full'
  base: number
  conversation: number
  rows: WeightRow[]
  memory: WeightFile[]
  autoCompactAt: number | null
}

export type CompactionStatus = { state: 'running' | 'done' | 'vetoed' | 'error'; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'context-forecast': {
      history: HistoryEntry[]
      turns: number
      signals: Signal[]
      failures: Record<string, number>
      edited: string[]
      touched: string[]
      limits: LimitWindow[]
      cost: number | null
      weight: ContextWeight | null
      samples: ClearSample[]
      reads: string[]
      toolStats: ToolStat[]
      probe: RereadProbe | null
      reviews: Review[]
      confirming: boolean
      compaction: CompactionStatus | null
      lastPrompt: string
    }
  }
}
