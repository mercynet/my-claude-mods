import { describe, expect, test } from 'claude-code/testing'

import { parseArt } from '../hooks/banner/art'
import { encodeBase64, packCells } from '../hooks/banner/base64'
import {
  RULE_FADE_STRENGTH,
  SHEEN_BOTTOM,
  SHEEN_TOP,
  buildGrid,
  plainLines,
  shimmerAmount,
} from '../hooks/banner/cells'
import type { Look } from '../hooks/banner/cells'
import { DEFAULT_BG, DEFAULT_FG, NEUTRAL, darken, gradient, lighten, mix, parseHex, parseStops, toInt } from '../hooks/banner/color'
import type { Rgb } from '../hooks/banner/color'
import { DEFAULT_COLORS, SWEEP_FRAMES, parseOptions } from '../hooks/banner/config'
import { planBand } from '../hooks/banner/plan'
import { ART, decodeBase64, decodeCells } from './world'

const art = (() => {
  const parsed = parseArt(ART)
  if (parsed === null) throw new Error('fixture art must parse')

  return parsed
})()

const STATIC: Look = { stops: DEFAULT_COLORS, isColor: true, frame: SWEEP_FRAMES }

const grid = (look: Look, columns = art.width, hasRule = true) =>
  decodeCells(buildGrid(art, { columns, hasRule, hasTagline: false }, look).cells)

const at = (cells: ReturnType<typeof grid>, x: number, y: number, columns = art.width) => {
  const cell = cells[y * columns + x]
  if (cell === undefined) throw new Error(`no cell ${x},${y}`)

  return cell
}

describe('parsing the art', () => {
  test('trims blank edges, pads rows and finds where the ink is', () => {
    const parsed = parseArt('\n\n  ██\n █\n\n')

    expect(parsed).toMatchObject({ width: 4, height: 2, inkMin: 1, inkMax: 3 })
    expect(parsed?.rows.map(row => row.join(''))).toEqual(['  ██', ' █  '])
  })

  test('turns control, wide and astral characters into blanks', () => {
    const parsed = parseArt('█\u0007漢\u{1F600}█')

    expect(parsed?.rows[0]?.join('')).toBe('█   █')
  })

  test('refuses an empty file, a blank one and an oversized one', () => {
    expect(parseArt('')).toBeNull()
    expect(parseArt('  \n \n')).toBeNull()
    expect(parseArt('█'.repeat(70_000))).toBeNull()
  })

  test('refuses art taller than the row limit', () => {
    expect(parseArt(Array.from({ length: 65 }, () => '█').join('\n'))).toBeNull()
  })
})

describe('packing the cells', () => {
  test('encodes base64 like the standard alphabet, padding included', () => {
    const encode = (text: string) => encodeBase64(Uint8Array.from([...text].map(char => char.charCodeAt(0))))

    expect(encode('Man')).toBe('TWFu')
    expect(encode('Ma')).toBe('TWE=')
    expect(encode('M')).toBe('TQ==')
    expect(encode('')).toBe('')
  })

  test('packs little-endian [code point, foreground, background] triplets', () => {
    const packed = packCells([[0x2588, 0x1f6fb2, DEFAULT_BG]])
    const bytes = decodeBase64(packed)

    expect([...bytes]).toEqual([0x88, 0x25, 0, 0, 0xb2, 0x6f, 0x1f, 0, 0, 0, 0, 1])
  })
})

describe('colors', () => {
  test('reads #rgb and #rrggbb and nothing else', () => {
    expect(parseHex('#1f6fb2')).toEqual([0x1f, 0x6f, 0xb2])
    expect(parseHex('#fa0')).toEqual([0xff, 0xaa, 0])
    expect(parseHex('1f6fb2')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
  })

  test('a list with one bad stop, an empty one or too many stops is rejected whole', () => {
    expect(parseStops('#fff, #000', 8)).toEqual([[255, 255, 255], [0, 0, 0]])
    expect(parseStops('#fff,nope', 8)).toBeNull()
    expect(parseStops('', 8)).toBeNull()
    expect(parseStops('#111,#222,#333', 2)).toBeNull()
    expect(parseStops(42, 8)).toBeNull()
  })

  test('the gradient lands exactly on its first and last stop and is monotonic between', () => {
    const [first, last] = DEFAULT_COLORS as [Rgb, Rgb]

    expect(gradient(DEFAULT_COLORS, 0)).toEqual(first)
    expect(gradient(DEFAULT_COLORS, 1)).toEqual(last)
    expect(gradient(DEFAULT_COLORS, -3)).toEqual(first)
    expect(gradient(DEFAULT_COLORS, 7)).toEqual(last)

    const reds = [0, 0.25, 0.5, 0.75, 1].map(t => gradient(DEFAULT_COLORS, t)[0])
    expect(reds).toEqual([...reds].sort((a, b) => a - b))
  })

  test('a single stop is a solid color', () => {
    expect(gradient([[10, 20, 30]], 0.6)).toEqual([10, 20, 30])
  })

  test('three stops pass through the middle one', () => {
    expect(gradient([[0, 0, 0], [100, 100, 100], [200, 200, 200]], 0.5)).toEqual([100, 100, 100])
  })
})

describe('painting the ink', () => {
  test('the left and right edge of the ink carry the first and last stop', () => {
    const cells = grid(STATIC)
    const [first, last] = DEFAULT_COLORS as [Rgb, Rgb]

    expect(at(cells, art.inkMin, 1).fg).toBe(toInt(first))
    expect(at(cells, art.inkMax, 1).fg).toBe(toInt(last))
  })

  test('the top row is lighter and the bottom row darker than the middle', () => {
    const cells = grid(STATIC)
    const base = gradient(DEFAULT_COLORS, (8 - art.inkMin) / (art.inkMax - art.inkMin))

    expect(at(cells, 8, 0).fg).toBe(toInt(lighten(base, SHEEN_TOP)))
    expect(at(cells, 8, 1).fg).toBe(toInt(base))
    expect(at(cells, 8, 2).fg).toBe(toInt(darken(base, SHEEN_BOTTOM)))
  })

  test('blank cells and backgrounds stay on the terminal default', () => {
    const cells = grid(STATIC)

    expect(at(cells, 0, 0)).toEqual({ glyph: ' ', fg: DEFAULT_FG, bg: DEFAULT_BG })
    expect(cells.every(cell => cell.bg === DEFAULT_BG)).toBe(true)
  })

  test('keeps the art glyphs where the ink is', () => {
    const cells = grid(STATIC)

    expect(at(cells, 2, 0).glyph).toBe('▄')
    expect(at(cells, 1, 1).glyph).toBe('█')
  })

  test('without color every cell uses the default foreground and the rule is plain', () => {
    const cells = grid({ ...STATIC, isColor: false })

    expect(cells.every(cell => cell.fg === DEFAULT_FG)).toBe(true)
    expect(at(cells, art.inkMin, 3).glyph).toBe('─')
    expect(at(cells, art.inkMin, 1).glyph).toBe('█')
  })
})

describe('the shimmer sweep', () => {
  test('is invisible at its first frame and once it is done', () => {
    const atStart = grid({ ...STATIC, frame: 0 })
    const done = grid(STATIC)

    expect(atStart).toEqual(done)
    expect(grid({ ...STATIC, frame: SWEEP_FRAMES + 5 })).toEqual(done)
  })

  test('only brightens, and does so in the middle of the sweep', () => {
    const still = grid(STATIC)
    const moving = grid({ ...STATIC, frame: Math.floor(SWEEP_FRAMES / 2) })
    const channel = (value: number, shift: number) => (value >> shift) & 255
    const brighter = moving.filter((cell, index) => {
      const base = still[index]
      if (base === undefined || cell.fg === DEFAULT_FG) return false
      expect([16, 8, 0].every(shift => channel(cell.fg, shift) >= channel(base.fg, shift))).toBe(true)

      return cell.fg !== base.fg
    })

    expect(brighter.length).toBeGreaterThan(0)
  })

  test('moves from left to right as the frames advance', () => {
    const weight = (frame: number) => {
      const cells = grid({ ...STATIC, frame })
      const still = grid(STATIC)
      const lit = cells.flatMap((cell, index) => (cell.fg !== still[index]?.fg ? [index % art.width] : []))

      return lit.reduce((sum, x) => sum + x, 0) / Math.max(1, lit.length)
    }

    expect(weight(Math.floor(SWEEP_FRAMES * 0.75))).toBeGreaterThan(weight(Math.floor(SWEEP_FRAMES * 0.3)))
  })

  test('the amount stays within 0 and 1', () => {
    for (let frame = 0; frame <= SWEEP_FRAMES; frame += 1) {
      for (let x = 0; x < art.width; x += 1) {
        const amount = shimmerAmount(x, 1, frame, art.width, art.height)
        expect(amount).toBeGreaterThanOrEqual(0)
        expect(amount).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the rule under the logo', () => {
  test('spans exactly the ink and fades toward neutral at both ends', () => {
    const cells = grid(STATIC)
    const row = (x: number) => at(cells, x, art.height)
    const middle = Math.round((art.inkMin + art.inkMax) / 2)
    const base = (x: number) => gradient(DEFAULT_COLORS, (x - art.inkMin) / (art.inkMax - art.inkMin))

    expect(row(art.inkMin - 1).glyph).toBe(' ')
    expect(row(art.inkMin).glyph).toBe('━')
    expect(row(art.inkMin).fg).toBe(toInt(mix(base(art.inkMin), NEUTRAL, RULE_FADE_STRENGTH)))
    expect(row(art.inkMax).fg).toBe(toInt(mix(base(art.inkMax), NEUTRAL, RULE_FADE_STRENGTH)))
    expect(row(middle).fg).toBe(toInt(base(middle)))
  })

  test('is left out when the plan has no room for it', () => {
    const withoutRule = buildGrid(art, { columns: art.width, hasRule: false, hasTagline: false }, STATIC)

    expect(withoutRule.rows).toBe(art.height)
  })
})

describe('fitting the band', () => {
  const plan = (columns: number, maxRows: number, wantsTagline = true) => planBand(art, columns, maxRows, wantsTagline)

  test('draws the rule and the tagline when there is room for both', () => {
    expect(plan(80, 12)).toEqual({ columns: art.width, hasRule: true, hasTagline: true })
  })

  test('drops the tagline first, then the rule, then the whole logo', () => {
    expect(plan(80, art.height + 1)).toEqual({ columns: art.width, hasRule: true, hasTagline: false })
    expect(plan(80, art.height)).toEqual({ columns: art.width, hasRule: false, hasTagline: false })
    expect(plan(80, art.height - 1)).toBeNull()
  })

  test('no tagline when there is none to show', () => {
    expect(plan(80, 12, false)?.hasTagline).toBe(false)
  })

  test('clips to the band width and builds a grid of exactly that width', () => {
    const clipped = plan(9, 12)

    expect(clipped?.columns).toBe(9)
    const drawn = buildGrid(art, clipped ?? { columns: 0, hasRule: false, hasTagline: false }, STATIC)
    expect(drawn.columns).toBe(9)
    expect(decodeCells(drawn.cells)).toHaveLength(9 * drawn.rows)
    expect(plainLines(art, clipped ?? { columns: 0, hasRule: false, hasTagline: false }).every(line => line.length <= 9)).toBe(true)
  })

  test('shows nothing rather than a mutilated logo when the band is far too narrow', () => {
    expect(plan(4, 12)).toBeNull()
    expect(plan(0, 12)).toBeNull()
    expect(plan(Number.NaN, 12)).toBeNull()
  })
})

describe('options', () => {
  test('defaults', () => {
    expect(parseOptions({})).toEqual({
      artFile: '~/.claude/banner.txt',
      colors: DEFAULT_COLORS,
      tagline: '',
      lingerSeconds: 0,
    })
  })

  test('an invalid color list falls back to the default one', () => {
    expect(parseOptions({ colors: '#fff,banana' }).colors).toEqual(DEFAULT_COLORS)
    expect(parseOptions({ colors: '#ff0000,#00ff00,#0000ff' }).colors).toHaveLength(3)
  })

  test('reads the tagline, the art file and the linger time', () => {
    expect(parseOptions({ tagline: ' hello ', artFile: 'art/logo.txt', lingerSeconds: 7.9 })).toMatchObject({
      tagline: 'hello',
      artFile: 'art/logo.txt',
      lingerSeconds: 7,
    })
  })

  test('refuses control characters, oversized text and negative or non-numeric times', () => {
    expect(parseOptions({ tagline: 'a\nb' }).tagline).toBe('')
    expect(parseOptions({ tagline: 'x'.repeat(200) }).tagline).toBe('')
    expect(parseOptions({ lingerSeconds: -4 }).lingerSeconds).toBe(0)
    expect(parseOptions({ lingerSeconds: 'soon' }).lingerSeconds).toBe(0)
    expect(parseOptions({ lingerSeconds: 99_999 }).lingerSeconds).toBe(3600)
  })
})
