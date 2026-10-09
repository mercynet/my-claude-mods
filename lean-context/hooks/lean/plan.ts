import type { InstructionFile } from 'claude-code'

import { byteLength } from './estimate'
import type { LeanOptions } from './options'
import { baseName, dirName } from './paths'
import { cutSections } from './sections'
import type { CutSection } from './sections'

export type FilePlan = {
  files: InstructionFile[]
  hasTarget: boolean
  projectDir?: string
  cut: CutSection[]
  missing: string[]
  savedBytes: number
  isParseReliable: boolean
}

export function planFiles(
  files: readonly InstructionFile[],
  options: Pick<LeanOptions, 'instructionFile' | 'sections'>,
): FilePlan {
  const titles = options.sections.map(section => section.title)
  const cut: CutSection[] = []
  let savedBytes = 0
  let isParseReliable = true
  let hasTarget = false
  let projectDir: string | undefined

  const planned = files.map(file => {
    if (baseName(file.path) !== options.instructionFile) return file
    hasTarget = true
    const result = cutSections(file.content, options.instructionFile, titles)
    isParseReliable = isParseReliable && result.isParseReliable
    if (result.cut.length === 0) return file
    projectDir ??= dirName(file.path)
    cut.push(...result.cut)
    savedBytes += byteLength(file.content) - byteLength(result.text)
    return { ...file, content: result.text }
  })

  const found = new Set(cut.map(section => section.title))
  const missing = titles.filter(title => !found.has(title))
  return { files: planned, hasTarget, projectDir, cut, missing, savedBytes, isParseReliable }
}
