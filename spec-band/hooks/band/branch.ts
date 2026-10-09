import { LABEL_MAX } from './config'

export type BranchProbe = { kind: 'branch'; name: string } | { kind: 'unknown' }

export const isSafeBranch = (name: string): boolean =>
  name !== '' &&
  !name.startsWith('/') &&
  !name.includes('..') &&
  !name.includes('\\') &&
  !/[\x00-\x1f]/.test(name)

export function branchFromGit(output: { exitCode: number; stdout: string }): BranchProbe {
  if (output.exitCode !== 0) return { kind: 'unknown' }
  const name = output.stdout.trim()
  return isSafeBranch(name) ? { kind: 'branch', name } : { kind: 'unknown' }
}

export function labelOf(branch: string): string {
  const id = /^(\d+)-/.exec(branch)?.[1]
  if (id !== undefined) return id
  return branch.length > LABEL_MAX ? `${branch.slice(0, LABEL_MAX - 1)}…` : branch
}
