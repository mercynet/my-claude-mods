import type { Config } from './types'

export function parseList(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return parts.map(part => String(part).trim()).filter(part => part !== '')
}

export function readConfig(options: Readonly<Record<string, unknown>>): Config {
  return {
    emptyFiles: parseList(options.emptyFiles),
    requiredPaths: parseList(options.requiredPaths),
    ignoreServices: parseList(options.ignoreServices),
  }
}
