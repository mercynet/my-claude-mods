import { describe, expect, test } from 'claude-code/testing'

import { BYTES_PER_TOKEN, formatInt, formatKb, formatKbPt, formatTokens, tokensFromBytes } from '../hooks/lean/estimate'
import { branchFromGit, decideMode, isSafeBranch } from '../hooks/lean/mode'
import type { BranchProbe, SpecProbe } from '../hooks/lean/mode'
import { baseName, dirName, joinPath } from '../hooks/lean/paths'

const onBranch: BranchProbe = { kind: 'branch', name: 'feature-x' }
const present: SpecProbe = { kind: 'present' }
const absent: SpecProbe = { kind: 'absent' }

describe('decideMode', () => {
  test('a spec directory for the branch means full', () => {
    expect(decideMode({ branch: onBranch, spec: present })).toMatchObject({ mode: 'full', reason: 'active-spec' })
  })

  test('no spec and no override means lean', () => {
    expect(decideMode({ branch: onBranch, spec: absent })).toMatchObject({ mode: 'lean', reason: 'no-spec' })
  })

  test('the full override wins over an absent spec', () => {
    expect(decideMode({ override: 'full', branch: onBranch, spec: absent })).toMatchObject({
      mode: 'full',
      reason: 'override',
    })
  })

  test('the lean override wins over an active spec', () => {
    expect(decideMode({ override: 'lean', branch: onBranch, spec: present })).toMatchObject({
      mode: 'lean',
      reason: 'override',
    })
  })

  test('an unknown branch fails open to full', () => {
    const branch: BranchProbe = { kind: 'unknown', why: 'git unavailable' }

    expect(decideMode({ branch, spec: absent })).toMatchObject({ mode: 'full', reason: 'unknown-branch' })
  })

  test('an unverifiable spec fails open to full', () => {
    const spec: SpecProbe = { kind: 'unknown', why: '_active not found' }

    expect(decideMode({ branch: onBranch, spec })).toMatchObject({ mode: 'full', reason: 'unknown-spec' })
  })
})

describe('branchFromGit', () => {
  test('reads the branch name from stdout', () => {
    expect(branchFromGit({ exitCode: 0, stdout: 'feature/x\n' })).toEqual({ kind: 'branch', name: 'feature/x' })
  })

  test('a git failure is an unknown branch', () => {
    expect(branchFromGit({ exitCode: 128, stdout: '' }).kind).toBe('unknown')
  })

  test('a detached HEAD prints nothing and is unknown', () => {
    expect(branchFromGit({ exitCode: 0, stdout: '\n' }).kind).toBe('unknown')
  })

  test('a name that could escape the specs folder is refused', () => {
    expect(isSafeBranch('../etc')).toBe(false)
    expect(isSafeBranch('/abs')).toBe(false)
    expect(isSafeBranch('a\\b')).toBe(false)
    expect(isSafeBranch('feature-x-epic')).toBe(true)
    expect(branchFromGit({ exitCode: 0, stdout: '../x\n' }).kind).toBe('unknown')
  })
})

describe('estimate and paths', () => {
  test('tokens are bytes over four', () => {
    expect(BYTES_PER_TOKEN).toBe(4)
    expect(tokensFromBytes(16463)).toBe(4116)
  })

  test('the model-facing size uses a dot and the panel size a comma', () => {
    expect(formatKb(7567)).toBe('7.4')
    expect(formatKbPt(7567)).toBe('7,4')
  })

  test('panel numbers are formatted the way the owner writes them', () => {
    expect(formatInt(34392)).toBe('34 392')
    expect(formatTokens(4116)).toBe('4,1k')
    expect(formatTokens(950)).toBe('950')
  })

  test('paths split on both separators', () => {
    expect(baseName('/srv/example/example-app/AGENTS.md')).toBe('AGENTS.md')
    expect(baseName('C:\\work\\example-app\\AGENTS.md')).toBe('AGENTS.md')
    expect(dirName('/srv/example/example-app/AGENTS.md')).toBe('/srv/example/example-app')
    expect(joinPath('/srv/example/', '/docs/specs')).toBe('/srv/example/docs/specs')
  })
})
