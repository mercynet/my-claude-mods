import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { parseArt } from './banner/art'
import type { Art } from './banner/art'
import { buildGrid, plainLines } from './banner/cells'
import { COMMAND, DEFAULT_COLORS, FRAME_MS, NO_TAGLINE, SWEEP_FRAMES, parseOptions } from './banner/config'
import type { BannerOptions } from './banner/config'
import { folderName, isAbsolute, joinPath, startsWithHome } from './banner/paths'
import { planBand } from './banner/plan'

const hasShown = atom({ plugin: 'session-banner', key: 'hasShown' } as const, false)
const isVisible = atom({ plugin: 'session-banner', key: 'isVisible' } as const, false)
const isColor = atom({ plugin: 'session-banner', key: 'isColor' } as const, true)
const frame = atom({ plugin: 'session-banner', key: 'frame' } as const, 0)
const shownAt = atom({ plugin: 'session-banner', key: 'shownAt' } as const, 0)
const artText = atom({ plugin: 'session-banner', key: 'art' } as const, null)
const tagline = atom({ plugin: 'session-banner', key: 'tagline' } as const, '')

let sweep: Timer | undefined
let linger: Timer | undefined
let parsed: { text: string; art: Art | null } | undefined

const artOf = (text: string): Art | null => {
  if (parsed?.text !== text) parsed = { text, art: parseArt(text) }
  return parsed.art
}

function stopTimers(): void {
  sweep?.cancel()
  sweep = undefined
  linger?.cancel()
  linger = undefined
}

async function homeDirectory($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home === undefined || home === '' ? null : home
}

async function artPath($: EngineInterface, file: string): Promise<string | null> {
  if (isAbsolute(file)) return file

  const home = await homeDirectory($)
  if (home === null) return null
  return joinPath(home, startsWithHome(file) ? file.slice(2) : file)
}

async function loadArt($: EngineInterface, options: BannerOptions): Promise<string | null> {
  try {
    const path = await artPath($, options.artFile)
    if (path === null) return null
    const text = await $.fs.read(path)
    return parseArt(text) === null ? null : text
  } catch {
    return null
  }
}

async function taglineOf($: EngineInterface, options: BannerOptions): Promise<string> {
  if (options.tagline === NO_TAGLINE) return ''
  if (options.tagline !== '') return options.tagline

  try {
    return folderName(await $.session.cwd())
  } catch {
    return ''
  }
}

async function isNoColor($: EngineInterface): Promise<boolean> {
  const value = await $.env.get('NO_COLOR')
  return value !== undefined && value !== ''
}

async function hide($: EngineInterface): Promise<void> {
  stopTimers()
  await update($, isVisible, () => false)
}

function armLinger($: EngineInterface, milliseconds: number): void {
  linger?.cancel()
  linger = $.clock.after(milliseconds, () => {
    linger = undefined
    void hide($).catch(() => undefined)
  })
}

async function step($: EngineInterface, timer: Timer | undefined): Promise<void> {
  try {
    const current = await update($, frame, count => Math.min(SWEEP_FRAMES, count + 1))
    if (current < SWEEP_FRAMES) return
  } catch {
    // A failed frame ends the sweep: the logo stays where it is, static.
  }
  timer?.cancel()
  if (sweep === timer) sweep = undefined
}

function startSweep($: EngineInterface): void {
  sweep?.cancel()
  const timer: Timer = $.clock.every(FRAME_MS, () => {
    void step($, timer)
  })
  sweep = timer
}

async function show($: EngineInterface, options: BannerOptions): Promise<'shown' | 'inert'> {
  const text = await loadArt($, options)
  stopTimers()
  if (text === null) {
    await update($, isVisible, () => false)
    return 'inert'
  }

  const isPainted = !(await isNoColor($))
  const now = await $.clock.now()
  await update($, artText, () => text)
  const line = await taglineOf($, options)
  await update($, tagline, () => line)
  await update($, isColor, () => isPainted)
  await update($, frame, () => (isPainted ? 0 : SWEEP_FRAMES))
  await update($, shownAt, () => now)
  await update($, hasShown, () => true)
  await update($, isVisible, () => true)

  if (isPainted) startSweep($)
  if (options.lingerSeconds > 0) armLinger($, options.lingerSeconds * 1000)
  return 'shown'
}

async function settle($: EngineInterface, options: BannerOptions): Promise<void> {
  if (!(await read($, isVisible))) return

  await update($, frame, () => SWEEP_FRAMES)
  if (options.lingerSeconds === 0) return

  const remaining = (await read($, shownAt)) + options.lingerSeconds * 1000 - (await $.clock.now())
  if (remaining <= 0) await hide($)
  else armLinger($, remaining)
}

export const register: Register = (on, raw) => {
  const options = parseOptions(raw)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'session-banner: mostra o logo outra vez acima do prompt (some no próximo prompt)',
    })
    const started = await next(e)

    if (!e.isInteractive || e.surface === null) return started

    try {
      if (await read($, hasShown)) await settle($, options)
      else await show($, options)
    } catch {
      // The logo is cosmetic: a failure here must never reach the session.
    }

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if (await read($, isVisible)) await hide($)
    } catch {
      // Hiding is best effort; the prompt itself must go through untouched.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    const result = await show($, options)

    return {
      text:
        result === 'shown'
          ? 'session-banner: logo exibido acima do prompt; some no próximo prompt.'
          : `session-banner: não consegui ler a arte em ${options.artFile}.`,
    }
  }).catch(() => ({ text: 'session-banner: falha interna ao exibir o logo (veja claude --debug)' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isVisible))) return next(e)

    const [text, count, started, isPainted, line] = await Promise.all([
      read($, artText),
      read($, frame),
      read($, shownAt),
      read($, isColor),
      read($, tagline),
    ])
    const art = text === null ? null : artOf(text)
    if (art === null) return next(e)
    if (options.lingerSeconds > 0 && (await $.clock.now()) - started >= options.lingerSeconds * 1000) return next(e)

    const below = await next(e)
    const plan = planBand(art, e.props.bodyColumns, e.props.maxRows, line !== '')
    if (plan === null) return below

    const hasBelow = below.type !== 'engine'
    const look = { stops: options.colors, isColor: isPainted, frame: count }

    if (e.surface === 'terminal') {
      const { Box, Raster, Text } = $.ui.resolve(e)
      const grid = buildGrid(art, plan, look)
      const banner = (
        <Box flexDirection="column" alignItems="flex-start">
          <Raster key="banner-art" columns={grid.columns} rows={grid.rows} cells={grid.cells} />
          {plan.hasTagline && (
            <Box paddingLeft={art.inkMin}>
              <Text dimColor wrap="truncate">
                {line}
              </Text>
            </Box>
          )}
        </Box>
      )
      return hasBelow ? <Box flexDirection="column">{banner}{below}</Box> : banner
    }

    const { Box, Text } = $.ui.resolve(e)
    const [red, green, blue] = options.colors[0] ?? DEFAULT_COLORS[0] ?? [0, 0, 0]
    const hex = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
    const banner = (
      <Box flexDirection="column">
        {plainLines(art, plan).map((row, index) => (
          <Text key={`row-${index}`} {...(isPainted ? { color: hex } : {})} wrap="truncate">
            {row}
          </Text>
        ))}
        {plan.hasTagline && (
          <Text dimColor wrap="truncate">
            {line}
          </Text>
        )}
      </Box>
    )
    return hasBelow ? <Box flexDirection="column">{banner}{below}</Box> : banner
  })
}
