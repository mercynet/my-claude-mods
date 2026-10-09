import type { RenderElement } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { asDrawn, collect, flatten, isEngineDrawn, mountBand, newWorld, rasterOf, stand, startSession, submit } from './world'
import type { Drawn } from './world'

const FORECAST: RenderElement = { type: 'Text', children: ['forecast: 42%'] }

const below = (text = 'forecast: 42%'): RenderElement => ({ type: 'Box', children: [{ type: 'Text', children: [text] }] })

const kids = (node: Drawn): Drawn[] => (typeof node === 'string' ? [] : (node.children ?? []))

describe('sharing the band with another mod', () => {
  test('draws the logo on top and what sits beneath it after it, as one valid tree', async ($, on) => {
    const world = newWorld({ below: below() })
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())
    const [top, bottom] = kids(tree)

    expect(collect(tree, 'Raster')).toHaveLength(1)
    expect(top && collect(top, 'Raster')).toHaveLength(1)
    expect(bottom && flatten(bottom)).toBe('forecast: 42%')
    expect(flatten(tree)).toContain('forecast: 42%')
  })

  test('with nothing beneath, the logo is drawn without a wrapper', async ($, on) => {
    const clock = stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())

    expect(kids(tree)[0]).toMatchObject({ type: 'Raster' })
  })

  test('after the first prompt the other mod draws alone, untouched', async ($, on) => {
    const world = newWorld({ below: FORECAST })
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    await submit($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())

    expect(collect(tree, 'Raster')).toHaveLength(0)
    expect(flatten(tree)).toBe('forecast: 42%')
  })

  test('a band too narrow for the logo leaves the other mod as it was', async ($, on) => {
    const world = newWorld({ below: below('narrow') })
    const clock = stand(on, world)
    const ui = await mountBand($, { bodyColumns: 3 })
    await startSession($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())

    expect(collect(tree, 'Raster')).toHaveLength(0)
    expect(flatten(tree)).toBe('narrow')
  })

  test('yields to a survey without touching what is beneath', async ($, on) => {
    const world = newWorld({ below: FORECAST })
    const clock = stand(on, world)
    const ui = await mountBand($, { hasSurvey: true })
    await startSession($)
    await clock.settle()

    expect(flatten(asDrawn(await ui.drawn()))).toBe('forecast: 42%')
  })

  test('the logo animates while the other mod stays put', async ($, on) => {
    const world = newWorld({ below: below() })
    const clock = stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    const first = rasterOf(await ui.drawn())

    await clock.advance(66 * 8)

    expect(rasterOf(await ui.drawn())).not.toEqual(first)
    expect(flatten(asDrawn(await ui.drawn()))).toContain('forecast: 42%')
  })

  test('composes on the desktop surface too', async ($, on) => {
    const world = newWorld({ below: below() })
    const clock = stand(on, world)
    const ui = await mountBand($, {}, 'desktop')
    await startSession($)
    await clock.settle()

    const tree = asDrawn(await ui.drawn())

    expect(collect(tree, 'Raster')).toHaveLength(0)
    expect(flatten(tree)).toContain('forecast: 42%')
    expect(await isEngineDrawn(ui)).toBe(false)
  })
})
