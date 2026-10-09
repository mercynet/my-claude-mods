export function joinPath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relative.replace(/^[\\/]+/, '')}`
}

export function isRepoRelative(path: string): boolean {
  if (/^([\\/]|[A-Za-z]:)/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

export function shellWord(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`
}
