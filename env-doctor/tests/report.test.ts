import { describe, expect, test } from 'claude-code/testing'

import { renderTable, statusText, toastText } from '../hooks/doctor/report'
import type { CheckResult } from '../hooks/doctor/types'

const ok: CheckResult = { id: 'compose', status: 'ok', reason: '3 serviço(s) em execução' }
const skipped: CheckResult = { id: 'node-deps', status: 'skipped', reason: 'sem .mcp.json na raiz do repositório' }
const warn: CheckResult = { id: 'required-paths', status: 'warn', reason: 'em falta: .env', fix: 'crie ou restaure: .env' }
const fail: CheckResult = { id: 'node-deps', status: 'fail', reason: 'node_modules ausente', fix: 'npm install' }

describe('statusText', () => {
  test('nothing to report clears the status', () => {
    expect(statusText([ok, skipped])).toBeUndefined()
  })

  test('counts warnings with the right plural', () => {
    expect(statusText([warn])).toBe('env: 1 aviso')
    expect(statusText([warn, { ...warn, id: 'compose' }])).toBe('env: 2 avisos')
  })

  test('failures come first', () => {
    expect(statusText([warn, fail])).toBe('env: 1 falha, 1 aviso')
  })
})

describe('toastText', () => {
  test('no problem, no toast', () => {
    expect(toastText([ok, skipped])).toBeUndefined()
  })

  test('names the worst item: a failure before a warning', () => {
    expect(toastText([warn, fail])).toBe('env: node-deps: node_modules ausente (+1 em /env)')
  })

  test('a single problem points to the command', () => {
    expect(toastText([ok, warn])).toBe('env: required-paths: em falta: .env (detalhes em /env)')
  })
})

describe('renderTable', () => {
  test('one line per check with marker, reason and fix', () => {
    const lines = renderTable([ok, skipped, warn, fail]).split('\n')

    expect(lines).toEqual([
      'env-doctor: 1 falha, 1 aviso',
      '[ok]   compose: 3 serviço(s) em execução',
      '[skip] node-deps: sem .mcp.json na raiz do repositório',
      '[warn] required-paths: em falta: .env | correção: crie ou restaure: .env',
      '[fail] node-deps: node_modules ausente | correção: npm install',
    ])
  })

  test('a clean table says everything is fine', () => {
    expect(renderTable([ok, skipped]).split('\n')[0]).toBe('env-doctor: tudo em ordem')
  })

  test('the output carries no emoji', () => {
    expect(renderTable([ok, skipped, warn, fail])).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
