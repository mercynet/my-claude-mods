export const joinPath = (directory: string, relative: string): string =>
  `${directory.replace(/[\\/]+$/, '')}/${relative.replace(/^[\\/]+/, '')}`

const normalize = (path: string): string => path.replace(/\\/g, '/')

export function isInside(root: string, path: string): boolean {
  const base = normalize(root).replace(/\/+$/, '')
  const target = normalize(path)
  if (!target.startsWith('/') && !/^[A-Za-z]:\//.test(target)) return true
  return target === base || target.startsWith(`${base}/`)
}
