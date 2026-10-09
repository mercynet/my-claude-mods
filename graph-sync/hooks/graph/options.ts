import type { PluginOptions } from 'claude-code'

export type GraphSyncOptions = {
  command: string
  argv: readonly string[]
  minIntervalMs: number
  timeoutMs: number
  extensions: ReadonlySet<string>
}

export const DEFAULT_COMMAND = 'graphify update .'

export const DEFAULT_EXTENSIONS = 'php,ts,tsx,js,jsx,py,go,rs,java,rb,cs,vue'

export const DEFAULT_INTERVAL_MINUTES = 5

export const DEFAULT_TIMEOUT_SECONDS = 600

const MAX_INTERVAL_MINUTES = 24 * 60

const MIN_TIMEOUT_SECONDS = 10

const MAX_TIMEOUT_SECONDS = 3600

const textOf = (options: PluginOptions, key: string): string =>
  typeof options[key] === 'string' ? (options[key] as string).trim() : ''

const numberOf = (options: PluginOptions, key: string, fallback: number): number => {
  const value = options[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

export function splitCommand(raw: string): string[] {
  return raw.split(/\s+/).filter(part => part !== '')
}

export function parseExtensions(raw: string): Set<string> {
  const entries = raw
    .split(',')
    .map(entry => entry.trim().replace(/^\.+/, '').toLowerCase())
    .filter(entry => entry !== '')
  return new Set(entries)
}

export function parseOptions(options: PluginOptions): GraphSyncOptions {
  const argv = splitCommand(textOf(options, 'command'))
  const resolved = argv.length > 0 ? argv : splitCommand(DEFAULT_COMMAND)
  const extensions = parseExtensions(textOf(options, 'watchExtensions'))

  return {
    command: resolved.join(' '),
    argv: resolved,
    minIntervalMs: clamp(numberOf(options, 'minIntervalMinutes', DEFAULT_INTERVAL_MINUTES), 0, MAX_INTERVAL_MINUTES) * 60_000,
    timeoutMs:
      clamp(numberOf(options, 'timeoutSeconds', DEFAULT_TIMEOUT_SECONDS), MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS) * 1000,
    extensions: extensions.size > 0 ? extensions : parseExtensions(DEFAULT_EXTENSIONS),
  }
}
