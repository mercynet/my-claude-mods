import type { SessionContextBreakdown } from 'claude-code'

import { baseName } from './paths'

export type Weights = {
  totalTokens: number
  maxTokens: number
  categories: { name: string; tokens: number; kind: string }[]
  skills?: { total: number; included: number; tokens: number }
  slashCommandTokens?: number
  agentTokens: number
  mcp: { server: string; tools: number; loaded: number; loadedTokens: number }[]
  memory: { file: string; type: string; tokens: number }[]
}

export function summarizeBreakdown(breakdown: SessionContextBreakdown): Weights {
  const servers = new Map<string, Weights['mcp'][number]>()
  for (const tool of breakdown.mcpTools) {
    const entry = servers.get(tool.serverName) ?? {
      server: tool.serverName,
      tools: 0,
      loaded: 0,
      loadedTokens: 0,
    }
    entry.tools += 1
    if (tool.isLoaded) {
      entry.loaded += 1
      entry.loadedTokens += tool.tokens
    }
    servers.set(tool.serverName, entry)
  }

  return {
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.maxTokens,
    categories: breakdown.categories.map(({ name, tokens, kind }) => ({ name, tokens, kind })),
    skills: breakdown.skills && {
      total: breakdown.skills.totalSkills,
      included: breakdown.skills.includedSkills,
      tokens: breakdown.skills.tokens,
    },
    slashCommandTokens: breakdown.slashCommands?.tokens,
    agentTokens: breakdown.agents.reduce((sum, agent) => sum + agent.tokens, 0),
    mcp: [...servers.values()].sort((a, b) => b.loadedTokens - a.loadedTokens),
    memory: breakdown.memoryFiles
      .map(file => ({ file: baseName(file.path), type: file.type, tokens: file.tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}
