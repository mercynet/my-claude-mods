import type {
  EngineInterface,
  PromptContextInput,
  PromptContextResult,
  Register,
  TurnUsage,
} from 'claude-code'

import {
  DRIFT_TOLERANCE,
  PROPOSAL_TOAST_MS,
  RESURFACE_GAIN,
  SECTION_ID,
  STORE_DIAG,
  STORE_DISMISSED,
  STORE_HISTORY,
  STORE_SETTINGS,
  VERSION,
} from './lean/config'
import { tokensFromBytes } from './lean/estimate'
import { branchFromGit, decideMode, describeDecision } from './lean/mode'
import type { BranchProbe, Decision, Mode, SpecProbe } from './lean/mode'
import { parseOptions } from './lean/options'
import type { LeanOptions } from './lean/options'
import { joinPath } from './lean/paths'
import { planFiles } from './lean/plan'
import { measuredShare, parseDismissals, proposalFor, proposalText } from './lean/proposal'
import { parseDiag, parseHistory, parseSettings, patchHistory } from './lean/records'
import type { ConversationRecord } from './lean/records'
import { composeNote, reminderText, renderPanel, statusText } from './lean/report'
import { driftOf } from './lean/sections'
import { summarizeBreakdown } from './lean/weights'

const overrideRef = { plugin: 'lean-context', key: 'override' } as const
const activeRef = { plugin: 'lean-context', key: 'active' } as const
const proposedRef = { plugin: 'lean-context', key: 'proposed' } as const

const SEQ_LIMIT = 4
const seqBySession = new Map<string, string[]>()

const USAGE = 'uso: /lean [apply | simulate | dismiss | reset | mode full|lean|auto]'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function loadHistory($: EngineInterface): Promise<ConversationRecord[]> {
  return parseHistory(await $.store.get(STORE_HISTORY))
}

async function loadSettings($: EngineInterface) {
  return parseSettings(await $.store.get(STORE_SETTINGS))
}

async function patchRecord(
  $: EngineInterface,
  sessionId: string,
  mutate: (record: ConversationRecord) => void,
  create?: () => ConversationRecord,
): Promise<ConversationRecord | undefined> {
  const patched = patchHistory(await loadHistory($), sessionId, mutate, create)
  if (patched === undefined) return undefined
  await $.store.set(STORE_HISTORY, patched.history)
  return patched.record
}

async function writeDiag($: EngineInterface, sessionId: string, note: string): Promise<void> {
  await $.store.set(STORE_DIAG, { at: await $.clock.now(), sessionId, note })
}

async function readOverride($: EngineInterface, sessionId: string): Promise<Mode | undefined> {
  const { value } = await $.state.get(overrideRef)
  return value?.sessionId === sessionId ? value.mode : undefined
}

async function noteEvent($: EngineInterface, sessionId: string, name: string): Promise<void> {
  const seq = seqBySession.get(sessionId) ?? []
  if (seq.length >= SEQ_LIMIT) return
  seq.push(name)
  seqBySession.set(sessionId, seq)
  if (seqBySession.size > 8) seqBySession.delete(seqBySession.keys().next().value ?? sessionId)
  await patchRecord($, sessionId, record => {
    record.seq = [...seq]
  })
}

async function probeBranch($: EngineInterface, projectDir: string): Promise<BranchProbe> {
  try {
    const output = await $.process.run(['git', '-C', projectDir, 'branch', '--show-current'], {
      timeoutMs: 5000,
    })
    return branchFromGit(output)
  } catch (error) {
    return { kind: 'unknown', why: `git indisponivel: ${messageOf(error)}` }
  }
}

async function probeSpec(
  $: EngineInterface,
  projectDir: string,
  branch: string,
  cfg: LeanOptions,
): Promise<SpecProbe> {
  try {
    const activeDir = joinPath(projectDir, cfg.specsDir)
    const active = await $.fs.stat(activeDir).catch(() => undefined)
    if (active?.kind !== 'dir') return { kind: 'unknown', why: `pasta ${cfg.specsDir} nao encontrada` }

    const specDir = joinPath(activeDir, branch)
    if (!(await $.fs.exists(specDir))) return { kind: 'absent' }
    const stat = await $.fs.stat(specDir)
    return stat.kind === 'dir' ? { kind: 'present' } : { kind: 'absent' }
  } catch (error) {
    return { kind: 'unknown', why: `leitura da spec falhou: ${messageOf(error)}` }
  }
}

async function probeDecision(
  $: EngineInterface,
  projectDir: string,
  cfg: LeanOptions,
  override?: Mode,
): Promise<Decision> {
  if (override !== undefined) {
    const skipped = { kind: 'unknown', why: 'override' } as const
    return decideMode({ override, branch: skipped, spec: skipped })
  }
  const branch = await probeBranch($, projectDir)
  const spec: SpecProbe =
    branch.kind === 'branch'
      ? await probeSpec($, projectDir, branch.name, cfg)
      : { kind: 'unknown', why: 'sem branch' }
  return decideMode({ branch, spec })
}

async function inertReason($: EngineInterface, cfg: LeanOptions, projectDir: string): Promise<string | undefined> {
  if (cfg.inertWhy !== undefined) return cfg.inertWhy
  return (await $.fs.exists(joinPath(projectDir, cfg.projectMarker)))
    ? undefined
    : `${cfg.projectMarker} nao existe em ${projectDir}`
}

async function handleContext(
  $: EngineInterface,
  input: PromptContextInput,
  result: PromptContextResult,
  cfg: LeanOptions,
): Promise<PromptContextResult | undefined> {
  const sessionId = await $.session.id()
  await noteEvent($, sessionId, 'prompt.context')

  if (cfg.inertWhy !== undefined) {
    await writeDiag($, sessionId, `inerte: ${cfg.inertWhy}`)
    return undefined
  }

  const before = input.blocks.find(block => block.name === 'claudeMd')
  const after = result.blocks.find(block => block.name === 'claudeMd')
  const files = result.instructionFiles ?? (before?.text === after?.text ? input.instructionFiles : undefined)
  if (files === undefined) {
    await writeDiag($, sessionId, 'inerte: ficheiros de instrucoes desconhecidos (claudeMd reescrito por outro hook)')
    return undefined
  }

  const plan = planFiles(files, cfg)
  if (!plan.hasTarget) {
    await writeDiag($, sessionId, `inerte: nenhum ${cfg.instructionFile} entre os ficheiros de instrucoes`)
    return undefined
  }
  if (!plan.isParseReliable) {
    await writeDiag($, sessionId, `nada cortado: ${cfg.instructionFile} com cerca de codigo por fechar (fail-open)`)
    return undefined
  }
  if (plan.cut.length === 0 || plan.projectDir === undefined) {
    await writeDiag($, sessionId, `inerte: nenhum titulo da lista encontrado no ${cfg.instructionFile}`)
    return undefined
  }

  const projectDir = plan.projectDir
  const inert = await inertReason($, cfg, projectDir)
  if (inert !== undefined) {
    await writeDiag($, sessionId, `inerte: ${inert}`)
    return undefined
  }

  const decision = await probeDecision($, projectDir, cfg, await readOverride($, sessionId))
  const settings = await loadSettings($)
  const willApply = decision.mode === 'lean' && settings.applyCut
  const savedTokens = tokensFromBytes(plan.savedBytes)
  const expected = cfg.sections.flatMap(section =>
    section.expectedBytes === undefined ? [] : [{ title: section.title, expectedBytes: section.expectedBytes }],
  )
  const drift = driftOf(plan.cut, expected, DRIFT_TOLERANCE)
  const isAgentsInText = after === undefined ? undefined : after.text.includes(`## ${plan.cut[0]?.title ?? ''}`)
  const startedAt = await $.clock.now()

  const fresh = (): ConversationRecord => ({
    sessionId,
    projectDir,
    startedAt,
    seq: [...(seqBySession.get(sessionId) ?? [])],
    reads: 0,
    mode: decision.mode,
    reason: decision.reason,
    detail: decision.detail,
    applied: willApply,
    cut: plan.cut,
    missing: plan.missing,
    drift,
    savedBytes: plan.savedBytes,
    savedTokens,
    isAgentsInText,
  })

  const record = await patchRecord(
    $,
    sessionId,
    current => {
      current.reads += 1
      current.cut = plan.cut
      current.missing = plan.missing
      current.drift = drift
      current.savedBytes = plan.savedBytes
      current.savedTokens = savedTokens
      current.isAgentsInText = isAgentsInText
    },
    fresh,
  )

  // A later read cannot tell the main conversation from a subagent's, so it never clears or re-arms the cut.
  const { value: existing } = await $.state.get(activeRef)
  if (willApply && existing?.sessionId !== sessionId) {
    await $.state.set(activeRef, {
      sessionId,
      projectDir,
      titles: plan.cut.map(section => section.title),
      isReminded: false,
      setAt: startedAt,
    })
  }
  await writeDiag($, sessionId, `${willApply ? 'corte aplicado' : 'corte simulado'} em modo ${decision.mode}`)
  if (record?.reads === 1) $.ui.status(statusText(record))

  return willApply ? { ...result, instructionFiles: plan.files } : undefined
}

async function prepareReminder(
  $: EngineInterface,
  cfg: LeanOptions,
): Promise<{ text: string; undo: () => Promise<void> } | undefined> {
  const sessionId = await $.session.id()
  await noteEvent($, sessionId, 'prompt.submit')

  const { value: active } = await $.state.get(activeRef)
  if (active === undefined || active === null || active.sessionId !== sessionId || active.isReminded) {
    return undefined
  }

  const decision = await probeDecision($, active.projectDir, cfg, await readOverride($, sessionId))
  if (decision.mode !== 'full') return undefined

  const mark = async (isReminded: boolean): Promise<void> => {
    await $.state.set(activeRef, { ...active, isReminded })
  }
  await mark(true)
  $.ui.status('lean: full, omissoes avisadas')
  return { text: reminderText(active.titles, decision.reason, cfg.instructionFile), undo: () => mark(false) }
}

async function activeTitles($: EngineInterface): Promise<string[] | undefined> {
  const sessionId = await $.session.id()
  const { value: active } = await $.state.get(activeRef)
  return active !== undefined && active !== null && active.sessionId === sessionId ? active.titles : undefined
}

async function clearActiveCut($: EngineInterface, compactionStartedAt: number): Promise<void> {
  const { value: active } = await $.state.get(activeRef)
  if (active !== undefined && active !== null && active.setAt <= compactionStartedAt) {
    await $.state.set(activeRef, null)
  }
}

async function recordFirstRequest($: EngineInterface, usage: TurnUsage): Promise<void> {
  const sessionId = await $.session.id()
  const record = (await loadHistory($)).find(item => item.sessionId === sessionId)
  if (record === undefined || record.firstRequestTokens !== undefined) return
  if ((await $.session.turns()) > 1) return

  const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  await patchRecord($, sessionId, current => {
    current.firstRequestTokens = total
  })
}

async function measureAfterTurn($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id()
  const record = (await loadHistory($)).find(item => item.sessionId === sessionId)
  if (record === undefined) return

  const isFirstTurn = (await $.session.turns()) <= 1
  const needsEnd = isFirstTurn && record.turnEndTokens === undefined
  const needsWeights = record.weights === undefined
  if (!needsEnd && !needsWeights) return

  const usage = await $.session.usage(needsWeights ? { breakdown: 'summary' } : undefined)
  await patchRecord($, sessionId, current => {
    if (needsEnd && usage.context.tokens !== undefined) current.turnEndTokens = usage.context.tokens
    current.windowTokens = usage.context.window
    if (needsWeights && usage.context.breakdown !== undefined) {
      current.weights = summarizeBreakdown(usage.context.breakdown)
    }
  })
}

async function maybePropose($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id()
  const { value: proposed } = await $.state.get(proposedRef)
  if (proposed?.sessionId === sessionId) return

  const history = await loadHistory($)
  const record = history.find(item => item.sessionId === sessionId)
  if (record === undefined) return

  const proposal = proposalFor(
    history,
    record.projectDir,
    (await loadSettings($)).applyCut,
    parseDismissals(await $.store.get(STORE_DISMISSED)),
  )
  if (proposal === undefined) return

  await $.state.set(proposedRef, { sessionId })
  const text = proposalText(proposal)
  $.ui.toast(text, { timeoutMs: PROPOSAL_TOAST_MS })
  $.ui.log(text, { to: 'transcript' })
}

async function dismissProposal($: EngineInterface): Promise<string> {
  const sessionId = await $.session.id()
  const history = await loadHistory($)
  const projectDir = history.find(item => item.sessionId === sessionId)?.projectDir ?? (await $.session.root())
  // Without a measurement there is nothing to compare later, so the refusal holds until it is lifted by hand.
  const share = measuredShare(history, projectDir)?.share ?? 1
  const dismissals = parseDismissals(await $.store.get(STORE_DISMISSED))
  await $.store.set(STORE_DISMISSED, { ...dismissals, [projectDir]: { at: await $.clock.now(), share } })
  return `lean-context: proposta recusada para ${projectDir}. So volta se o ganho subir pelo menos ${Math.round(RESURFACE_GAIN * 100)} pontos percentuais; /lean apply continua disponivel.`
}

async function modeAt(
  $: EngineInterface,
  projectDir: string,
  sessionId: string,
  cfg: LeanOptions,
): Promise<Decision | undefined> {
  if ((await inertReason($, cfg, projectDir)) !== undefined) return undefined
  return probeDecision($, projectDir, cfg, await readOverride($, sessionId))
}

async function buildPanel($: EngineInterface, cfg: LeanOptions): Promise<string> {
  const sessionId = await $.session.id()
  const history = await loadHistory($)
  const record = history.find(item => item.sessionId === sessionId)
  const projectDir = record?.projectDir ?? (await $.session.root())
  const current = await modeAt($, projectDir, sessionId, cfg)

  return renderPanel({
    version: VERSION,
    instructionFile: cfg.instructionFile,
    applyCut: (await loadSettings($)).applyCut,
    current,
    inertWhy: current === undefined ? await inertReason($, cfg, projectDir) : undefined,
    record,
    history,
    diag: parseDiag(await $.store.get(STORE_DIAG)),
  })
}

async function currentModeText($: EngineInterface, cfg: LeanOptions): Promise<string> {
  const sessionId = await $.session.id()
  const record = (await loadHistory($)).find(item => item.sessionId === sessionId)
  const projectDir = record?.projectDir ?? (await $.session.root())
  const decision = await modeAt($, projectDir, sessionId, cfg)
  return decision === undefined
    ? `modo: nao se aplica (${await inertReason($, cfg, projectDir)})`
    : `modo: ${describeDecision(decision)}`
}

async function runModeCommand($: EngineInterface, value: string, cfg: LeanOptions): Promise<string> {
  const sessionId = await $.session.id()
  if (value === 'full' || value === 'lean') {
    await $.state.set(overrideRef, { sessionId, mode: value })
    return value === 'full'
      ? 'lean-context: modo full forcado nesta conversa. Se o contexto ja foi enviado sem seccoes, o lembrete segue no proximo pedido.'
      : 'lean-context: modo lean forcado nesta conversa, mesmo com spec ativa. Vale para o proximo contexto montado (/clear ou compactacao); o corte so se aplica se /lean apply estiver ativo.'
  }
  if (value === 'auto') {
    await $.state.set(overrideRef, null)
    return 'lean-context: modo automatico (decidido por spec ativa).'
  }
  if (value !== '') return 'uso: /lean mode full|lean|auto'
  return currentModeText($, cfg)
}

export const register: Register = (on, options) => {
  const cfg = parseOptions(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lean',
      description: 'lean-context: estado, historico e A/B; apply, simulate, dismiss, reset ou mode',
      argumentHint: '[apply|simulate|dismiss|reset|mode full|lean|auto]',
    })
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    try {
      return (await handleContext($, e, result, cfg)) ?? result
    } catch (error) {
      $.ui.log(`lean-context: context left whole (${messageOf(error)})`, { to: 'debug' })
      return result
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const reminder = await prepareReminder($, cfg).catch(() => undefined)
    if (reminder === undefined) return next(e)

    try {
      const result = await next({ ...e, context: [...(e.context ?? []), reminder.text] })
      if (result.drop !== undefined) await reminder.undo().catch(() => undefined)
      return result
    } catch (error) {
      await reminder.undo().catch(() => undefined)
      throw error
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const titles = await activeTitles($)
      if (titles === undefined) return composed
      return {
        sections: [...composed.sections, { id: SECTION_ID, text: composeNote(titles, cfg.instructionFile), scope: 'session' }],
      }
    } catch {
      return composed
    }
  })

  on('session.compact', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await clearActiveCut($, startedAt).catch(() => undefined)
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.index === 0 && e.agentId === undefined && result.usage !== null) {
      await recordFirstRequest($, result.usage).catch(() => undefined)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await measureAfterTurn($).catch(() => undefined)
      await maybePropose($).catch(() => undefined)
    }
    return result
  })

  on('command.run', { command: 'lean' }, async ($, e) => {
    const [subcommand = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (subcommand === '') return { text: await buildPanel($, cfg) }
    if (subcommand === 'apply') {
      await $.store.set(STORE_SETTINGS, { applyCut: true })
      return {
        text: 'lean-context: corte ATIVADO. Vale para conversas novas em modo lean (/clear ou sessao nova); esta conversa mantem o contexto ja enviado.',
      }
    }
    if (subcommand === 'simulate') {
      await $.store.set(STORE_SETTINGS, { applyCut: false })
      return {
        text: 'lean-context: voltou a SIMULAR. Conversas novas recebem o contexto completo; esta conversa mantem o que ja foi enviado.',
      }
    }
    if (subcommand === 'dismiss') return { text: await dismissProposal($) }
    if (subcommand === 'reset') {
      await $.store.delete(STORE_HISTORY)
      return { text: 'lean-context: historico de conversas apagado (o ajuste apply/simulate fica).' }
    }
    if (subcommand === 'mode') return { text: await runModeCommand($, value, cfg) }
    return { text: USAGE }
  })
}
