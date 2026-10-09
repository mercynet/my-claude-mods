import type { ContextWeight, WeightFile, WeightRow } from '../../types'

import { fileName } from './format'

export type BreakdownInput = {
  categories: readonly { name: string; tokens: number; kind: string }[]
  memoryFiles: readonly { path: string; tokens: number }[]
  autoCompactThreshold?: number
}

const LABELS: Record<string, string> = {
  system: 'System prompt',
  tools: 'Tools/MCP',
  memory: 'Memory files',
  messages: 'Mensagens',
  skills: 'Skills',
  other: 'Outros'
}

const COLORS: Record<string, string> = {
  system: 'blue',
  tools: 'yellow',
  memory: 'green',
  messages: 'cyan',
  skills: 'magenta',
  other: 'white'
}

export const rowColor = (key: string): string => COLORS[key] ?? 'white'

// Row names are whatever /context prints; only `kind` is contract, hence the "other" fallback.
const keyOf = (name: string): string => {
  if (/^messages?$/i.test(name)) return 'messages'
  if (/system prompt/i.test(name)) return 'system'
  if (/memory/i.test(name)) return 'memory'
  if (/tool|mcp|agent/i.test(name)) return 'tools'
  if (/skill|slash|command/i.test(name)) return 'skills'

  return 'other'
}

export const summarizeBreakdown = (breakdown: BreakdownInput, detail: ContextWeight['detail']): ContextWeight => {
  const sums = new Map<string, number>()

  for (const category of breakdown.categories) {
    if (category.kind !== 'used' || category.tokens <= 0) continue

    const key = keyOf(category.name)
    sums.set(key, (sums.get(key) ?? 0) + category.tokens)
  }

  const rows: WeightRow[] = [...sums.entries()]
    .map(([key, tokens]) => ({ key, label: LABELS[key] ?? key, tokens }))
    .sort((a, b) => b.tokens - a.tokens)

  const conversation = sums.get('messages') ?? 0
  const base = rows.reduce((sum, row) => (row.key === 'messages' ? sum : sum + row.tokens), 0)

  const memory: WeightFile[] = [...breakdown.memoryFiles]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(file => ({ name: fileName(file.path), tokens: file.tokens }))

  return { detail, base, conversation, rows, memory, autoCompactAt: breakdown.autoCompactThreshold ?? null }
}
