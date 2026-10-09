import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { InstructionFile, PluginOptions } from 'claude-code'

import { markerOf, normalizeRelativeDir, parseOptions, parseSections } from '../hooks/lean/options'
import { cutSections } from '../hooks/lean/sections'
import { AGENTS_TEXT, OPTIONS, ROOT, addSpec, claudeMdBlock, contextInput, lean, newWorld, stand } from './world'

const configured = (options: PluginOptions, name: string, body: TestBody): void => test(name, { options }, body)

const fileOf = (result: { instructionFiles?: readonly InstructionFile[] }, name: string): string =>
  result.instructionFiles?.find(file => file.path.endsWith(`/${name}`))?.content ?? ''

const withFile = (name: string, content: string) => {
  const files: InstructionFile[] = [{ path: `${ROOT}/${name}`, kind: 'project', content }]
  return { blocks: [claudeMdBlock(files)], instructionFiles: files }
}

const realSizes = (): string => {
  const { cut } = cutSections(AGENTS_TEXT, 'AGENTS.md', ['Section A', 'Section C'])
  return cut.map(section => `${section.title}|${section.bytes}`).join(';')
}

describe('parseSections', () => {
  test('splits titles on semicolons and reads an optional byte size after the last bar', () => {
    expect(parseSections('Section A|120; Section B ;Section D (extra notes)|5000')).toEqual([
      { title: 'Section A', expectedBytes: 120 },
      { title: 'Section B' },
      { title: 'Section D (extra notes)', expectedBytes: 5000 },
    ])
  })

  test('a suffix that is not a number stays part of the title, and a zero size is no size', () => {
    expect(parseSections('Left|Right;Zero|0')).toEqual([{ title: 'Left|Right' }, { title: 'Zero' }])
  })

  test('empty entries and repeated titles are dropped', () => {
    expect(parseSections(' ; ;Section A;Section A|10;|5')).toEqual([{ title: 'Section A' }])
  })
})

describe('parseOptions', () => {
  test('nothing configured is inert and says why', () => {
    const parsed = parseOptions({})

    expect(parsed.sections).toEqual([])
    expect(parsed.inertWhy).toContain('omittableSections')
    expect(parsed.instructionFile).toBe('AGENTS.md')
    expect(parsed.specsDir).toBe('specs/_active')
    expect(parsed.projectMarker).toBe('specs')
  })

  test('titles alone are enough to be active', () => {
    expect(parseOptions({ omittableSections: 'Section A' }).inertWhy).toBeUndefined()
  })

  test('values that are not text count as unset', () => {
    const parsed = parseOptions({ omittableSections: 7, instructionFile: true, specsDir: ['x'] })

    expect(parsed.instructionFile).toBe('AGENTS.md')
    expect(parsed.specsDir).toBe('specs/_active')
    expect(parsed.inertWhy).toContain('omittableSections')
  })

  test('a specs folder that escapes the project is inert', () => {
    for (const specsDir of ['../outside', '/abs/path', 'C:\\specs', 'a/../b', 'a//b']) {
      expect(parseOptions({ omittableSections: 'Section A', specsDir }).inertWhy).toContain('specsDir')
    }
  })

  test('an instruction file with a folder in it is inert', () => {
    expect(parseOptions({ omittableSections: 'Section A', instructionFile: 'docs/AGENTS.md' }).inertWhy).toContain(
      'instructionFile',
    )
  })

  test('the marker is the parent of the specs folder, or the folder itself when it has none', () => {
    expect(markerOf('docs/specs/_active')).toBe('docs/specs')
    expect(markerOf('plans')).toBe('plans')
    expect(normalizeRelativeDir('./docs\\plans/')).toBe('docs/plans')
  })
})

describe('default configuration', () => {
  test('is inert: nothing is cut, nothing is recorded, and the panel says why', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const original = contextInput()

    const result = await $.prompt.context(original)

    expect(fileOf(result, 'AGENTS.md')).toBe(AGENTS_TEXT)
    expect(world.statusLog).toEqual([])
    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('esta conversa: sem registo')
    expect(panel).toContain('nao se aplica aqui (userConfig omittableSections vazio')
    expect(panel).toContain('ultimo evento do contexto: inerte: userConfig omittableSections vazio')
    expect((await lean($, 'mode')).text).toContain('modo: nao se aplica')
  })

  test('sends no reminder and adds no system prompt section', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await $.prompt.context(contextInput())
    addSpec(world, 'feature-x')

    await $.prompt.submit({ text: 'prompt', wait: false, origin: { kind: 'composer' } })

    expect(world.submittedContexts).toEqual([undefined])
  })
})

describe('configured titles and sizes', () => {
  configured(OPTIONS, 'cut exactly the configured titles and leave the others', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')

    const agents = fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')

    for (const title of ['Section A', 'Section B', 'Section C', 'Section D (extra notes)']) {
      expect(agents).not.toContain(`## ${title}`)
    }
    expect(agents).toContain('## Development Guidelines')
    expect(agents).toContain('# Closing notes')
    expect(agents.match(/\[omitted in lean mode: AGENTS\.md section /g)).toHaveLength(4)
  })

  configured({ omittableSections: 'Section B' }, 'a shorter list cuts only what it names', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')

    const agents = fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')

    expect(agents).not.toContain('## Section B')
    expect(agents).toContain('## Section A')
    expect(agents.match(/\[omitted in lean mode: AGENTS\.md section /g)).toHaveLength(1)
  })

  configured(
    { omittableSections: realSizes() },
    'sizes that match the file raise no drift warning',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')
      await $.prompt.context(contextInput())

      expect((await lean($, '')).text ?? '').not.toContain('AVISO: seccao')
    },
  )

  configured(
    { omittableSections: 'Section A|100000;Section C|1' },
    'sizes far from the file are reported as drift, each against its own title',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')
      await $.prompt.context(contextInput())

      const panel = (await lean($, '')).text ?? ''
      expect(panel).toContain('AVISO: seccao "Section A"')
      expect(panel).toContain('AVISO: seccao "Section C"')
      expect(panel).not.toContain('AVISO: seccao "Section B"')
    },
  )

  configured(
    { omittableSections: 'Section A;Missing Title' },
    'a configured title the file lacks is listed as missing without blocking the cut',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')

      const agents = fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')

      expect(agents).not.toContain('## Section A')
      expect(((await lean($, '')).text ?? '')).toContain('titulos nao encontrados: Missing Title')
    },
  )
})

describe('configured paths', () => {
  configured(
    { omittableSections: 'Section A', specsDir: 'docs/plans' },
    'the specs folder comes from the configuration, and its parent is the project marker',
    async ($, on) => {
      const world = newWorld()
      world.dirs.clear()
      world.dirs.add(`${ROOT}/docs`)
      world.dirs.add(`${ROOT}/docs/plans`)
      stand(on, world)
      await lean($, 'apply')

      expect(fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')).not.toBe(AGENTS_TEXT)

      world.dirs.add(`${ROOT}/docs/plans/feature-x`)
      expect((await lean($, 'mode')).text).toContain('modo: full (existe spec ativa')
    },
  )

  configured(
    { omittableSections: 'Section A', specsDir: 'docs/plans' },
    'the default specs folder is ignored once another is configured',
    async ($, on) => {
      const world = newWorld()
      addSpec(world, 'feature-x')
      world.dirs.add(`${ROOT}/docs`)
      world.dirs.add(`${ROOT}/docs/plans`)
      stand(on, world)
      await lean($, 'apply')

      expect(fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')).not.toBe(AGENTS_TEXT)
    },
  )

  configured(
    { omittableSections: 'Section A', specsDir: 'docs/plans' },
    'without the configured parent folder the mod stays inert in that project',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')

      expect(fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')).toBe(AGENTS_TEXT)
      expect(((await lean($, '')).text ?? '')).toContain('docs nao existe em')
    },
  )

  configured(
    { omittableSections: 'Section A', instructionFile: 'RULES.md' },
    'only the configured instruction file is edited and its name shows in the pointer and the notes',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')
      const files: InstructionFile[] = [
        { path: `${ROOT}/AGENTS.md`, kind: 'project', content: AGENTS_TEXT },
        { path: `${ROOT}/RULES.md`, kind: 'project', content: AGENTS_TEXT },
      ]

      const result = await $.prompt.context({ blocks: [claudeMdBlock(files)], instructionFiles: files })

      expect(fileOf(result, 'AGENTS.md')).toBe(AGENTS_TEXT)
      expect(fileOf(result, 'RULES.md')).toContain('[omitted in lean mode: RULES.md section Section A')
      const sections = (await $.prompt.compose({
        model: 'test-model',
        promptModel: 'test-model',
        surfaces: [],
        tools: [],
        outputStyle: null,
        traits: [],
      })).sections
      expect(sections.at(-1)?.text).toContain('RULES.md sections: Section A')
    },
  )
})

describe('invalid configuration fails open', () => {
  configured(
    { omittableSections: 'Section A', specsDir: '../outside' },
    'an unsafe specs folder cuts nothing and says so',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')

      expect(fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')).toBe(AGENTS_TEXT)
      expect(((await lean($, '')).text ?? '')).toContain('userConfig specsDir invalido')
    },
  )

  configured(
    { omittableSections: 'Section A', instructionFile: '../AGENTS.md' },
    'an instruction file with a path in it cuts nothing and says so',
    async ($, on) => {
      const world = newWorld()
      stand(on, world)
      await lean($, 'apply')

      expect(fileOf(await $.prompt.context(contextInput()), 'AGENTS.md')).toBe(AGENTS_TEXT)
      expect(((await lean($, '')).text ?? '')).toContain('userConfig instructionFile invalido')
    },
  )
})
