import { describe, expect } from 'claude-code/testing'

import {
  AGENTS_TEXT,
  FENCE,
  ROOT,
  addSpec,
  agentsFile,
  claudeMdBlock,
  contextInput,
  lean,
  newWorld,
  stand,
  test,
} from './world'

const OMITTED = [
  '## Section A',
  '## Section B',
  '## Section C',
  '## Section D (extra notes)',
]

const agentsOf = (result: { instructionFiles?: readonly { path: string; content: string }[] }): string =>
  result.instructionFiles?.find(file => file.path.endsWith('AGENTS.md'))?.content ?? ''

describe('prompt.context, simulation first', () => {
  test('by default nothing changes and the saving is only recorded', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const original = contextInput()

    const result = await $.prompt.context(original)

    expect(result.blocks).toEqual(original.blocks)
    expect(agentsOf(result)).toBe(AGENTS_TEXT)
    expect(world.statusLog.at(-1)).toMatch(/^lean: simulado -/)
    const panel = (await lean($, '')).text ?? ''
    expect(panel).toContain('corte: SIMULADO')
    expect(panel).toContain('modo lean')
    expect(panel).toContain('poupanca estimada')
  })

  test('after /lean apply the four sections leave the instruction file', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')

    const result = await $.prompt.context(contextInput())
    const agents = agentsOf(result)

    for (const heading of OMITTED) expect(agents).not.toContain(heading)
    expect(agents).toContain('## Style rules')
    expect(agents).toContain('NEVER skip the review checklist.')
    expect(agents).toContain('# Closing notes')
    expect(agents.match(/\[omitted in lean mode: AGENTS\.md section /g)).toHaveLength(4)
    expect(world.statusLog.at(-1)).toMatch(/^lean: cortado -/)
  })

  test('applying edits the instruction files and the engine re-renders the claudeMd block from them', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const original = contextInput()

    const result = await $.prompt.context(original)
    const claudeMd = result.blocks.find(block => block.name === 'claudeMd')?.text ?? ''

    expect(claudeMd).toContain('[omitted in lean mode: AGENTS.md section Section C')
    expect(claudeMd).not.toContain('## Section C')
    expect(claudeMd).toContain('NEVER skip the review checklist.')
    expect(result.blocks.find(block => block.name === 'currentDate')).toEqual(original.blocks[1])
  })

  test('/lean simulate goes back to leaving the context whole', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await lean($, 'simulate')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('the apply setting persists in the store across loads', async ($, on) => {
    const world = newWorld()
    stand(on, world, { settings: { applyCut: true } })

    expect(agentsOf(await $.prompt.context(contextInput()))).not.toBe(AGENTS_TEXT)
  })
})

describe('prompt.context, mode decision', () => {
  test('an active spec for the branch keeps the full context even when applying', async ($, on) => {
    const world = newWorld()
    addSpec(world, 'feature-x')
    stand(on, world)
    await lean($, 'apply')

    const result = await $.prompt.context(contextInput())

    expect(agentsOf(result)).toBe(AGENTS_TEXT)
    expect(world.statusLog.at(-1)).toContain('lean: full')
  })

  test('a branch with slashes finds its nested spec directory', async ($, on) => {
    const world = newWorld({ git: { exitCode: 0, stdout: 'feature/x\n' } })
    addSpec(world, 'feature/x')
    stand(on, world)
    await lean($, 'apply')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('a git failure fails open to the full context', async ($, on) => {
    const world = newWorld({ git: { exitCode: 128, stdout: '' } })
    stand(on, world)
    await lean($, 'apply')

    const result = await $.prompt.context(contextInput())

    expect(agentsOf(result)).toBe(AGENTS_TEXT)
    expect(world.statusLog.at(-1)).toContain('unknown-branch')
  })

  test('git missing from the machine also fails open', async ($, on) => {
    const world = newWorld({ git: 'unavailable' })
    stand(on, world)
    await lean($, 'apply')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('a detached HEAD fails open', async ($, on) => {
    const world = newWorld({ git: { exitCode: 0, stdout: '\n' } })
    stand(on, world)
    await lean($, 'apply')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('a missing _active folder fails open instead of concluding there is no spec', async ($, on) => {
    const world = newWorld()
    world.dirs.delete(`${ROOT}/specs/_active`)
    stand(on, world)
    await lean($, 'apply')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('/lean mode full forces the full context for this conversation', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await lean($, 'mode full')

    const result = await $.prompt.context(contextInput())

    expect(agentsOf(result)).toBe(AGENTS_TEXT)
    expect(world.statusLog.at(-1)).toContain('override')
  })

  test('/lean mode lean forces the lean context even with an active spec', async ($, on) => {
    const world = newWorld()
    addSpec(world, 'feature-x')
    stand(on, world)
    await lean($, 'apply')
    await lean($, 'mode lean')

    expect(agentsOf(await $.prompt.context(contextInput()))).not.toBe(AGENTS_TEXT)
  })

  test('/lean mode auto releases the override', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    await lean($, 'mode full')
    await lean($, 'mode auto')

    expect(agentsOf(await $.prompt.context(contextInput()))).not.toBe(AGENTS_TEXT)
  })

  test('an override typed in another conversation does not leak into this one', async ($, on) => {
    const world = newWorld({ sessionId: 'old-session' })
    stand(on, world)
    await lean($, 'apply')
    await lean($, 'mode full')
    world.sessionId = 'new-session'

    expect(agentsOf(await $.prompt.context(contextInput()))).not.toBe(AGENTS_TEXT)
  })

  test('/lean mode with no value reports the current mode', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    const text = (await lean($, 'mode')).text ?? ''

    expect(text).toContain('modo: lean')
    expect(text).toContain('sem spec ativa')
  })

  test('an unknown subcommand prints the usage', async ($, on) => {
    stand(on, newWorld())

    expect((await lean($, 'banana')).text).toContain('uso: /lean')
  })
})

describe('prompt.context, guards', () => {
  test('an AGENTS.md without any listed title is returned untouched', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const plain = '# Title\n\n## Something\nbody\n'

    expect(agentsOf(await $.prompt.context(contextInput(plain)))).toBe(plain)
  })

  test('a repository without the specs folder is left alone', async ($, on) => {
    const world = newWorld()
    world.dirs.clear()
    stand(on, world)
    await lean($, 'apply')

    expect(agentsOf(await $.prompt.context(contextInput()))).toBe(AGENTS_TEXT)
  })

  test('an unclosed code fence in the file cuts nothing', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const broken = `${AGENTS_TEXT}\n${FENCE}bash\nnever closed\n`

    expect(agentsOf(await $.prompt.context(contextInput(broken)))).toBe(broken)
  })

  test('only the instruction file named AGENTS.md is edited', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const other = { path: `${ROOT}/OTHER.md`, kind: 'project' as const, content: AGENTS_TEXT }
    const files = [agentsFile(), other]

    const result = await $.prompt.context({ blocks: [claudeMdBlock(files)], instructionFiles: files })

    const edited = result.instructionFiles ?? []
    expect(edited.find(file => file.path.endsWith('OTHER.md'))?.content).toBe(AGENTS_TEXT)
    expect(edited.find(file => file.path.endsWith('AGENTS.md'))?.content).not.toBe(AGENTS_TEXT)
  })

  test('unknown instruction files (claudeMd rewritten above) leave everything alone', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    await lean($, 'apply')
    const original = contextInput()

    const result = await $.prompt.context({ blocks: original.blocks })

    expect(result.instructionFiles).toBeUndefined()
  })
})
