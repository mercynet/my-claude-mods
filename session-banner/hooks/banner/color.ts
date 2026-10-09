export type Rgb = readonly [number, number, number]

export const DEFAULT_FG = 0x01000000

export const DEFAULT_BG = 0x01000000

const WHITE: Rgb = [255, 255, 255]

const BLACK: Rgb = [0, 0, 0]

export const NEUTRAL: Rgb = [122, 133, 144]

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function parseHex(text: string): Rgb | null {
  const match = HEX.exec(text.trim())
  if (match === null) return null
  const group = match[1] ?? ''
  const digits = group.length === 3 ? [...group].map(digit => digit + digit).join('') : group
  const value = Number.parseInt(digits, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function parseStops(text: unknown, max: number): Rgb[] | null {
  if (typeof text !== 'string') return null
  const parts = text.split(',')
  if (parts.length === 0 || parts.length > max) return null
  const stops: Rgb[] = []
  for (const part of parts) {
    const stop = parseHex(part)
    if (stop === null) return null
    stops.push(stop)
  }
  return stops
}

export const smoothstep = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

export const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * t),
  Math.round(from[1] + (to[1] - from[1]) * t),
  Math.round(from[2] + (to[2] - from[2]) * t),
]

export function gradient(stops: readonly Rgb[], t: number): Rgb {
  const first = stops[0] ?? NEUTRAL
  if (stops.length === 1) return first
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  return mix(stops[index] ?? first, stops[index + 1] ?? first, smoothstep(scaled - index))
}

export const lighten = (color: Rgb, amount: number): Rgb => mix(color, WHITE, amount)

export const darken = (color: Rgb, amount: number): Rgb => mix(color, BLACK, amount)

export const toInt = (color: Rgb): number => (color[0] << 16) | (color[1] << 8) | color[2]
