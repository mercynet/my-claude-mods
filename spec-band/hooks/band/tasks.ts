import type { TaskCount } from '../../types'

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]/

const FENCE = /^\s*(```|~~~)/

export function countTasks(text: string): TaskCount | null {
  let done = 0
  let total = 0
  let fence: string | null = null

  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1]
    if (marker !== undefined) {
      fence = fence === null ? marker : fence === marker ? null : fence
      continue
    }
    if (fence !== null) continue

    const box = CHECKBOX.exec(line)?.[1]
    if (box === undefined) continue
    total += 1
    if (box !== ' ') done += 1
  }

  return total === 0 ? null : { done, total }
}
