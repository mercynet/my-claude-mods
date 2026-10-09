import { IGNORED_SEGMENTS } from './config'

export const toPosix = (path: string): string => path.replace(/\\/g, '/')

export function relativeTo(root: string, file: string): string | undefined {
  const base = toPosix(root).replace(/\/+$/, '')
  const target = toPosix(file)
  if (base === '' || !target.startsWith(`${base}/`)) return undefined
  const relative = target.slice(base.length + 1)
  return relative === '' ? undefined : relative
}

export function extensionOf(relative: string): string {
  const name = relative.slice(relative.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isWatched(relative: string, extensions: ReadonlySet<string>): boolean {
  const segments = relative.split('/')
  if (segments.slice(0, -1).some(segment => IGNORED_SEGMENTS.has(segment))) return false
  return extensions.has(extensionOf(relative))
}
