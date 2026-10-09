import type { Art } from './art'
import { packCells } from './base64'
import { DEFAULT_BG, DEFAULT_FG, NEUTRAL, darken, gradient, lighten, mix, smoothstep, toInt } from './color'
import type { Rgb } from './color'
import { SWEEP_FRAMES } from './config'
import type { Plan } from './plan'

export type Look = {
  stops: readonly Rgb[]
  isColor: boolean
  frame: number
}

export type Grid = {
  columns: number
  rows: number
  cells: string
}

export const SHEEN_TOP = 0.08

export const SHEEN_BOTTOM = 0.06

export const SHIMMER_HALF = 5

export const SHIMMER_SLOPE = 1.5

export const SHIMMER_STRENGTH = 0.6

export const RULE_FADE_SHARE = 0.2

export const RULE_FADE_STRENGTH = 0.65

export const RULE_GLYPH = '━'

export const RULE_GLYPH_PLAIN = '─'

const SPACE = 0x20

export function gradientPosition(art: Art, x: number): number {
  if (art.inkMax === art.inkMin) return 0
  return Math.min(1, Math.max(0, (x - art.inkMin) / (art.inkMax - art.inkMin)))
}

export function sheen(color: Rgb, y: number, height: number): Rgb {
  if (height < 2) return color
  const t = y / (height - 1)
  return t < 0.5 ? lighten(color, (SHEEN_TOP * (0.5 - t)) / 0.5) : darken(color, (SHEEN_BOTTOM * (t - 0.5)) / 0.5)
}

export function shimmerAmount(x: number, y: number, frame: number, width: number, height: number): number {
  if (frame <= 0 || frame >= SWEEP_FRAMES) return 0
  const span = width - 1 + SHIMMER_SLOPE * (height - 1)
  const position = -SHIMMER_HALF + (frame / SWEEP_FRAMES) * (span + 2 * SHIMMER_HALF)
  const distance = Math.abs(x + SHIMMER_SLOPE * y - position)
  return smoothstep(1 - distance / SHIMMER_HALF)
}

const withShimmer = (color: Rgb, art: Art, x: number, y: number, look: Look): Rgb => {
  const amount = shimmerAmount(x, y, look.frame, art.width, art.height)
  return amount > 0 ? lighten(color, SHIMMER_STRENGTH * amount) : color
}

export const inkColor = (art: Art, x: number, y: number, look: Look): Rgb =>
  withShimmer(sheen(gradient(look.stops, gradientPosition(art, x)), y, art.height), art, x, y, look)

export function ruleColor(art: Art, x: number, look: Look): Rgb {
  const length = art.inkMax - art.inkMin + 1
  const edge = Math.max(2, Math.round(length * RULE_FADE_SHARE))
  const fromEnd = Math.min(x - art.inkMin, art.inkMax - x)
  const fade = 1 - smoothstep(fromEnd / edge)
  const base = mix(gradient(look.stops, gradientPosition(art, x)), NEUTRAL, RULE_FADE_STRENGTH * fade)
  return withShimmer(base, art, x, art.height, look)
}

export function buildGrid(art: Art, plan: Plan, look: Look): Grid {
  const rows = art.height + (plan.hasRule ? 1 : 0)
  const cells: [number, number, number][] = []

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < plan.columns; x += 1) {
      if (y < art.height) {
        const glyph = art.rows[y]?.[x] ?? ' '
        const isInk = glyph !== ' '
        const foreground = isInk && look.isColor ? toInt(inkColor(art, x, y, look)) : DEFAULT_FG
        cells.push([isInk ? (glyph.codePointAt(0) ?? SPACE) : SPACE, foreground, DEFAULT_BG])
        continue
      }

      const isRule = x >= art.inkMin && x <= art.inkMax
      const glyph = look.isColor ? RULE_GLYPH : RULE_GLYPH_PLAIN
      const foreground = isRule && look.isColor ? toInt(ruleColor(art, x, look)) : DEFAULT_FG
      cells.push([isRule ? (glyph.codePointAt(0) ?? SPACE) : SPACE, foreground, DEFAULT_BG])
    }
  }

  return { columns: plan.columns, rows, cells: packCells(cells) }
}

export function plainLines(art: Art, plan: Plan): string[] {
  const lines = art.rows.map(row => row.slice(0, plan.columns).join('').trimEnd())
  if (!plan.hasRule) return lines
  const rule = RULE_GLYPH_PLAIN.repeat(Math.max(0, Math.min(art.inkMax, plan.columns - 1) - art.inkMin + 1))
  return [...lines, ' '.repeat(art.inkMin) + rule]
}
