export const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

export const joinPath = (base: string, relative: string): string =>
  `${base.replace(/[\\/]+$/, '')}/${relative.replace(/^[\\/]+/, '')}`

export const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

export const folderName = (path: string): string => {
  const name = baseName(path)
  return /^[A-Za-z]:$/.test(name) ? '' : name
}

export const startsWithHome = (path: string): boolean => path === '~' || path.startsWith('~/') || path.startsWith('~\\')
