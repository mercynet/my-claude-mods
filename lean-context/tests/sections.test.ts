import { describe, expect, test } from 'claude-code/testing'

import { driftOf, cutSections, pointerLine, scanHeadings } from '../hooks/lean/sections'

const TITLES = [
  'Section C',
  'Section D (extra notes)',
  'Section A',
  'Section B',
] as const

const FENCE = '```'

const agents = (extra = ''): string =>
  [
    '# AGENTS.md',
    '',
    '## Style rules',
    'No useless comments.',
    '',
    '## Development Guidelines',
    '### Critical Rules',
    '- NEVER skip the review checklist.',
    '',
    '## Section A',
    'Body of section A:',
    '- keep this inside section A',
    '',
    '## Section B',
    '- Body of section B.',
    '',
    '# Closing notes',
    'Do what has been asked.',
    '',
    '- Keep the reminders short.',
    '',
    '## Section C',
    'Body of section C.',
    '',
    '## Section D (extra notes)',
    'Body of section D.',
    extra,
  ].join('\n')

const headings = (text: string): string[] =>
  scanHeadings(text.split('\n')).headings.map(heading => heading.title)

describe('cutSections', () => {
  test('removes exactly the four listed sections and nothing else', () => {
    const result = cutSections(agents(), 'AGENTS.md', TITLES)

    expect(result.cut.map(section => section.title).sort()).toEqual([...TITLES].sort())
    expect(result.missing).toEqual([])
    expect(headings(result.text)).toEqual([
      'AGENTS.md',
      'Style rules',
      'Development Guidelines',
      'Critical Rules',
      'Closing notes',
    ])
    expect(result.text).toContain('No useless comments.')
    expect(result.text).toContain('NEVER skip the review checklist.')
    expect(result.text).not.toContain('Body of section A:')
    expect(result.text).not.toContain('Body of section B.')
    expect(result.text).not.toContain('Body of section C.')
    expect(result.text).not.toContain('Body of section D.')
  })

  test('a level-1 heading ends a cut, so the reminders and the emoji rule survive', () => {
    const result = cutSections(agents(), 'AGENTS.md', TITLES)

    expect(result.text).toContain('# Closing notes')
    expect(result.text).toContain('Do what has been asked.')
    expect(result.text).toContain('- Keep the reminders short.')
  })

  test('each cut leaves one pointer line naming the section', () => {
    const result = cutSections(agents(), 'AGENTS.md', TITLES)
    const pointers = result.text.split('\n').filter(line => line.startsWith('[omitted in lean mode:'))

    expect(pointers).toHaveLength(4)
    for (const section of result.cut) {
      expect(result.text).toContain(pointerLine('AGENTS.md', section.title, section.bytes))
    }
    expect(pointers[0]).toMatch(/^\[omitted in lean mode: AGENTS\.md section Section A, ~\d+\.\d KB; read on demand\]$/)
  })

  test('shell comment lines inside a code fence are not headings', () => {
    const fenced = [
      '## Development Commands',
      FENCE + 'bash',
      '# Pest: narrow the run',
      '## never: the same command without --path',
      FENCE,
      '',
      '## Section A',
      'section A only',
      FENCE,
      '# inside a fence of a cut section',
      '## Section B',
      FENCE,
      'still section A',
      '',
      '## Next Section',
      'kept',
    ].join('\n')

    const result = cutSections(fenced, 'AGENTS.md', TITLES)

    expect(result.cut.map(section => section.title)).toEqual(['Section A'])
    expect(result.text).toContain('# Pest: narrow the run')
    expect(result.text).toContain('## never: the same command without --path')
    expect(result.text).not.toContain('still section A')
    expect(result.text).toContain('## Next Section\nkept')
    expect(result.missing).toContain('Section B')
  })

  test('a listed title that only appears inside a fence is not cut', () => {
    const text = ['## Examples', FENCE, '## Section C', 'not a heading', FENCE, '', '## Other', 'kept'].join('\n')

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.text).toBe(text)
    expect(result.cut).toEqual([])
  })

  test('a section that is not on the list is kept, and ends the cut before it', () => {
    const text = ['## Section C', 'section C text', '', '## Brand New Section', 'new rule', ''].join('\n')

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.text).toContain('## Brand New Section\nnew rule')
    expect(result.text).not.toContain('section C text')
  })

  test('without any listed title the text comes back unchanged', () => {
    const text = '# Title\n\n## Something\nbody\n\n## Something else\nmore\n'

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.text).toBe(text)
    expect(result.cut).toEqual([])
    expect(result.missing).toEqual([...TITLES])
    expect(result.isParseReliable).toBe(true)
  })

  test('only the titles present are cut and the absent ones are reported', () => {
    const text = '## Section C\nx\n\n## Section A\ny\n\n## Keep\nz\n'

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.cut.map(section => section.title)).toEqual(['Section C', 'Section A'])
    expect(result.missing).toEqual([
      'Section D (extra notes)',
      'Section B',
    ])
    expect(result.text).toContain('## Keep\nz')
  })

  test('an unclosed code fence makes the parse unreliable and nothing is cut', () => {
    const text = ['## Section C', 'text', FENCE + 'bash', 'oops never closed', '', '## Critical Rules', 'NEVER do X'].join('\n')

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.isParseReliable).toBe(false)
    expect(result.text).toBe(text)
    expect(result.cut).toEqual([])
  })

  test('a longer closing fence and tilde fences are handled', () => {
    const text = ['## Section A', '~~~', '## Section B', '~~~', 'tail', '', '## Keep', 'kept'].join('\n')

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.cut.map(section => section.title)).toEqual(['Section A'])
    expect(result.text).not.toContain('tail')
    expect(result.text).toContain('## Keep\nkept')
  })

  test('CRLF text is parsed and the titles still match', () => {
    const text = '## Section A\r\nbody A\r\n\r\n## Keep\r\nkept\r\n'

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.cut.map(section => section.title)).toEqual(['Section A'])
    expect(result.text).toContain('## Keep\r\nkept')
  })

  test('the section bytes count the whole removed block', () => {
    const body = 'x'.repeat(100)
    const text = `## Section A\n${body}\n\n## Keep\nkept\n`

    const result = cutSections(text, 'AGENTS.md', TITLES)

    expect(result.cut[0]?.bytes).toBe('## Section A'.length + 1 + 100 + 1 + 0 + 1)
  })
})

describe('driftOf', () => {
  const expected = [{ title: 'Section C', expectedBytes: 1000 }]

  test('stays quiet inside the tolerance', () => {
    expect(driftOf([{ title: 'Section C', bytes: 1200 }], expected, 0.3)).toEqual([])
  })

  test('reports a section that grew or shrank past the tolerance', () => {
    expect(driftOf([{ title: 'Section C', bytes: 2000 }], expected, 0.3)).toEqual([
      { title: 'Section C', expectedBytes: 1000, actualBytes: 2000 },
    ])
    expect(driftOf([{ title: 'Section C', bytes: 100 }], expected, 0.3)).toHaveLength(1)
  })
})
