import type { Phase } from '../../types'

const KEYED = /^\s*(?:[-*]\s*)?(?:[Pp]hase|[Ff]ase):\s*(A|B|C|review)\b/gm

const PROSE = /\b(?:[Pp]hase|[Ff]ase)\s+(A|B|C|review)\b/g

// A keyed checkpoint line is authoritative; prose is read only above the first
// section heading, where a state file names its current phase once. Several
// distinct phases there describe other work, so none is claimed.
export function parsePhase(text: string): Phase | null {
  const keyed = [...text.matchAll(KEYED)].map(match => match[1])
  const lastKeyed = keyed[keyed.length - 1]
  if (lastKeyed !== undefined) return lastKeyed as Phase

  const header = text.split(/^## /m)[0] ?? ''
  const found = new Set([...header.matchAll(PROSE)].map(match => match[1]))
  if (found.size !== 1) return null
  return [...found][0] as Phase
}
