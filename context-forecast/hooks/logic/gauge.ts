export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }

export type GaugeMark = { at: number; color: string }

export const FILL = '█'
export const TRACK = '░'
export const MARK = '│'
export const TRACK_COLOR = 'inactive'

const clamp = (n: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, n))

// Consecutive cells with the same look collapse into one span, so a gauge stays a handful of nodes.
export const mergeSpans = (spans: readonly Span[]): Span[] =>
  spans.reduce<Span[]>((merged, span) => {
    const last = merged.at(-1)

    if (last !== undefined && last.color === span.color && last.dim === span.dim && last.bold === span.bold) {
      return [...merged.slice(0, -1), { ...last, text: last.text + span.text }]
    }

    return [...merged, span]
  }, [])

// `ratio` fills the track from the left; each mark draws a thin line at its own position on the same scale,
// and a mark at or past the end of the scale is left out because it would sit outside the gauge.
export const gaugeSpans = (ratio: number, width: number, fillColor: string, marks: readonly GaugeMark[] = []): Span[] => {
  const filled = clamp(Math.round(ratio * width), ratio > 0 ? 1 : 0, width)
  const cells: Span[] = Array.from({ length: width }, (_, i) =>
    i < filled ? { text: FILL, color: fillColor } : { text: TRACK, color: TRACK_COLOR }
  )

  for (const mark of marks) {
    const index = Math.floor(mark.at * width)

    if (index >= 0 && index < width) cells[index] = { text: MARK, color: mark.color, bold: true }
  }

  return mergeSpans(cells)
}

export const limitColor = (percent: number): string => (percent < 60 ? 'green' : percent < 85 ? 'yellow' : 'red')
