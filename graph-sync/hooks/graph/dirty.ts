import type { DirtySet } from '../../types'

import { PATH_PREVIEW } from './config'

export function addEdit(held: DirtySet | null, relative: string): DirtySet {
  const paths = held?.paths ?? []
  const shown = paths.includes(relative) || paths.length >= PATH_PREVIEW ? paths : [...paths, relative]
  return { edits: (held?.edits ?? 0) + 1, paths: shown }
}

export const isOpen = (value: unknown): value is DirtySet =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as DirtySet).edits === 'number' &&
  Array.isArray((value as DirtySet).paths)
