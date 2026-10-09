import { describe, expect, test } from 'claude-code/testing'

import {
  BRANCH,
  MINUTE,
  NOW,
  ROOT,
  SPECS,
  SPEC_DIR,
  STATE,
  TASKS,
  edit,
  finishTurn,
  isEngineDrawn,
  mountBand,
  newWorld,
  screen,
  startSession,
  stand,
  submit,
  touch,
} from './world'

const FULL = '42 · tarefas 3/5 · STATE 3 min · fase B'

describe('what the band shows', () => {
  test('the spec of the current branch, in one line', async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)

    await startSession($)

    expect(await screen(ui)).toBe(FULL)
  })

  test('draws on the desktop surface as well', async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($, {}, 'desktop')

    await startSession($)

    expect(await screen(ui)).toBe(FULL)
  })

  test('shows nothing before the first refresh', async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('yields to a survey', async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($, { hasSurvey: true })

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('the age follows the clock', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    touch(world, STATE, NOW - 5 * 60 * MINUTE)
    await finishTurn($)

    expect(await screen(ui)).toContain('STATE 5 h')
  })

  test('a spec without tasks and one without boxes leave the task segment out', async ($, on) => {
    const world = newWorld()
    world.files.delete(TASKS)
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    expect(await screen(ui)).toBe('42 · STATE 3 min · fase B')

    world.files.set(TASKS, { text: '## T0 - plain heading\n- What: x', mtimeMs: NOW })
    await finishTurn($)

    expect(await screen(ui)).toBe('42 · STATE 3 min · fase B')
  })

  test('a spec without a state file shows the label and tasks only', async ($, on) => {
    const world = newWorld()
    world.files.delete(STATE)
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await screen(ui)).toBe('42 · tarefas 3/5')
  })

  test('an unparseable phase is left out', async ($, on) => {
    const world = newWorld()
    world.files.set(STATE, { text: '# STATE\n\nNothing about a phase.\n', mtimeMs: NOW - 3 * MINUTE })
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await screen(ui)).toBe('42 · tarefas 3/5 · STATE 3 min')
  })

  test('the configured folder and file names are used', { options: { specsDir: 'work/specs', tasksFile: 'todo.md', stateFile: 'NOTES.md' } }, async ($, on) => {
    const world = newWorld()
    const dir = `${ROOT}/work/specs/${BRANCH}`
    world.dirs = new Set([`${ROOT}/work/specs`, dir])
    world.files = new Map([
      [`${dir}/todo.md`, { text: '- [x] a\n- [ ] b', mtimeMs: NOW }],
      [`${dir}/NOTES.md`, { text: 'Phase C', mtimeMs: NOW - 2 * MINUTE }],
    ])
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await screen(ui)).toBe('42 · tarefas 1/2 · STATE 2 min · fase C')
  })
})

describe('when the band stays out of the way', () => {
  test('no folder for the branch', async ($, on) => {
    const world = newWorld()
    world.dirs.delete(SPEC_DIR)
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('no specs folder at all', async ($, on) => {
    const world = newWorld()
    world.dirs = new Set()
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('the branch path is a file, not a folder', async ($, on) => {
    const world = newWorld()
    world.dirs.delete(SPEC_DIR)
    world.files.set(SPEC_DIR, { text: '', mtimeMs: NOW })
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('detached HEAD', async ($, on) => {
    stand(on, newWorld({ git: { exitCode: 0, stdout: '\n' } }))
    const ui = await mountBand($)

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('not a git repository', async ($, on) => {
    stand(on, newWorld({ git: { exitCode: 128, stdout: '' } }))
    const ui = await mountBand($)

    await startSession($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('git not installed', async ($, on) => {
    stand(on, newWorld({ git: 'unavailable' }))
    const ui = await mountBand($)

    await expect(startSession($)).resolves.toBeDefined()
    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a failing read of the spec folder', async ($, on) => {
    const world = newWorld()
    world.broken.add(SPEC_DIR)
    stand(on, world)
    const ui = await mountBand($)

    await expect(startSession($)).resolves.toBeDefined()
    expect(await isEngineDrawn(ui)).toBe(true)
  })

  test('a failing read of the tasks or state file drops only that segment', async ($, on) => {
    const world = newWorld()
    world.broken.add(TASKS)
    world.broken.add(STATE)
    stand(on, world)
    const ui = await mountBand($)

    await startSession($)

    expect(await screen(ui)).toBe('42')
  })

  test('a spec that disappears mid-session clears the band', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    expect(await screen(ui)).toBe(FULL)

    world.dirs.delete(SPEC_DIR)
    await finishTurn($)

    expect(await isEngineDrawn(ui)).toBe(true)
  })
})

describe('refreshing', () => {
  test('a new prompt picks up a branch switch', async ($, on) => {
    const world = newWorld()
    const other = `${SPECS}/7-other-work`
    world.dirs.add(other)
    world.files.set(`${other}/tasks.md`, { text: '- [ ] only', mtimeMs: NOW })
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    world.git = { exitCode: 0, stdout: '7-other-work\n' }
    await submit($)

    expect(await screen(ui)).toBe('7 · tarefas 0/1')
  })

  test('the end of a turn picks up task progress', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    world.files.set(TASKS, { text: '- [x] a\n- [x] b\n- [x] c', mtimeMs: NOW })
    await finishTurn($)

    expect(await screen(ui)).toContain('tarefas 3/3')
  })

  test('an edit refreshes right away', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    world.files.set(TASKS, { text: '- [x] a\n- [ ] b', mtimeMs: NOW })
    await edit($, TASKS)

    expect(await screen(ui)).toContain('tarefas 1/2')
  })
})

describe('the stale state warning', () => {
  const options = { options: { staleAfterEdits: 3 } }

  test('appears at the threshold', options, async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    await edit($, `${ROOT}/src/a.ts`)
    await edit($, `${ROOT}/src/b.ts`, 'Write')
    expect(await screen(ui)).toBe(FULL)

    await edit($, `${ROOT}/src/c.ts`)

    expect(await screen(ui)).toBe(`▸ ${FULL} · STATE.md sem atualizar há 3 edições`)
  })

  test('keeps counting past the threshold', options, async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    for (const name of ['a', 'b', 'c', 'd']) await edit($, `${ROOT}/src/${name}.ts`)

    expect(await screen(ui)).toContain('há 4 edições')
  })

  test('resets when the state file changes', options, async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    for (const name of ['a', 'b', 'c']) await edit($, `${ROOT}/src/${name}.ts`)
    expect(await screen(ui)).toContain('sem atualizar')

    touch(world, STATE, NOW)
    await edit($, STATE)

    expect(await screen(ui)).toBe('42 · tarefas 3/5 · STATE agora · fase B')

    await edit($, `${ROOT}/src/d.ts`)
    await edit($, `${ROOT}/src/e.ts`)

    expect(await screen(ui)).not.toContain('sem atualizar')
  })

  test('resets when the state file changes outside a tool call', options, async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    for (const name of ['a', 'b', 'c']) await edit($, `${ROOT}/src/${name}.ts`)

    touch(world, STATE, NOW - MINUTE)
    await finishTurn($)

    expect(await screen(ui)).toBe('42 · tarefas 3/5 · STATE 1 min · fase B')
  })

  test('failed edits do not count', options, async ($, on) => {
    const world = newWorld({ toolFails: true })
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    for (const name of ['a', 'b', 'c', 'd']) await edit($, `${ROOT}/src/${name}.ts`)

    expect(await screen(ui)).toBe(FULL)
  })

  test('edits outside the project do not count', options, async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    for (const name of ['a', 'b', 'c', 'd']) await edit($, `/tmp/scratch/${name}.md`)

    expect(await screen(ui)).toBe(FULL)
  })

  test('relative paths count as project edits', options, async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    for (const name of ['a', 'b', 'c']) await edit($, `src/${name}.ts`)

    expect(await screen(ui)).toContain('há 3 edições')
  })

  test('a new branch starts from zero', options, async ($, on) => {
    const world = newWorld()
    const other = `${SPECS}/7-other-work`
    world.dirs.add(other)
    world.files.set(`${other}/STATE.md`, { text: 'Phase A', mtimeMs: NOW - 3 * MINUTE })
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)
    for (const name of ['a', 'b', 'c']) await edit($, `${ROOT}/src/${name}.ts`)

    world.git = { exitCode: 0, stdout: '7-other-work\n' }
    await submit($)

    expect(await screen(ui)).toBe('7 · STATE 3 min · fase A')
  })

  test('never warns without a state file', options, async ($, on) => {
    const world = newWorld()
    world.files.delete(STATE)
    stand(on, world)
    const ui = await mountBand($)
    await startSession($)

    for (const name of ['a', 'b', 'c', 'd']) await edit($, `${ROOT}/src/${name}.ts`)

    expect(await screen(ui)).toBe('42 · tarefas 3/5')
  })

  test('the default threshold is 15', async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    for (let i = 0; i < 14; i += 1) await edit($, `${ROOT}/src/f${i}.ts`)
    expect(await screen(ui)).not.toContain('sem atualizar')

    await edit($, `${ROOT}/src/last.ts`)

    expect(await screen(ui)).toContain('há 15 edições')
  })

  test('the threshold is configurable', { options: { staleAfterEdits: 2 } }, async ($, on) => {
    stand(on, newWorld())
    const ui = await mountBand($)
    await startSession($)

    await edit($, `${ROOT}/src/a.ts`)
    await edit($, `${ROOT}/src/b.ts`)

    expect(await screen(ui)).toContain('há 2 edições')
  })
})

describe('staying out of the tool call', () => {
  test('the tool result passes through untouched', async ($, on) => {
    stand(on, newWorld())
    await startSession($)

    const ran = await edit($, `${ROOT}/src/a.ts`)

    expect(ran.deny).toBeUndefined()
  })

  test('a broken probe never blocks the edit', async ($, on) => {
    stand(on, newWorld({ git: 'unavailable' }))
    await startSession($)

    const ran = await edit($, `${ROOT}/src/a.ts`)

    expect(ran.deny).toBeUndefined()
    expect(ran.isError).toBeUndefined()
  })

  test('other tools are not observed', async ($, on) => {
    const world = newWorld()
    stand(on, world)
    const ui = await mountBand($, {})
    await startSession($)

    for (let i = 0; i < 20; i += 1) await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a${i}.ts` })

    expect(await screen(ui)).toBe(FULL)
  })
})
