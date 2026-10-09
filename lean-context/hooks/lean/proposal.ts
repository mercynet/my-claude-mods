import { MATERIAL_SHARE, MIN_SAMPLES, NEGLIGIBLE_SHARE, RESURFACE_GAIN } from './config'
import { formatInt, formatPercent, formatTokens } from './estimate'
import { abStats } from './records'
import type { ConversationRecord } from './records'

export type Verdict = 'negligible' | 'modest' | 'material'

export const verdictOf = (share: number): Verdict =>
  share < NEGLIGIBLE_SHARE ? 'negligible' : share < MATERIAL_SHARE ? 'modest' : 'material'

export type Dismissal = { at: number; share: number }

export type Dismissals = Record<string, Dismissal>

export type Proposal = {
  projectDir: string
  share: number
  savedTokens: number
  baselineTokens: number
  samples: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseDismissals(value: unknown): Dismissals {
  if (!isRecord(value)) return {}
  const dismissals: Dismissals = {}
  for (const [dir, entry] of Object.entries(value)) {
    if (isRecord(entry) && typeof entry.at === 'number' && typeof entry.share === 'number') {
      dismissals[dir] = { at: entry.at, share: entry.share }
    }
  }
  return dismissals
}

// Only simulated lean conversations of this project count: the history is shared by every project the mod has seen.
export function measuredShare(
  history: readonly ConversationRecord[],
  projectDir: string,
): Omit<Proposal, 'projectDir'> | undefined {
  const own = history.filter(record => record.projectDir === projectDir)
  const { n, meanTokens } = abStats(own).withoutCut
  if (n === 0 || meanTokens === undefined || meanTokens <= 0) return undefined
  const savedTokens = own.at(-1)?.savedTokens ?? 0
  return { share: savedTokens / meanTokens, savedTokens, baselineTokens: meanTokens, samples: n }
}

export function proposalFor(
  history: readonly ConversationRecord[],
  projectDir: string,
  isApplied: boolean,
  dismissals: Dismissals,
): Proposal | undefined {
  if (isApplied) return undefined
  const measured = measuredShare(history, projectDir)
  if (measured === undefined || measured.samples < MIN_SAMPLES) return undefined
  if (verdictOf(measured.share) !== 'material') return undefined

  const dismissed = dismissals[projectDir]
  if (dismissed !== undefined && measured.share < dismissed.share + RESURFACE_GAIN) return undefined
  return { projectDir, ...measured }
}

export function proposalText(proposal: Proposal): string {
  return `lean-context: em ${proposal.samples} conversas sem spec ativa neste projeto, o corte pouparia ~${formatTokens(proposal.savedTokens)} tokens = ${formatPercent(proposal.share)} do 1o pedido (media ${formatInt(proposal.baselineTokens)}). /lean apply para aplicar, /lean dismiss para nao voltar a propor.`
}
