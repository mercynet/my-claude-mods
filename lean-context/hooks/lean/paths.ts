const lastSeparator = (path: string): number => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

export const baseName = (path: string): string => path.slice(lastSeparator(path) + 1)

export const dirName = (path: string): string => {
  const cut = lastSeparator(path)
  if (cut < 0) return '.'
  return cut === 0 ? '/' : path.slice(0, cut)
}

export const joinPath = (directory: string, relative: string): string =>
  `${directory.replace(/[\\/]+$/, '')}/${relative.replace(/^[\\/]+/, '')}`
