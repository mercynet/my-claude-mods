import type { Art } from './art'
import { MAX_COLUMNS, MIN_VISIBLE_SHARE } from './config'

export type Plan = {
  columns: number
  hasRule: boolean
  hasTagline: boolean
}

export function planBand(art: Art, bodyColumns: number, maxRows: number, wantsTagline: boolean): Plan | null {
  const columns = Math.min(art.width, Math.floor(bodyColumns), MAX_COLUMNS)
  if (!(columns >= 1) || columns < art.width * MIN_VISIBLE_SHARE) return null
  if (art.height > maxRows) return null

  return {
    columns,
    hasRule: art.height + 1 <= maxRows,
    hasTagline: wantsTagline && art.height + 2 <= maxRows,
  }
}
