import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ClearSample,
  CompactionStatus,
  ContextWeight,
  HistoryEntry,
  LimitWindow,
  RereadProbe,
  Review,
  Signal,
  ToolStat
} from '../types'

import { summarizeBreakdown } from './logic/breakdown'
import { buildInstructions, errorText, vetoText } from './logic/compact'
import { compactNumber } from './logic/format'
import type { Span } from './logic/gauge'
import { isRepeat, lastTurnPoint, toTurnPoint, withMarker, withPoint } from './logic/history'
import { isCompactMarker, updateLimitWindows } from './logic/projection'
import {
  REREAD_TURNS,
  makeReview,
  ratedSamples,
  rateLatest,
  readProbe,
  readReviews,
  recordToolStat,
  rereadShare,
  reviewsSummary,
  withRead,
  withReread,
  withReview
} from './logic/reviews'
import {
  SIGNAL_POINTS,
  bashCheckpoints,
  countsTowardLoop,
  gitOperationOf,
  nextFailures,
  taskCheckpoint,
  testCommandPattern,
  todoCheckpoint,
  todoCounts,
  withEdit,
  withSignals
} from './logic/signals'
import type { SignalDraft } from './logic/signals'
import { appendSample, readSamples } from './logic/thresholds'
import { buildView, explanation, panelRows } from './logic/view'
import type { ReadState } from './logic/view'

const PANE = 'forecast'
const REFRESH_COUNTDOWN_MS = 60_000
const TOPIC_MIN_TOKENS = 30_000
const TOPIC_MIN_TURNS = 3
const TOPIC_MIN_TEXT = 20
const TOPIC_EXCERPT = 400
const CONFIRM_QUESTION = 'compactar preservando plano, card, branch e ficheiros tocados?  '

const history = atom({ plugin: 'context-forecast', key: 'history' } as const, [] as HistoryEntry[])
const turns = atom({ plugin: 'context-forecast', key: 'turns' } as const, 0)
const signals = atom({ plugin: 'context-forecast', key: 'signals' } as const, [] as Signal[])
const failures = atom({ plugin: 'context-forecast', key: 'failures' } as const, {} as Record<string, number>)
const edited = atom({ plugin: 'context-forecast', key: 'edited' } as const, [] as string[])
const touched = atom({ plugin: 'context-forecast', key: 'touched' } as const, [] as string[])
const limits = atom({ plugin: 'context-forecast', key: 'limits' } as const, [] as LimitWindow[])
const cost = atom({ plugin: 'context-forecast', key: 'cost' } as const, null as number | null)
const weight = atom({ plugin: 'context-forecast', key: 'weight' } as const, null as ContextWeight | null)
const samples = atom({ plugin: 'context-forecast', key: 'samples' } as const, [] as ClearSample[])
const reads = atom({ plugin: 'context-forecast', key: 'reads' } as const, [] as string[])
const toolStats = atom({ plugin: 'context-forecast', key: 'toolStats' } as const, [] as ToolStat[])
const probe = atom({ plugin: 'context-forecast', key: 'probe' } as const, null as RereadProbe | null)
const reviews = atom({ plugin: 'context-forecast', key: 'reviews' } as const, [] as Review[])
const confirming = atom({ plugin: 'context-forecast', key: 'confirming' } as const, false)
const compaction = atom({ plugin: 'context-forecast', key: 'compaction' } as const, null as CompactionStatus | null)
const lastPrompt = atom({ plugin: 'context-forecast', key: 'lastPrompt' } as const, '')

const styleOf = (span: Span) => ({
  ...(span.color === undefined ? {} : { color: span.color }),
  ...(span.bold === true ? { bold: true } : {}),
  ...(span.dim === true ? { dimColor: true } : {})
})

const isBlank = (spans: readonly Span[]): boolean => spans.every(span => span.text === '')

// The validator only follows `$` into functions declared at the top of the file, so every helper
// that takes it lives here and receives the options it needs as plain arguments.
const readState = async ($: EngineInterface, calibrate: boolean): Promise<ReadState> => ({
  history: await read($, history),
  turns: await read($, turns),
  signals: await read($, signals),
  failures: await read($, failures),
  edited: await read($, edited),
  limits: await read($, limits),
  cost: await read($, cost),
  weight: await read($, weight),
  samples: ratedSamples(await read($, samples), await read($, reviews)),
  compaction: await read($, compaction),
  calibrate
})

const resetSession = async ($: EngineInterface) => {
  await update($, history, () => [])
  await update($, turns, () => 0)
  await update($, signals, () => [])
  await update($, failures, () => ({}))
  await update($, edited, () => [])
  await update($, touched, () => [])
  await update($, reads, () => [])
  await update($, toolStats, () => [])
  await update($, weight, () => null)
  await update($, confirming, () => false)
  await update($, compaction, () => null)
  await update($, lastPrompt, () => '')
}

const recordSample = async (
  $: EngineInterface,
  calibrate: boolean,
  tokens: number,
  window: number,
  reason: ClearSample['reason']
) => {
  if (!calibrate) return

  const stored = readSamples(await $.store.get('samples'))
  const all = appendSample(stored, { tokens, window, reason, at: await $.clock.now() })

  await $.store.set('samples', all)
  await update($, samples, () => all)
}

const persistReviews = async ($: EngineInterface, all: Review[]) => {
  await $.store.set('reviews', all)
  await update($, reviews, () => all)
}

// Snapshot of what the mod saw when the person cleared or compacted, so a later verdict can be checked against it.
const recordReview = async (
  $: EngineInterface,
  calibrate: boolean,
  reason: Review['reason'],
  tokens: number,
  window: number
): Promise<Review | null> => {
  const now = await $.clock.now()
  const view = buildView(await readState($, calibrate), now)

  if (view === null) return null

  const review = makeReview({
    at: now,
    reason,
    tokens,
    window,
    assessment: view.assessment,
    stats: await read($, toolStats),
    turns: await read($, turns)
  })

  await persistReviews($, withReview(readReviews(await $.store.get('reviews')), review))

  return review
}

// After a clear, the first turns say whether the new context had to rebuild what the old one already held.
const armProbe = async ($: EngineInterface, review: Review) => {
  const before = await read($, reads)

  await $.store.set('probe', { reviewAt: review.at, before })
  await update($, probe, () => ({ reviewAt: review.at, before, after: [] }))
}

const settleProbe = async ($: EngineInterface, turn: number) => {
  const current = await read($, probe)

  if (current === null) return

  const stored = readReviews(await $.store.get('reviews'))

  if (turn === 1 && stored.find(review => review.at === current.reviewAt)?.verdict === null) {
    $.ui.toast('Avalie o clear anterior: /forecast rate cedo | certo | tarde')
  }

  if (turn < REREAD_TURNS) return

  await persistReviews($, withReread(stored, current.reviewAt, rereadShare(current.before, current.after)))
  await $.store.set('probe', null)
  await update($, probe, () => null)
}

// `summary` estimates locally and spends no calls; `full` counts through the API and only runs when asked for.
const measureWeight = async ($: EngineInterface, detail: ContextWeight['detail']) => {
  const usage = await $.session.usage({ breakdown: detail }).catch(() => null)
  const breakdown = usage?.context.breakdown

  if (breakdown !== undefined) await update($, weight, () => summarizeBreakdown(breakdown, detail))
}

const recordSignals = async ($: EngineInterface, drafts: readonly SignalDraft[]) => {
  if (drafts.length === 0) return

  const turn = (await read($, turns)) + 1

  await update($, signals, current => withSignals(current, turn, drafts))
}

const compactNow = async ($: EngineInterface, calibrate: boolean) => {
  const now = await $.clock.now()
  const point = lastTurnPoint(await read($, history))
  const setStatus = (state: CompactionStatus['state'], text: string) =>
    update($, compaction, () => ({ state, text, at: now }))

  await update($, confirming, () => false)
  await setStatus('running', 'compactando...')

  try {
    const result = await $.session.compact({ instructions: buildInstructions(await read($, touched)) })

    if (result.skip !== undefined) {
      const text = vetoText(result.skip)

      await setStatus('vetoed', text)
      $.ui.toast(text)

      return
    }

    const before = result.tokensBefore ?? point?.tokens ?? null
    const after = result.tokensAfter

    await update($, history, current => withMarker(current, { kind: 'compact', origin: 'plugin', before }))

    if (before !== null && point !== undefined) {
      await recordSample($, calibrate, before, point.window, 'compact')
      await recordReview($, calibrate, 'compact', before, point.window)
    }

    await setStatus(
      'done',
      before === null || after === undefined ? 'compactado' : `compactado: ${compactNumber(before)} -> ${compactNumber(after)}`
    )
  } catch (error) {
    const text = errorText(error)

    await setStatus('error', text)
    $.ui.toast(text)
  }
}

export const register: Register = (on, options) => {
  const calibrateOn = options.calibrate !== false
  const topicOn = options.classifyTopic === true
  const topicModel = typeof options.topicModel === 'string' && options.topicModel !== '' ? options.topicModel : 'haiku'
  const testPattern = testCommandPattern(typeof options.extraTestPattern === 'string' ? options.extraTestPattern : '')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'forecast',
      description: 'Painel da previsão do contexto: o que pesa, limites de uso, limiares e amostras; rate avalia o último clear',
      argumentHint: '[why|full|rate cedo|certo|tarde]'
    })

    const stored = readSamples(await $.store.get('samples'))

    await update($, samples, () => stored)
    const storedReviews = readReviews(await $.store.get('reviews'))

    await update($, reviews, () => storedReviews)

    const pending = readProbe(await $.store.get('probe'), await $.clock.now())

    await update($, probe, current => current ?? pending)

    const point = toTurnPoint((await $.session.usage().catch(() => null))?.context ?? { window: 0 })

    if (point !== null) await update($, history, current => (current.length === 0 ? [point] : current))

    await measureWeight($, 'summary')

    $.clock.every(REFRESH_COUNTDOWN_MS, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // Fires after each turn of the main conversation.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()

    if (e.changed.includes('rateLimits')) await update($, limits, current => updateLimitWindows(current, e.rateLimits, now))

    if (e.cost !== undefined) await update($, cost, () => e.cost?.usd ?? null)

    if (e.changed.includes('context')) {
      const point = toTurnPoint(e.context)

      if (point !== null && !isRepeat(await read($, history), point)) {
        const nextTurn = (await read($, turns)) + 1

        await update($, history, current => withPoint(current, point))
        await update($, turns, () => nextTurn)
        await update($, signals, current => current.filter(s => s.turn >= nextTurn))
        await settleProbe($, nextTurn)
      }

      await measureWeight($, 'summary')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined) return ran

    const failed = ran.isError === true
    const turn = (await read($, turns)) + 1

    await update($, failures, current => nextFailures(current, e.tool, failed))
    await update($, toolStats, current => recordToolStat(current, turn, failed))

    if (failed) return ran

    if (e.tool === 'Read') {
      const open = await read($, probe)

      await update($, reads, current => withRead(current, e.file_path))

      if (open !== null) await update($, probe, () => ({ ...open, after: withRead(open.after, e.file_path) }))
    }

    if (e.tool === 'Bash') {
      const drafts = bashCheckpoints(
        e.command,
        { isError: false, text: ran.text, git: gitOperationOf(ran.result) },
        testPattern
      )

      await recordSignals($, drafts)

      if (drafts.some(draft => draft.kind === 'pest')) await update($, edited, () => [])
    }

    if (e.tool === 'TodoWrite') {
      const draft = todoCheckpoint(todoCounts(ran.result))

      if (draft !== null) await recordSignals($, [draft])
    }

    if (e.tool === 'TaskUpdate') {
      const draft = taskCheckpoint(e.status)

      if (draft !== null) await recordSignals($, [draft])
    }

    const path =
      e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : e.tool === 'NotebookEdit' ? e.notebook_path : undefined

    if (path !== undefined) {
      const updated = withEdit(await read($, edited), await read($, touched), path)
      const hasOpenFailure = Object.keys(await read($, failures)).length > 0

      if (countsTowardLoop(path, hasOpenFailure)) await update($, edited, () => updated.edited)

      await update($, touched, () => updated.touched)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The classifier runs after the prompt has entered, so the turn never waits for it.
  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)

    if (!topicOn || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return ran
    if (e.text.trim().length < TOPIC_MIN_TEXT) return ran

    const previous = await read($, lastPrompt)
    const point = lastTurnPoint(await read($, history))
    const turn = await read($, turns)
    const excerpt = e.text.slice(0, TOPIC_EXCERPT)

    await update($, lastPrompt, () => excerpt)

    if (previous === '' || point === undefined || point.tokens < TOPIC_MIN_TOKENS || turn < TOPIC_MIN_TURNS) return ran

    const question = `Pergunta: o NOVO pedido continua o mesmo assunto do ANTERIOR ou muda para outro assunto?\n\nANTERIOR:\n${previous}\n\nNOVO:\n${excerpt}`
    const label = await $.model.classify(question, ['mesmo assunto', 'outro assunto'], { model: topicModel })

    if (label === 'outro assunto') {
      await recordSignals($, [{ kind: 'topic', label: 'mudança de assunto', points: SIGNAL_POINTS.topic }])
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The mod's own `$.session.compact` never reaches this hook: its result is handled in `compactNow`.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    if (e.trigger === 'precompute' || e.agentId !== undefined) return result

    const now = await $.clock.now()
    const point = lastTurnPoint(await read($, history))

    if (result.skip !== undefined) {
      const text = vetoText(result.skip)

      await update($, compaction, () => ({ state: 'vetoed', text, at: now }))
      $.ui.toast(text)

      return result
    }

    const before = result.tokensBefore ?? point?.tokens ?? null
    const origin = e.trigger === 'auto' ? 'auto' : e.trigger === 'plugin' ? 'plugin' : 'manual'

    await update($, history, current => withMarker(current, { kind: 'compact', origin, before }))
    await update($, compaction, () => ({
      state: 'done',
      text: `${origin === 'auto' ? 'auto-compact' : 'compactação'} feita${before === null ? '' : ` a partir de ${compactNumber(before)}`}`,
      at: now
    }))

    if (origin === 'auto') {
      $.ui.toast('auto-compact correu sem passar pelo gate PreCompact manual')
    } else if (before !== null && point !== undefined) {
      await recordSample($, calibrateOn, before, point.window, 'compact')
      await recordReview($, calibrateOn, 'compact', before, point.window)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const point = lastTurnPoint(await read($, history))

      if (point !== undefined) {
        await recordSample($, calibrateOn, point.tokens, point.window, 'clear')

        const review = await recordReview($, calibrateOn, 'clear', point.tokens, point.window)

        if (review !== null) await armProbe($, review)
      }

      await resetSession($)
    }

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') await resetSession($)

    if (e.source === 'compact') {
      await update($, history, current => {
        const last = current.at(-1)

        return last !== undefined && isCompactMarker(last)
          ? current
          : withMarker(current, { kind: 'compact', origin: 'manual', before: null })
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'forecast' }, async ($, e) => {
    const argument = e.args.trim().toLowerCase()

    if (argument === 'why') {
      const view = buildView(await readState($, calibrateOn), await $.clock.now())

      const summary = reviewsSummary(readReviews(await $.store.get('reviews')))

      return {
        text:
          view === null
            ? 'Ainda sem medição do contexto: o aviso aparece depois do primeiro turno.'
            : [explanation(view), ...summary].join('\n')
      }
    }

    if (argument === 'rate' || argument.startsWith('rate ')) {
      const answer = rateLatest(readReviews(await $.store.get('reviews')), argument.slice(4))

      if (answer.reviews.length > 0) await persistReviews($, answer.reviews)

      return { text: answer.text }
    }

    if (argument === 'full') await measureWeight($, 'full')

    const opened = await $.ui.open({ id: PANE, title: 'Previsão do contexto' })

    return { text: opened.isPlaced ? 'Painel da previsão do contexto aberto.' : `Painel não aberto: ${opened.reason}` }
  }).catch(() => ({ text: 'forecast: falha interna ao executar o comando (veja claude --debug)' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const state = await readState($, calibrateOn)
    const view = buildView(state, await $.clock.now(), e.props.bodyColumns)

    if (e.props.hasSurvey || view === null) {
      return below
    }

    const asking = await read($, confirming)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const { note } = view

    const own = (
      <Box width={width} flexDirection="column" alignItems="flex-end">
        <Text wrap="truncate">
          {view.headline.map((span, i) => (
            <Text key={`headline-${i}`} {...styleOf(span)}>
              {span.text}
            </Text>
          ))}
        </Text>
        {note !== null && (
          <Box width={width} justifyContent="flex-end">
            <Text color={note.color} bold wrap="truncate">
              {`▸ ${note.text}`}
            </Text>
            {note.hasButton && !asking && <Text> </Text>}
            {note.hasButton && !asking && (
              <Button key="compact" label="compact" hotkey="c" onPress={() => update($, confirming, () => true)} />
            )}
          </Box>
        )}
        {asking && (
          <Box>
            <Text color="yellow" bold>
              {CONFIRM_QUESTION}
            </Text>
            <Button key="confirm" label="sim" hotkey="s" variant="primary" onPress={() => compactNow($, calibrateOn)} />
            <Text> </Text>
            <Button key="cancel" label="não" hotkey="n" onPress={() => update($, confirming, () => false)} />
          </Box>
        )}
      </Box>
    )

    return below.type === 'engine' ? (
      own
    ) : (
      <Box flexDirection="column">
        {own}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await readState($, calibrateOn)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    const view = buildView(state, now, columns)
    const asking = await read($, confirming)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows: Span[][] =
      view === null
        ? [[{ text: 'Ainda sem medição do contexto: aparece depois do primeiro turno.', dim: true }]]
        : panelRows(view, state, now, columns)

    return (
      <Box flexDirection="column">
        {rows.map((row, i) => (
          <Text key={`row-${i}`}>
            {isBlank(row)
              ? ' '
              : row.map((span, j) => (
                  <Text key={`row-${i}-${j}`} {...styleOf(span)}>
                    {span.text}
                  </Text>
                ))}
          </Text>
        ))}
        <Text> </Text>
        {!asking && (
          <Box>
            <Button key="compact" label="compact" hotkey="c" variant="primary" onPress={() => update($, confirming, () => true)} />
            <Text> </Text>
            <Button key="close" label="fechar" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        )}
        {asking && (
          <Box>
            <Text color="yellow" bold>
              {CONFIRM_QUESTION}
            </Text>
            <Button key="confirm" label="sim" hotkey="s" variant="primary" onPress={() => compactNow($, calibrateOn)} />
            <Text> </Text>
            <Button key="cancel" label="não" hotkey="n" onPress={() => update($, confirming, () => false)} />
          </Box>
        )}
      </Box>
    )
  })
}
