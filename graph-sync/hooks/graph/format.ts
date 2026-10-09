import type { DirtySet } from '../../types'

import { PATH_PREVIEW } from './config'
import type { LastRun, RunOutcome } from './records'

export const STATUS_RUNNING = 'grafo: atualizando...'

export const STATUS_FAILED = 'grafo: falhou'

export const USAGE = 'uso: /graph [status | now]'

export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}min` : `${minutes}min ${rest}s`
}

export const statusOk = (durationMs: number): string => `grafo ok (${durationText(durationMs)})`

export function firstLine(text: string, max = 160): string {
  const line = text
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part !== '')
  if (line === undefined) return ''
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

export function lastLine(text: string, max = 160): string {
  const lines = text
    .split(/\r?\n/)
    .map(part => part.trim())
    .filter(part => part !== '')
  return firstLine(lines[lines.length - 1] ?? '', max)
}

export type FailureFacts = {
  outcome: Exclude<RunOutcome, 'ok'>
  exitCode: number | null
  detail: string
  durationMs: number
  stderr: string
  stdout: string
}

export function failureText(facts: FailureFacts): string {
  const reason =
    facts.outcome === 'timeout'
      ? `tempo esgotado após ${durationText(facts.durationMs)}`
      : facts.outcome === 'error'
        ? `não arrancou: ${facts.detail}`
        : facts.exitCode === null
          ? `terminado pelo sinal ${facts.detail === '' ? 'desconhecido' : facts.detail}`
          : `código ${facts.exitCode}`
  const output = firstLine(facts.stderr) || lastLine(facts.stdout)
  return output === '' ? `grafo: falhou (${reason})` : `grafo: falhou (${reason}): ${output}`
}

const stamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  ok: 'ok',
  failed: 'falhou',
  timeout: 'tempo esgotado',
  error: 'não arrancou',
}

export type PanelView = {
  version: string
  root: string | null
  inertWhy?: string
  command: string
  now: number
  runningSince?: number
  dirty: DirtySet | null
  last?: LastRun
  hasFailure: boolean
  isMissing: boolean
  minIntervalMs: number
  timeoutMs: number
  extensions: readonly string[]
}

export function panelText(view: PanelView): string {
  const lines = [`graph-sync ${view.version}`]
  if (view.inertWhy !== undefined) {
    lines.push(`inativo: ${view.inertWhy}`, `comando: ${view.command}`)
    return lines.join('\n')
  }

  lines.push(`repositório: ${view.root ?? '?'}`, `comando: ${view.command}`)
  lines.push(
    view.runningSince === undefined
      ? 'execução: parada'
      : `execução: em curso há ${durationText(Math.max(0, view.now - view.runningSince))}`,
  )
  lines.push(
    view.dirty === null
      ? 'edições pendentes: nenhuma'
      : `edições pendentes: ${view.dirty.edits} (${view.dirty.paths.join(', ')}${view.dirty.paths.length >= PATH_PREVIEW && view.dirty.edits > view.dirty.paths.length ? ', ...' : ''})`,
  )
  lines.push(
    view.last === undefined
      ? 'última execução: nenhuma registada'
      : `última execução: ${stamp(view.last.startedAt)}, ${durationText(view.last.durationMs)}, ${OUTCOME_LABEL[view.last.outcome]}${view.last.exitCode === null ? '' : ` (código ${view.last.exitCode})`}, ${view.last.edits} edição(ões)`,
  )
  if (view.hasFailure) lines.push('falha em aberto: sim (só volta a tentar depois de uma nova edição)')
  if (view.isMissing) lines.push('executável: não encontrado nesta sessão (/graph now volta a verificar)')
  lines.push(
    `intervalo mínimo: ${view.minIntervalMs === 0 ? 'desligado' : durationText(view.minIntervalMs)} · limite: ${durationText(view.timeoutMs)} · extensões: ${view.extensions.join(', ')}`,
  )
  return lines.join('\n')
}
