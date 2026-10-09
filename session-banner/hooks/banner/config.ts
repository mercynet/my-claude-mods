import { parseStops } from './color'
import type { Rgb } from './color'

export const COMMAND = 'banner'

export const DEFAULT_ART_FILE = '~/.claude/banner.txt'

export const DEFAULT_COLORS: readonly Rgb[] = [
  [0x1f, 0x6f, 0xb2],
  [0x52, 0xb6, 0xec],
]

export const FRAME_MS = 66

export const SWEEP_FRAMES = 22

export const MAX_ART_BYTES = 65_536

export const MAX_COLUMNS = 512

export const MAX_ROWS = 64

export const MAX_STOPS = 8

export const MAX_TAGLINE = 80

export const MAX_LINGER_SECONDS = 3600

export const NO_TAGLINE = '-'

export const MIN_VISIBLE_SHARE = 0.6

export type BannerOptions = {
  artFile: string
  colors: readonly Rgb[]
  tagline: string
  lingerSeconds: number
}

const textOption = (value: unknown, fallback: string, max: number): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > max || /[\x00-\x1f]/.test(trimmed) ? fallback : trimmed
}

const lingerOption = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(MAX_LINGER_SECONDS, Math.floor(parsed)) : 0
}

export function parseOptions(raw: Readonly<Record<string, unknown>>): BannerOptions {
  return {
    artFile: textOption(raw.artFile, DEFAULT_ART_FILE, 512),
    colors: parseStops(raw.colors, MAX_STOPS) ?? DEFAULT_COLORS,
    tagline: textOption(raw.tagline, '', MAX_TAGLINE),
    lingerSeconds: lingerOption(raw.lingerSeconds),
  }
}
