import { describe, expect, test } from 'claude-code/testing'

import { branchFromGit, isSafeBranch, labelOf } from '../hooks/band/branch'
import { parseOptions } from '../hooks/band/config'
import { buildView, formatAge } from '../hooks/band/format'
import { isInside, joinPath } from '../hooks/band/paths'
import { parsePhase } from '../hooks/band/phase'
import { countTasks } from '../hooks/band/tasks'

const FENCE = '```'

describe('countTasks', () => {
  test('counts open and done boxes with any list marker', () => {
    expect(countTasks('- [x] a\n- [ ] b\n* [X] c\n+ [ ] d')).toEqual({ done: 2, total: 4 })
  })

  test('indented boxes count too', () => {
    expect(countTasks('- [ ] parent\n  - [x] child')).toEqual({ done: 1, total: 2 })
  })

  test('a file with no boxes has no count, never 0/0', () => {
    expect(countTasks('# Tasks\n\n## T0 - something\n- What: x')).toBeNull()
    expect(countTasks('')).toBeNull()
  })

  test('boxes inside a code fence are not tasks', () => {
    const text = ['- [x] real', FENCE, '- [ ] example', '- [x] example', FENCE, '- [ ] real too'].join('\n')

    expect(countTasks(text)).toEqual({ done: 1, total: 2 })
  })

  test('text that only looks like a box is ignored', () => {
    expect(countTasks('[x] bare\n- [] empty\n- [y] other\n-[x] glued')).toBeNull()
  })

  test('reads CRLF files', () => {
    expect(countTasks('- [x] a\r\n- [ ] b\r\n')).toEqual({ done: 1, total: 2 })
  })
})

describe('parsePhase', () => {
  test('reads a phase named once in the header prose', () => {
    expect(parsePhase('# STATE\n\nActive spec: x - Phase B; more.\n\n## Decisions\n- Phase A was earlier')).toBe('B')
  })

  test('a keyed line wins and the last one counts', () => {
    expect(parsePhase('# S\nphase: A\n\n## Log\nphase: C (done)\n')).toBe('C')
    expect(parsePhase('- phase: review\n')).toBe('review')
  })

  test('several different phases in the header are ambiguous', () => {
    expect(parsePhase('# S\n- one - Phase A\n- two - Phase B\n\n## Decisions\n')).toBeNull()
  })

  test('the same phase repeated is not ambiguous', () => {
    expect(parsePhase('# S\nPhase B started. Still Phase B.\n')).toBe('B')
  })

  test('phases mentioned below the first section are not read', () => {
    expect(parsePhase('# S\n\n## Decisions\n- Phase A closed\n')).toBeNull()
  })

  test('no phase and unparseable text give nothing', () => {
    expect(parsePhase('')).toBeNull()
    expect(parsePhase('# S\nphase: soon\nPhase d\n')).toBeNull()
  })

  test('the Portuguese word is read as well', () => {
    expect(parsePhase('# S\nfase: B\n')).toBe('B')
  })
})

describe('branch', () => {
  test('a numeric prefix is the label', () => {
    expect(labelOf('42-example-feature')).toBe('42')
  })

  test('a name without a prefix is shortened', () => {
    expect(labelOf('feature/short')).toBe('feature/short')
    expect(labelOf('a-very-long-branch-name-without-an-id')).toHaveLength(24)
    expect(labelOf('a-very-long-branch-name-without-an-id').endsWith('…')).toBe(true)
  })

  test('git output becomes a branch, or unknown on failure or detached HEAD', () => {
    expect(branchFromGit({ exitCode: 0, stdout: '42-x\n' })).toEqual({ kind: 'branch', name: '42-x' })
    expect(branchFromGit({ exitCode: 128, stdout: '' }).kind).toBe('unknown')
    expect(branchFromGit({ exitCode: 0, stdout: '\n' }).kind).toBe('unknown')
  })

  test('a name that could leave the specs folder is refused', () => {
    expect(isSafeBranch('../x')).toBe(false)
    expect(isSafeBranch('/abs')).toBe(false)
    expect(isSafeBranch('a\\b')).toBe(false)
    expect(branchFromGit({ exitCode: 0, stdout: '../x\n' }).kind).toBe('unknown')
    expect(isSafeBranch('feature/x')).toBe(true)
  })
})

describe('formatAge and buildView', () => {
  test('ages read as now, minutes, hours and days', () => {
    expect(formatAge(0)).toBe('agora')
    expect(formatAge(59_000)).toBe('agora')
    expect(formatAge(3 * 60_000)).toBe('3 min')
    expect(formatAge(3 * 60 * 60_000)).toBe('3 h')
    expect(formatAge(47 * 60 * 60_000)).toBe('47 h')
    expect(formatAge(3 * 24 * 60 * 60_000)).toBe('3 d')
  })

  const base = {
    label: '42',
    tasks: { done: 7, total: 12 },
    stateFile: 'STATE.md',
    ageMs: 3 * 60_000,
    phase: 'B' as const,
    edits: 0,
    staleAfterEdits: 15,
  }

  test('the full line', () => {
    expect(buildView(base)).toEqual({ text: '42 · tarefas 7/12 · STATE 3 min · fase B', isStale: false })
  })

  test('missing segments are left out', () => {
    expect(buildView({ ...base, tasks: null, phase: null }).text).toBe('42 · STATE 3 min')
    expect(buildView({ ...base, ageMs: null }).text).toBe('42 · tarefas 7/12 · fase B')
  })

  test('the warning appears at the threshold, not before', () => {
    expect(buildView({ ...base, edits: 14 }).isStale).toBe(false)
    const stale = buildView({ ...base, edits: 15 })

    expect(stale.isStale).toBe(true)
    expect(stale.text).toBe('42 · tarefas 7/12 · STATE 3 min · fase B · STATE.md sem atualizar há 15 edições')
  })

  test('a missing state file never warns', () => {
    expect(buildView({ ...base, ageMs: null, edits: 99 }).isStale).toBe(false)
  })

  test('a negative age from clock skew reads as now', () => {
    expect(buildView({ ...base, ageMs: -5000 }).text).toContain('STATE agora')
  })

  test('the warning names the configured state file and the singular edit', () => {
    expect(buildView({ ...base, stateFile: 'NOTES.md', edits: 1, staleAfterEdits: 1 }).text).toContain(
      'NOTES.md sem atualizar há 1 edição',
    )
  })
})

describe('parseOptions', () => {
  test('defaults', () => {
    expect(parseOptions({})).toEqual({
      specsDir: 'specs/_active',
      tasksFile: 'tasks.md',
      stateFile: 'STATE.md',
      staleAfterEdits: 15,
    })
  })

  test('the threshold takes a number or a numeric string and refuses the rest', () => {
    expect(parseOptions({ staleAfterEdits: 5 }).staleAfterEdits).toBe(5)
    expect(parseOptions({ staleAfterEdits: ' 8 ' }).staleAfterEdits).toBe(8)
    expect(parseOptions({ staleAfterEdits: 0 }).staleAfterEdits).toBe(15)
    expect(parseOptions({ staleAfterEdits: 2.5 }).staleAfterEdits).toBe(15)
    expect(parseOptions({ staleAfterEdits: 'many' }).staleAfterEdits).toBe(15)
    expect(parseOptions({ staleAfterEdits: true }).staleAfterEdits).toBe(15)
  })

  test('paths that could escape the project fall back to the default', () => {
    expect(parseOptions({ specsDir: '../outside' }).specsDir).toBe('specs/_active')
    expect(parseOptions({ specsDir: '/abs' }).specsDir).toBe('specs/_active')
    expect(parseOptions({ stateFile: '' }).stateFile).toBe('STATE.md')
    expect(parseOptions({ specsDir: 'work/specs/' }).specsDir).toBe('work/specs')
  })
})

describe('paths', () => {
  test('joins without doubling separators', () => {
    expect(joinPath('/srv/app/', '/specs')).toBe('/srv/app/specs')
  })

  test('a relative path is inside, an absolute one only under the root', () => {
    expect(isInside('/srv/app', 'src/a.ts')).toBe(true)
    expect(isInside('/srv/app', '/srv/app/src/a.ts')).toBe(true)
    expect(isInside('/srv/app', '/srv/app-other/a.ts')).toBe(false)
    expect(isInside('/srv/app', '/tmp/notes.md')).toBe(false)
    expect(isInside('/srv/app/', 'C:\\elsewhere\\a.ts')).toBe(false)
  })
})
