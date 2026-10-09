import { MAX_ART_BYTES, MAX_COLUMNS, MAX_ROWS } from './config'

export type Art = {
  rows: readonly (readonly string[])[]
  width: number
  height: number
  inkMin: number
  inkMax: number
}

const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
]

const isCombining = (code: number): boolean =>
  (code >= 0x0300 && code <= 0x036f) || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f)

export function isDrawable(code: number): boolean {
  if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) return false
  if (code > 0xffff || (code >= 0xd800 && code <= 0xdfff) || code === 0xfeff) return false
  return !isCombining(code) && !WIDE_RANGES.some(([from, to]) => code >= from && code <= to)
}

const cellOf = (glyph: string): string => {
  const code = glyph.codePointAt(0) ?? 0x20
  return glyph === ' ' || !isDrawable(code) ? ' ' : glyph
}

export function parseArt(text: string): Art | null {
  if (text.length > MAX_ART_BYTES) return null

  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n')
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  if (lines.length === 0 || lines.length > MAX_ROWS) return null

  const grid = lines.map(line => Array.from(line).slice(0, MAX_COLUMNS).map(cellOf))
  const width = Math.max(...grid.map(row => row.length))
  const rows = grid.map(row => [...row, ...Array<string>(width - row.length).fill(' ')])

  let inkMin = width
  let inkMax = -1
  for (const row of rows) {
    row.forEach((glyph, x) => {
      if (glyph === ' ') return
      inkMin = Math.min(inkMin, x)
      inkMax = Math.max(inkMax, x)
    })
  }

  return inkMax < 0 ? null : { rows, width, height: rows.length, inkMin, inkMax }
}
