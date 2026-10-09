import { byteLength, formatKb } from './estimate'

export type Heading = { level: number; title: string; line: number }

export type CutSection = { title: string; bytes: number }

export type CutResult = {
  text: string
  cut: CutSection[]
  missing: string[]
  isParseReliable: boolean
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/
const ATX_CLOSING = /[ \t]+#+$/

export function scanHeadings(lines: readonly string[]): { headings: Heading[]; isBalanced: boolean } {
  const headings: Heading[] = []
  let fence: { char: string; length: number } | undefined

  lines.forEach((raw, line) => {
    const text = raw.replace(/\r$/, '')

    if (fence) {
      const close = FENCE_CLOSE.exec(text)?.[1]
      if (close !== undefined && close.startsWith(fence.char) && close.length >= fence.length) {
        fence = undefined
      }
      return
    }

    const open = FENCE_OPEN.exec(text)
    const marker = open?.[1]
    if (marker !== undefined && !(marker.startsWith('`') && (open?.[2] ?? '').includes('`'))) {
      fence = { char: marker.charAt(0), length: marker.length }
      return
    }

    const heading = ATX_HEADING.exec(text)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      headings.push({
        level: heading[1].length,
        title: heading[2].replace(ATX_CLOSING, '').trim(),
        line,
      })
    }
  })

  return { headings, isBalanced: fence === undefined }
}

export function pointerLine(fileName: string, title: string, bytes: number): string {
  return `[omitted in lean mode: ${fileName} section ${title}, ~${formatKb(bytes)} KB; read on demand]`
}

export function cutSections(text: string, fileName: string, titles: readonly string[]): CutResult {
  const lines = text.split('\n')
  const { headings, isBalanced } = scanHeadings(lines)
  // An unterminated fence hides every later heading, so a cut could run to the end of the file.
  if (!isBalanced) return { text, cut: [], missing: [...titles], isParseReliable: false }

  const boundaries = headings.filter(heading => heading.level <= 2)
  const wanted = new Set(titles)
  const ranges: { title: string; start: number; end: number }[] = []

  boundaries.forEach((heading, index) => {
    if (heading.level === 2 && wanted.has(heading.title)) {
      ranges.push({
        title: heading.title,
        start: heading.line,
        end: boundaries[index + 1]?.line ?? lines.length,
      })
    }
  })

  const found = new Set(ranges.map(range => range.title))
  const missing = titles.filter(title => !found.has(title))
  if (ranges.length === 0) return { text, cut: [], missing, isParseReliable: true }

  const output: string[] = []
  const cut: CutSection[] = []
  let cursor = 0

  for (const range of ranges) {
    const removed = lines.slice(range.start, range.end)
    const bytes = byteLength(removed.join('\n')) + 1
    output.push(...lines.slice(cursor, range.start), pointerLine(fileName, range.title, bytes), '')
    cut.push({ title: range.title, bytes })
    cursor = range.end
  }
  output.push(...lines.slice(cursor))

  return { text: output.join('\n'), cut, missing, isParseReliable: true }
}

export type Drift = { title: string; expectedBytes: number; actualBytes: number }

export function driftOf(
  cut: readonly CutSection[],
  expected: readonly { title: string; expectedBytes: number }[],
  tolerance: number,
): Drift[] {
  return cut.flatMap(section => {
    const reference = expected.find(item => item.title === section.title)
    if (reference === undefined) return []
    const isDrifted = Math.abs(section.bytes - reference.expectedBytes) / reference.expectedBytes > tolerance
    return isDrifted
      ? [{ title: section.title, expectedBytes: reference.expectedBytes, actualBytes: section.bytes }]
      : []
  })
}
