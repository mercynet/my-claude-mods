import { checkCompose, COMPOSE_ID } from './compose'
import { checkEmptyFiles, checkRequiredPaths, EMPTY_FILES_ID, REQUIRED_PATHS_ID } from './files'
import { checkNodeDeps, NODE_DEPS_ID } from './nodeDeps'
import { messageOf, result } from './result'
import type { Check, CheckResult, Context } from './types'

export const BUDGET_MS = 8000

export const CHECKS: readonly Check[] = [
  { id: COMPOSE_ID, run: checkCompose },
  { id: NODE_DEPS_ID, run: checkNodeDeps },
  { id: EMPTY_FILES_ID, run: checkEmptyFiles },
  { id: REQUIRED_PATHS_ID, run: checkRequiredPaths },
]

export type Scheduler = { after: (ms: number, fn: () => void) => { cancel: () => void } }

async function guarded(check: Check, ctx: Context): Promise<CheckResult> {
  try {
    return await check.run(ctx)
  } catch (error) {
    return result(check.id, 'skipped', `verificação falhou: ${messageOf(error)}`)
  }
}

export async function runChecks(
  ctx: Context,
  scheduler: Scheduler,
  checks: readonly Check[] = CHECKS,
  budgetMs = BUDGET_MS,
): Promise<CheckResult[]> {
  const settled = new Map<string, CheckResult>()
  const all = Promise.all(
    checks.map(async check => {
      settled.set(check.id, await guarded(check, ctx))
    }),
  )

  let timer: { cancel: () => void } | undefined
  const expired = new Promise<void>(resolve => {
    timer = scheduler.after(budgetMs, resolve)
  })
  await Promise.race([all, expired])
  timer?.cancel()

  return checks.map(check => settled.get(check.id) ?? result(check.id, 'skipped', `sem resposta em ${budgetMs / 1000}s`))
}
