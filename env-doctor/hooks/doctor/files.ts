import { isRepoRelative, joinPath, shellWord } from './paths'
import { result } from './result'
import type { CheckResult, Context } from './types'

export const EMPTY_FILES_ID = 'empty-files'
export const REQUIRED_PATHS_ID = 'required-paths'

export const NEAR_EMPTY_BYTES = 128
export const READ_LIMIT_BYTES = 64 * 1024

const EMPTY_ROUTES = /(['"])routes\1\s*(?:=>|:)\s*(?:array\s*\(\s*\)|\[\s*\])/

export function emptinessOf(size: number, text: string | undefined): string | undefined {
  if (size === 0) return 'vazio (0 bytes)'
  if (text !== undefined && EMPTY_ROUTES.test(text)) return "coleção 'routes' vazia"
  if (text !== undefined && text.trim().length < NEAR_EMPTY_BYTES) return `quase vazio (${size} bytes)`
  return undefined
}

const invalidReason = (paths: readonly string[]): string => `caminho fora do repositório ignorado: ${paths.join(', ')}`

export async function checkEmptyFiles(ctx: Context): Promise<CheckResult> {
  const configured = ctx.config.emptyFiles
  if (configured.length === 0) return result(EMPTY_FILES_ID, 'skipped', 'nenhum ficheiro configurado (emptyFiles)')

  const invalid = configured.filter(path => !isRepoRelative(path))
  const paths = configured.filter(isRepoRelative)

  const findings = await Promise.all(
    paths.map(async path => {
      const info = await ctx.ports.stat(joinPath(ctx.root, path)).catch(() => undefined)
      if (info === undefined || info.kind !== 'file') return { path, present: false, why: undefined }
      const text =
        info.size > 0 && info.size <= READ_LIMIT_BYTES
          ? await ctx.ports.read(joinPath(ctx.root, path)).catch(() => undefined)
          : undefined
      return { path, present: true, why: emptinessOf(info.size, text) }
    }),
  )

  const suspicious = findings.filter(finding => finding.why !== undefined)
  if (suspicious.length > 0) {
    return result(
      EMPTY_FILES_ID,
      'warn',
      suspicious.map(finding => `${finding.path}: ${finding.why}`).join('; '),
      `rm ${suspicious.map(finding => shellWord(finding.path)).join(' ')}`,
    )
  }
  if (invalid.length > 0) return result(EMPTY_FILES_ID, 'warn', invalidReason(invalid), 'use caminhos relativos à raiz do repositório')

  const present = findings.filter(finding => finding.present).length
  if (present === 0) return result(EMPTY_FILES_ID, 'skipped', 'nenhum dos ficheiros configurados existe')
  return result(EMPTY_FILES_ID, 'ok', `${present} ficheiro(s) com conteúdo`)
}

export async function checkRequiredPaths(ctx: Context): Promise<CheckResult> {
  const configured = ctx.config.requiredPaths
  if (configured.length === 0) return result(REQUIRED_PATHS_ID, 'skipped', 'nenhum caminho configurado (requiredPaths)')

  const invalid = configured.filter(path => !isRepoRelative(path))
  const paths = configured.filter(isRepoRelative)
  const present = await Promise.all(paths.map(path => ctx.ports.exists(joinPath(ctx.root, path))))
  const missing = paths.filter((_, index) => !present[index])

  if (missing.length > 0) {
    return result(REQUIRED_PATHS_ID, 'warn', `em falta: ${missing.join(', ')}`, `crie ou restaure: ${missing.join(', ')}`)
  }
  if (invalid.length > 0) {
    return result(REQUIRED_PATHS_ID, 'warn', invalidReason(invalid), 'use caminhos relativos à raiz do repositório')
  }
  return result(REQUIRED_PATHS_ID, 'ok', `${paths.length} caminho(s) presentes`)
}
