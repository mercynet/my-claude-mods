import { describe, expect, test } from 'claude-code/testing'

import { isOpen, addEdit } from '../hooks/graph/dirty'
import { durationText, failureText, firstLine, lastLine } from '../hooks/graph/format'
import { parseExtensions, parseOptions, splitCommand } from '../hooks/graph/options'
import { extensionOf, isWatched, relativeTo, toPosix } from '../hooks/graph/paths'
import { isLockLive, parseLast, parseLock } from '../hooks/graph/records'

const WATCHED = parseExtensions('php,ts')

describe('options', () => {
  test('the defaults are the documented ones', () => {
    const cfg = parseOptions({})
    expect(cfg.command).toBe('graphify update .')
    expect(cfg.argv).toEqual(['graphify', 'update', '.'])
    expect(cfg.minIntervalMs).toBe(5 * 60_000)
    expect(cfg.timeoutMs).toBe(600_000)
    expect(cfg.extensions.has('php')).toBe(true)
    expect(cfg.extensions.has('vue')).toBe(true)
  })

  test('a command is split on whitespace with no shell', () => {
    expect(splitCommand('  graphify   update   src ')).toEqual(['graphify', 'update', 'src'])
    expect(parseOptions({ command: 'mytool --fast .' }).argv).toEqual(['mytool', '--fast', '.'])
  })

  test('a blank command falls back to the default', () => {
    expect(parseOptions({ command: '   ' }).command).toBe('graphify update .')
  })

  test('numbers are clamped and a non-number is ignored', () => {
    expect(parseOptions({ minIntervalMinutes: 0 }).minIntervalMs).toBe(0)
    expect(parseOptions({ minIntervalMinutes: -3 }).minIntervalMs).toBe(0)
    expect(parseOptions({ minIntervalMinutes: 99_999 }).minIntervalMs).toBe(24 * 60 * 60_000)
    expect(parseOptions({ minIntervalMinutes: 'soon' as never }).minIntervalMs).toBe(5 * 60_000)
    expect(parseOptions({ timeoutSeconds: 1 }).timeoutMs).toBe(10_000)
    expect(parseOptions({ timeoutSeconds: 999_999 }).timeoutMs).toBe(3_600_000)
  })

  test('extensions are lower-cased, stripped of dots and never empty', () => {
    expect([...parseExtensions(' .PHP, ts ,, ..Py ')]).toEqual(['php', 'ts', 'py'])
    expect(parseOptions({ watchExtensions: ' , ' }).extensions.has('php')).toBe(true)
  })
})

describe('paths', () => {
  test('relativeTo only accepts files under the root', () => {
    expect(relativeTo('/srv/example/example-app', '/srv/example/example-app/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/srv/example/example-app/', '/srv/example/example-app/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/srv/example/example-app', '/srv/example/example-app-other/a.ts')).toBeUndefined()
    expect(relativeTo('/srv/example/example-app', '/srv/example/example-app')).toBeUndefined()
    expect(relativeTo('C:/work/example-app', toPosix('C:\\work\\example-app\\src\\a.ts'))).toBe('src/a.ts')
  })

  test('extensionOf ignores dotfiles and names without a dot', () => {
    expect(extensionOf('src/A.TSX')).toBe('tsx')
    expect(extensionOf('src/.env')).toBe('')
    expect(extensionOf('Makefile')).toBe('')
    expect(extensionOf('dir.d/file')).toBe('')
  })

  test('ignored directories exclude a file at any depth', () => {
    expect(isWatched('src/a.php', WATCHED)).toBe(true)
    expect(isWatched('node_modules/x.php', WATCHED)).toBe(false)
    expect(isWatched('packages/app/node_modules/x.ts', WATCHED)).toBe(false)
    expect(isWatched('vendor/x.php', WATCHED)).toBe(false)
    expect(isWatched('graphify-out/x.ts', WATCHED)).toBe(false)
    expect(isWatched('.git/hooks/x.ts', WATCHED)).toBe(false)
    expect(isWatched('src/notes.md', WATCHED)).toBe(false)
    expect(isWatched('vendor.ts', WATCHED)).toBe(true)
  })
})

describe('dirty set', () => {
  test('counts every edit and previews the first distinct paths', () => {
    let held = addEdit(null, 'a.ts')
    held = addEdit(held, 'a.ts')
    for (const name of ['b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']) held = addEdit(held, name)
    expect(held.edits).toBe(7)
    expect(held.paths).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
  })

  test('isOpen rejects anything that is not a dirty set', () => {
    expect(isOpen(null)).toBe(false)
    expect(isOpen({ edits: 1 })).toBe(false)
    expect(isOpen({ edits: 1, paths: [] })).toBe(true)
  })
})

describe('records and lock', () => {
  test('parseLock and parseLast reject malformed values', () => {
    expect(parseLock({ sessionId: 's', startedAt: 1 })).toEqual({ sessionId: 's', startedAt: 1 })
    expect(parseLock({ sessionId: 's' })).toBeUndefined()
    expect(parseLock('x')).toBeUndefined()
    expect(parseLast({ startedAt: 1, durationMs: 2, exitCode: 0, outcome: 'ok', edits: 3 })?.outcome).toBe('ok')
    expect(parseLast({ startedAt: 1, durationMs: 2, exitCode: 0, outcome: 'weird', edits: 3 })).toBeUndefined()
    expect(parseLast({ startedAt: 1, durationMs: 2, outcome: 'timeout', edits: 0 })?.exitCode).toBeNull()
  })

  test('a lock is live only inside the timeout and never when it is our own orphan', () => {
    const lock = { sessionId: 'a', startedAt: 1_000 }
    expect(isLockLive(lock, 1_500, 'b', false, 600_000)).toBe(true)
    expect(isLockLive(lock, 1_000 + 600_000, 'b', false, 600_000)).toBe(false)
    expect(isLockLive(lock, 500, 'b', false, 600_000)).toBe(false)
    expect(isLockLive(lock, 1_500, 'a', false, 600_000)).toBe(false)
    expect(isLockLive(lock, 1_500, 'a', true, 600_000)).toBe(true)
  })
})

describe('format', () => {
  test('durationText', () => {
    expect(durationText(400)).toBe('400ms')
    expect(durationText(38_000)).toBe('38s')
    expect(durationText(125_000)).toBe('2min 5s')
    expect(durationText(120_000)).toBe('2min')
  })

  test('firstLine and lastLine skip blanks and cut long lines', () => {
    expect(firstLine('\n\n  boom \nnext')).toBe('boom')
    expect(lastLine('one\ntwo\n\n')).toBe('two')
    expect(firstLine('x'.repeat(300)).length).toBe(160)
    expect(firstLine('')).toBe('')
  })

  test('failureText names the reason and the first stderr line', () => {
    const base = { exitCode: 2, detail: '', durationMs: 1000, stderr: 'bad graph\nmore', stdout: 'out' }
    expect(failureText({ ...base, outcome: 'failed' })).toBe('grafo: falhou (código 2): bad graph')
    expect(failureText({ ...base, outcome: 'failed', stderr: '', stdout: 'a\nlast' })).toBe('grafo: falhou (código 2): last')
    expect(failureText({ ...base, outcome: 'failed', exitCode: null, detail: 'SIGKILL' })).toContain('sinal SIGKILL')
    expect(failureText({ ...base, outcome: 'timeout', exitCode: null, durationMs: 600_000 })).toContain('tempo esgotado após 10min')
    expect(failureText({ ...base, outcome: 'error', exitCode: null, detail: 'ENOENT' })).toContain('não arrancou: ENOENT')
  })
})
