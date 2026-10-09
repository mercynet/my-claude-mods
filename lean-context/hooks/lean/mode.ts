export type Mode = 'lean' | 'full'

export type Reason = 'override' | 'active-spec' | 'no-spec' | 'unknown-branch' | 'unknown-spec'

export type BranchProbe = { kind: 'branch'; name: string } | { kind: 'unknown'; why: string }

export type SpecProbe = { kind: 'present' } | { kind: 'absent' } | { kind: 'unknown'; why: string }

export type Decision = { mode: Mode; reason: Reason; detail: string }

export type ModeSignals = { override?: Mode; branch: BranchProbe; spec: SpecProbe }

export const isSafeBranch = (name: string): boolean =>
  name !== '' &&
  !name.startsWith('/') &&
  !name.includes('..') &&
  !name.includes('\\') &&
  !/[\x00-\x1f]/.test(name)

export function branchFromGit(output: { exitCode: number; stdout: string }): BranchProbe {
  if (output.exitCode !== 0) return { kind: 'unknown', why: `git terminou com codigo ${output.exitCode}` }
  const name = output.stdout.trim()
  if (name === '') return { kind: 'unknown', why: 'HEAD destacado ou sem branch' }
  if (!isSafeBranch(name)) return { kind: 'unknown', why: 'nome de branch invalido' }
  return { kind: 'branch', name }
}

export function decideMode(signals: ModeSignals): Decision {
  if (signals.override !== undefined) {
    return { mode: signals.override, reason: 'override', detail: `/lean mode ${signals.override}` }
  }
  if (signals.branch.kind === 'unknown') {
    return { mode: 'full', reason: 'unknown-branch', detail: signals.branch.why }
  }
  if (signals.spec.kind === 'unknown') {
    return { mode: 'full', reason: 'unknown-spec', detail: signals.spec.why }
  }
  if (signals.spec.kind === 'present') {
    return { mode: 'full', reason: 'active-spec', detail: `branch ${signals.branch.name}` }
  }
  return { mode: 'lean', reason: 'no-spec', detail: `branch ${signals.branch.name} sem pasta de spec` }
}

const REASON_TEXT: Record<Reason, string> = {
  override: 'forcado pelo utilizador',
  'active-spec': 'existe spec ativa para a branch',
  'no-spec': 'sem spec ativa para a branch',
  'unknown-branch': 'branch desconhecida, fail-open',
  'unknown-spec': 'spec nao verificavel, fail-open',
}

export const describeDecision = (decision: Decision): string =>
  `${decision.mode} (${REASON_TEXT[decision.reason]}: ${decision.detail})`
