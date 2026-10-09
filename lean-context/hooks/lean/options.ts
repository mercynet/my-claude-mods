import type { PluginOptions } from 'claude-code'

export type OmittableSection = { title: string; expectedBytes?: number }

export type LeanOptions = {
  instructionFile: string
  specsDir: string
  projectMarker: string
  sections: readonly OmittableSection[]
  inertWhy?: string
}

export const DEFAULT_INSTRUCTION_FILE = 'AGENTS.md'

export const DEFAULT_SPECS_DIR = 'specs/_active'

const CONTROL_CHARACTERS = /[\x00-\x1f]/

const textOf = (options: PluginOptions, key: string): string =>
  typeof options[key] === 'string' ? (options[key] as string).trim() : ''

export function parseSections(raw: string): OmittableSection[] {
  const seen = new Set<string>()
  const sections: OmittableSection[] = []

  for (const entry of raw.split(';')) {
    const text = entry.trim()
    if (text === '') continue

    const bar = text.lastIndexOf('|')
    const suffix = bar < 0 ? '' : text.slice(bar + 1).trim()
    const hasSuffix = /^\d+$/.test(suffix)
    const title = (hasSuffix ? text.slice(0, bar) : text).trim()
    if (title === '' || seen.has(title)) continue

    seen.add(title)
    const expectedBytes = hasSuffix ? Number(suffix) : 0
    sections.push(expectedBytes > 0 ? { title, expectedBytes } : { title })
  }
  return sections
}

export function normalizeRelativeDir(raw: string): string | undefined {
  const text = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
  if (text === '' || text.startsWith('/') || /^[A-Za-z]:/.test(text) || CONTROL_CHARACTERS.test(text)) {
    return undefined
  }
  const parts = text.split('/')
  return parts.some(part => part === '' || part === '.' || part === '..') ? undefined : parts.join('/')
}

const isFileName = (name: string): boolean =>
  name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name) && !CONTROL_CHARACTERS.test(name)

export const markerOf = (specsDir: string): string => {
  const cut = specsDir.lastIndexOf('/')
  return cut < 0 ? specsDir : specsDir.slice(0, cut)
}

export function parseOptions(options: PluginOptions): LeanOptions {
  const sections = parseSections(textOf(options, 'omittableSections'))
  const instructionFile = textOf(options, 'instructionFile') || DEFAULT_INSTRUCTION_FILE
  const specsDir = normalizeRelativeDir(textOf(options, 'specsDir') || DEFAULT_SPECS_DIR)
  const resolved = specsDir ?? DEFAULT_SPECS_DIR
  const base = { instructionFile, specsDir: resolved, projectMarker: markerOf(resolved), sections }

  if (!isFileName(instructionFile)) return { ...base, inertWhy: 'userConfig instructionFile invalido (so o nome do ficheiro)' }
  if (specsDir === undefined) {
    return { ...base, inertWhy: 'userConfig specsDir invalido (caminho relativo, sem ..)' }
  }
  if (sections.length === 0) return { ...base, inertWhy: 'userConfig omittableSections vazio: nada a cortar' }
  return base
}
