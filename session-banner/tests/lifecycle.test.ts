import { describe, expect, test } from 'claude-code/testing'

import { FRAME_MS, SWEEP_FRAMES } from '../hooks/banner/config'
import { DEFAULT_FG } from '../hooks/banner/color'
import {
  ART_PATH,
  HOME,
  ROOT,
  asDrawn,
  banner,
  collect,
  finishTurn,
  flatten,
  isEngineDrawn,
  mountBand,
  newWorld,
  rasterOf,
  stand,
  startHeadless,
  startSession,
  submit,
} from './world'

const SWEEP_MS = FRAME_MS * (SWEEP_FRAMES + 2)

describe('at session start', () => {
  test('registers /banner', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    await startSession($)

    expect(world.registered).toEqual(['banner'])
  })

  test('shows the logo above the prompt, with the folder name as tagline', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)

    expect(await isEngineDrawn(ui)).toBe(true)

    await startSession($)
    await clock.settle()

    const raster = rasterOf(await ui.drawn())
    expect(raster).toMatchObject({ columns: 11, rows: 4 })
    expect(flatten(asDrawn(await ui.drawn()))).toBe('example-app')
  })

  test('a session nobody is looking at shows nothing and does not use up the one chance', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($, false)
    await clock.settle()
    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.reads).toEqual([])

    await startSession($)
    await clock.settle()
    expect(rasterOf(await ui.drawn())).toBeDefined()
  })

  test('an art file that cannot be read keeps the mod inert and never throws', async ($, on) => {
    const world = newWorld()
    world.broken.add(ART_PATH)
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a missing home directory leaves a ~ path unresolved and the mod inert', async ($, on) => {
    const world = newWorld({ env: {} })
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.reads).toEqual([])
  })

  test('a relative art path is read from the home directory', { options: { artFile: 'art/logo.txt' } }, async ($, on) => {
    const world = newWorld()
    world.files.set(`${HOME}/art/logo.txt`, '███')
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toMatchObject({ columns: 3 })
    expect(world.reads).toEqual([`${HOME}/art/logo.txt`])
  })
})

describe('in any project', () => {
  test('a folder that is not a git repository gets the same logo and the folder name', async ($, on) => {
    const world = newWorld({ cwd: '/srv/example/scratch-notes' })
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($, true, '/srv/example/scratch-notes')
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toMatchObject({ columns: 11, rows: 4 })
    expect(flatten(asDrawn(await ui.drawn()))).toBe('scratch-notes')
  })

  test('never runs a process, never asks for the project root and never needs the repository', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    await startSession($)
    await submit($)
    await banner($)
    await clock.advance(10_000)

    expect(world.processCalls).toBe(0)
    expect(world.rootCalls).toBe(0)
    expect(world.reads).toEqual([ART_PATH, ART_PATH])
  })

  test('a session at the filesystem root has no tagline but still has the logo', async ($, on) => {
    const world = newWorld({ cwd: '/' })
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($, true, '/')
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toMatchObject({ rows: 3 + 1 })
    expect(flatten(asDrawn(await ui.drawn()))).toBe('')
  })

  test('a Windows drive root has no tagline and a Windows folder uses its own name', async ($, on) => {
    const world = newWorld({ cwd: 'C:\\' })
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($, true, 'C:\\')
    await clock.settle()
    expect(flatten(asDrawn(await ui.drawn()))).toBe('')

    world.cwd = 'C:\\Users\\dev\\example-app'
    await banner($)
    await clock.settle()
    expect(flatten(asDrawn(await ui.drawn()))).toBe('example-app')
  })

  test('a session folder that cannot be read still gets the logo, with no tagline', async ($, on) => {
    const world = newWorld({ cwd: new Error('EACCES') })
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toBeDefined()
    expect(flatten(asDrawn(await ui.drawn()))).toBe('')
  })

  test('a headless run (-p or the SDK) draws nothing, fails nothing and keeps the one chance', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startHeadless($)
    await clock.advance(60_000)

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.reads).toEqual([])
    expect(world.toasts).toEqual([])
    expect(world.logs).toEqual([])

    await startSession($)
    await clock.settle()
    expect(rasterOf(await ui.drawn())).toBeDefined()
  })

  test('a session with no surface draws nothing even when it claims to be interactive', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)

    await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.reads).toEqual([])
  })

  test('a fresh home without the art file is inert: no toast, no log line, no error', async ($, on) => {
    const world = newWorld({ files: new Map() })
    const clock = stand(on, world)
    const ui = await mountBand($)

    await startSession($)
    await submit($)
    await clock.advance(60_000)

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.toasts).toEqual([])
    expect(world.logs).toEqual([])
    expect(world.reads).toEqual([ART_PATH])
  })
})

describe('only once per session', () => {
  test('the first prompt hides it', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.settle()
    expect(rasterOf(await ui.drawn())).toBeDefined()

    await submit($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a second session.start after it was shown does not show it again (reload, /clear)', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await submit($)
    await clock.settle()
    const reads = world.reads.length

    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.reads).toHaveLength(reads)
  })

  test('a reload while it is still on screen keeps it there and does not start over', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await clock.advance(FRAME_MS * 3)
    const reads = world.reads.length

    await startSession($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toBeDefined()
    expect(world.reads).toHaveLength(reads)
  })

  test('a reload in the middle of the sweep leaves the logo static, not frozen mid-flash', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.advance(FRAME_MS * 4)
    await startSession($)
    await clock.settle()

    const afterReload = rasterOf(await ui.drawn())
    await clock.advance(SWEEP_MS * 2)

    expect(rasterOf(await ui.drawn())).toEqual(afterReload)
  })

  test('nothing brings it back by itself: not a turn, not another prompt, not time', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await submit($)
    await clock.settle()
    const writes = world.frameWrites

    await finishTurn($)
    await submit($, 'again')
    await clock.advance(60 * 60 * 1000)

    expect(await isEngineDrawn(ui)).toBe(true)
    expect(world.frameWrites).toBe(writes)
  })

  test('/banner is the only way back and it replays the sweep', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await submit($)
    await clock.settle()
    expect(await isEngineDrawn(ui)).toBe(true)

    const answer = await banner($)
    await clock.settle()
    const first = rasterOf(await ui.drawn())
    await clock.advance(FRAME_MS * 10)
    const mid = rasterOf(await ui.drawn())
    await clock.advance(SWEEP_MS)
    const last = rasterOf(await ui.drawn())

    expect(answer.text).toContain('logo exibido')
    expect(first).toBeDefined()
    expect(mid).not.toEqual(first)
    expect(last).toEqual(first)
    expect(world.reads).toHaveLength(2)
  })

  test('/banner still hides at the next prompt', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await submit($)
    await banner($)
    await clock.settle()
    expect(rasterOf(await ui.drawn())).toBeDefined()

    await submit($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('/banner with an unreadable art file says so and shows nothing', async ($, on) => {
    const world = newWorld()
    world.broken.add(ART_PATH)
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    const answer = await banner($)
    await clock.settle()

    expect(answer.text).toContain('não consegui ler')
    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('once the file exists, /banner works even though the start found nothing', async ($, on) => {
    const world = newWorld()
    world.broken.add(ART_PATH)
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    world.broken.delete(ART_PATH)

    await banner($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toBeDefined()
  })
})

describe('the shimmer timer', () => {
  test('runs one frame per tick and stops by itself when the sweep is done', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    const first = rasterOf(await ui.drawn())

    await clock.advance(FRAME_MS * 8)
    expect(rasterOf(await ui.drawn())).not.toEqual(first)

    await clock.advance(SWEEP_MS)
    const writes = world.frameWrites
    const still = rasterOf(await ui.drawn())
    await clock.advance(60_000)

    expect(world.frameWrites).toBe(writes)
    expect(rasterOf(await ui.drawn())).toEqual(still)
    expect(writes).toBeLessThanOrEqual(SWEEP_FRAMES + 1)
  })

  test('the first prompt in the middle of the sweep cancels it', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    await startSession($)
    await clock.advance(FRAME_MS * 3)

    await submit($)
    await clock.settle()
    const writes = world.frameWrites
    await clock.advance(60_000)

    expect(world.frameWrites).toBe(writes)
  })

  test('/banner twice never leaves two sweeps running', async ($, on) => {
    const world = newWorld()
    const clock = stand(on, world)
    await startSession($)
    await clock.advance(FRAME_MS * 2)
    await banner($)
    await banner($)
    const before = world.frameWrites
    await clock.advance(FRAME_MS * 5)

    expect(world.frameWrites - before).toBe(5)

    await clock.advance(SWEEP_MS * 2)
    const writes = world.frameWrites
    await clock.advance(60_000)

    expect(world.frameWrites).toBe(writes)
  })

  test('without color there is no sweep at all and the foreground is the terminal default', async ($, on) => {
    const world = newWorld({ env: { HOME, NO_COLOR: '1' } })
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    const writes = world.frameWrites
    await clock.advance(SWEEP_MS)

    const raster = rasterOf(await ui.drawn())
    expect(raster?.cells.every(cell => cell.fg === DEFAULT_FG)).toBe(true)
    expect(world.frameWrites).toBe(writes)
  })
})

describe('lingerSeconds', () => {
  test('hides it by itself after the time, with no prompt', { options: { lingerSeconds: 5 } }, async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    await clock.advance(4_900)
    expect(rasterOf(await ui.drawn())).toBeDefined()

    await clock.advance(200)
    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a reload keeps counting from when it was first shown', { options: { lingerSeconds: 10 } }, async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.advance(6_000)

    await startSession($)
    await clock.advance(3_900)
    expect(rasterOf(await ui.drawn())).toBeDefined()

    await clock.advance(200)
    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a reload after the time is up hides it', { options: { lingerSeconds: 2 } }, async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.advance(2_100)

    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })
})

describe('what it draws', () => {
  test('yields to a survey', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($, { hasSurvey: true })
    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a custom tagline replaces the folder name', { options: { tagline: 'my team' } }, async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.settle()

    expect(flatten(asDrawn(await ui.drawn()))).toBe('my team')
  })

  test('a hyphen turns the tagline off', { options: { tagline: '-' } }, async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.settle()

    expect(flatten(asDrawn(await ui.drawn()))).toBe('')
    expect(rasterOf(await ui.drawn())).toMatchObject({ rows: 4 })
  })

  test('a short band drops the tagline and the rule instead of cutting the logo', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($, { maxRows: 3 })
    await startSession($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toMatchObject({ rows: 3 })
    expect(flatten(asDrawn(await ui.drawn()))).toBe('')
  })

  test('a band too short for the logo draws nothing', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($, { maxRows: 2 })
    await startSession($)
    await clock.settle()

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('clips to a narrow band', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($, { bodyColumns: 9 })
    await startSession($)
    await clock.settle()

    expect(rasterOf(await ui.drawn())).toMatchObject({ columns: 9 })
  })

  test('draws plain colored text on the desktop surface', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($, {}, 'desktop')
    await startSession($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())
    const rows = collect(tree, 'Text')

    expect(collect(tree, 'Raster')).toHaveLength(0)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows[0]?.props?.color).toBe('#1f6fb2')
    expect(flatten(tree)).toContain('example-app')
  })
})
