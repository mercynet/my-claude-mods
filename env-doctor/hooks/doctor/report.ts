import type { CheckResult, Status } from './types'

const MARKERS: Record<Status, string> = { ok: '[ok]', warn: '[warn]', fail: '[fail]', skipped: '[skip]' }

const problems = (results: readonly CheckResult[]): CheckResult[] =>
  results.filter(entry => entry.status === 'fail' || entry.status === 'warn')

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

function countsText(results: readonly CheckResult[]): string | undefined {
  const failures = results.filter(entry => entry.status === 'fail').length
  const warnings = results.filter(entry => entry.status === 'warn').length
  if (failures + warnings === 0) return undefined
  return [
    ...(failures > 0 ? [plural(failures, 'falha', 'falhas')] : []),
    ...(warnings > 0 ? [plural(warnings, 'aviso', 'avisos')] : []),
  ].join(', ')
}

export function statusText(results: readonly CheckResult[]): string | undefined {
  const counts = countsText(results)
  return counts === undefined ? undefined : `env: ${counts}`
}

export function toastText(results: readonly CheckResult[]): string | undefined {
  const found = problems(results)
  const worst = found.find(entry => entry.status === 'fail') ?? found[0]
  if (worst === undefined) return undefined
  const rest = found.length - 1
  const tail = rest > 0 ? ` (+${rest} em /env)` : ' (detalhes em /env)'
  return `env: ${worst.id}: ${worst.reason}${tail}`
}

export function renderTable(results: readonly CheckResult[]): string {
  const rows = results.map(entry => {
    const fix = entry.fix === undefined ? '' : ` | correção: ${entry.fix}`
    return `${MARKERS[entry.status].padEnd(6)} ${entry.id}: ${entry.reason}${fix}`
  })
  return [`env-doctor: ${countsText(results) ?? 'tudo em ordem'}`, ...rows].join('\n')
}
