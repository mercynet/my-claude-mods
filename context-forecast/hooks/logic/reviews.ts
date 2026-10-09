import type { ClearSample, RereadProbe, Review, ToolStat, Verdict } from '../../types'

import { compactNumber } from './format'
import type { Assessment } from './score'
import { median } from './thresholds'

export const VERDICTS: readonly Verdict[] = ['cedo', 'certo', 'tarde']

export const MAX_REVIEWS = 60
export const MIN_RATED = 5
export const REREAD_TURNS = 10
export const PROBE_TTL_MS = 6 * 3_600_000

const RECENT_TURNS = 5
const MIN_CALLS = 10
const MAX_STATS = 2 * RECENT_TURNS
const MAX_READS = 60
const MAX_REASONS = 3

// Instructions and handoff files are read again after a clear on purpose; only other re-reads cost anything.
const READ_ON_PURPOSE = /(^|\/)(STATE|MEMORY|CLAUDE|AGENTS|RTK)\.md$|(^|\/)resume-prompt\.md$|\/memory\//

export const isVerdict = (value: string): value is Verdict => (VERDICTS as readonly string[]).includes(value)

export const recordToolStat = (stats: readonly ToolStat[], turn: number, failed: boolean): ToolStat[] => {
  const last = stats.at(-1)
  const sameTurn = last !== undefined && last.turn === turn
  const before = sameTurn ? stats.slice(0, -1) : [...stats]
  const current = sameTurn ? last : { turn, calls: 0, errors: 0 }

  return [...before, { turn, calls: current.calls + 1, errors: current.errors + (failed ? 1 : 0) }].slice(-MAX_STATS)
}

const errorShare = (stats: readonly ToolStat[]): number | null => {
  const calls = stats.reduce((sum, s) => sum + s.calls, 0)

  if (calls < MIN_CALLS) return null

  return Math.round((stats.reduce((sum, s) => sum + s.errors, 0) / calls) * 1000) / 1000
}

// A rate that climbs in the last turns is what a context that outlived its usefulness looks like.
export const errorRates = (
  stats: readonly ToolStat[],
  turns: number
): { recent: number | null; earlier: number | null } => ({
  recent: errorShare(stats.filter(s => s.turn > turns - RECENT_TURNS)),
  earlier: errorShare(stats.filter(s => s.turn <= turns - RECENT_TURNS && s.turn > turns - 2 * RECENT_TURNS))
})

export const withRead = (reads: readonly string[], path: string): string[] =>
  [...reads.filter(known => known !== path), path].slice(-MAX_READS)

export const rereadShare = (before: readonly string[], after: readonly string[]): number | null => {
  const seen = new Set(before)
  const counted = after.filter(path => !READ_ON_PURPOSE.test(path))

  if (counted.length === 0) return null

  return Math.round((counted.filter(path => seen.has(path)).length / counted.length) * 100) / 100
}

export type ReviewInput = {
  at: number
  reason: Review['reason']
  tokens: number
  window: number
  assessment: Assessment
  stats: readonly ToolStat[]
  turns: number
}

export const makeReview = (input: ReviewInput): Review => {
  const rates = errorRates(input.stats, input.turns)

  return {
    at: input.at,
    reason: input.reason,
    tokens: input.tokens,
    window: input.window,
    verdict: null,
    probes: {
      warned: input.assessment.level !== 'none',
      points: input.assessment.points,
      reasons: input.assessment.reasons.slice(0, MAX_REASONS).map(reason => reason.text),
      errorRecent: rates.recent,
      errorEarlier: rates.earlier,
      reread: null
    }
  }
}

export const withReview = (reviews: readonly Review[], review: Review): Review[] =>
  [...reviews, review].slice(-MAX_REVIEWS)

export const withReread = (reviews: readonly Review[], at: number, share: number | null): Review[] =>
  reviews.map(review => (review.at === at ? { ...review, probes: { ...review.probes, reread: share } } : review))

const reviewLine = (review: Review): string => {
  const percent = review.window === 0 ? 0 : Math.round((review.tokens / review.window) * 100)
  const warned = review.probes.warned ? `o mod tinha avisado (${review.probes.points} pontos)` : 'o mod não tinha avisado'

  return `${review.reason === 'clear' ? 'clear' : 'compact'} a ${compactNumber(review.tokens)} (${percent}% da janela), ${warned}`
}

// Rates the latest clear or compact. Without a valid verdict nothing changes and the reply says what to type.
export const rateLatest = (reviews: readonly Review[], argument: string): { reviews: Review[]; text: string } => {
  const last = reviews.at(-1)

  if (last === undefined) return { reviews: [], text: 'Ainda não há clear nem compact para avaliar.' }

  const word = argument.trim().toLowerCase()

  if (!isVerdict(word)) {
    const current = last.verdict === null ? 'sem avaliação' : `avaliado como ${last.verdict}`

    return { reviews: [...reviews], text: `Último: ${reviewLine(last)}, ${current}.\nUse: /forecast rate cedo | certo | tarde` }
  }

  return {
    reviews: [...reviews.slice(0, -1), { ...last, verdict: word }],
    text: `Avaliação registada: ${word}, para o ${reviewLine(last)}.`
  }
}

// Once enough clears are rated "certo", only those say where the person really clears.
export const ratedSamples = (samples: readonly ClearSample[], reviews: readonly Review[]): ClearSample[] => {
  const right = reviews
    .filter(review => review.verdict === 'certo')
    .map(review => ({ tokens: review.tokens, window: review.window, reason: review.reason, at: review.at }))

  return right.length >= MIN_RATED ? right : [...samples]
}

export const reviewsSummary = (reviews: readonly Review[]): string[] => {
  if (reviews.length === 0) return []

  const rated = reviews.filter(review => review.verdict !== null)
  const lines = [`avaliações: ${rated.length} de ${reviews.length} (/forecast rate cedo|certo|tarde)`]

  for (const verdict of VERDICTS) {
    const chosen = reviews.filter(review => review.verdict === verdict)

    if (chosen.length > 0) {
      lines.push(`- ${verdict}: ${chosen.length}, mediana ${compactNumber(Math.round(median(chosen.map(r => r.tokens)) ?? 0))}`)
    }
  }

  if (rated.length > 0) {
    lines.push(`- o mod tinha avisado em ${rated.filter(review => review.probes.warned).length} de ${rated.length} avaliados`)
  }

  const calibrating = reviews.filter(review => review.verdict === 'certo').length >= MIN_RATED

  lines.push(
    calibrating
      ? 'limiares calibrados só com os clears avaliados como certo'
      : `limiares usam todos os clears; com ${MIN_RATED} avaliados como certo passam a usar só esses`
  )

  return lines
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null)

export const readReviews = (stored: unknown): Review[] => {
  if (!Array.isArray(stored)) return []

  return stored.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []

    const { at, reason, tokens, window, verdict, probes } = item as Record<string, unknown>

    if (typeof at !== 'number' || typeof tokens !== 'number' || typeof window !== 'number') return []
    if (reason !== 'clear' && reason !== 'compact') return []
    if (verdict !== null && !(typeof verdict === 'string' && isVerdict(verdict))) return []
    if (typeof probes !== 'object' || probes === null) return []

    const p = probes as Record<string, unknown>

    return [
      {
        at,
        reason,
        tokens,
        window,
        verdict: verdict as Verdict | null,
        probes: {
          warned: p.warned === true,
          points: asNumber(p.points) ?? 0,
          reasons: Array.isArray(p.reasons) ? p.reasons.filter((r): r is string => typeof r === 'string') : [],
          errorRecent: asNumber(p.errorRecent),
          errorEarlier: asNumber(p.errorEarlier),
          reread: asNumber(p.reread)
        }
      }
    ]
  })
}

export const readProbe = (stored: unknown, now: number): RereadProbe | null => {
  if (typeof stored !== 'object' || stored === null) return null

  const { reviewAt, before } = stored as Record<string, unknown>

  if (typeof reviewAt !== 'number' || now - reviewAt > PROBE_TTL_MS || !Array.isArray(before)) return null

  return { reviewAt, before: before.filter((path): path is string => typeof path === 'string'), after: [] }
}
