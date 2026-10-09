import { describe, expect, test } from 'claude-code/testing'

import { ROOT, edit, endTurn, file, lastStatus, multiEdit, newWorld, panelOf, read, stand, write } from './world'

describe('opt-in per repository', () => {
  test('without graphify-out edits leave nothing behind and no command runs', async ($, on) => {
    const world = newWorld({ hasGraph: false })
    stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)

    expect(world.spawns).toHaveLength(0)
    expect(world.versionChecks).toBe(0)
    expect(world.statusLog).toEqual([])
    expect(world.toasts).toEqual([])
    expect(await panelOf($)).toContain('inativo: sem graphify-out')
  })

  test('outside a git repository the mod is inert', async ($, on) => {
    const world = newWorld({ git: { exitCode: 128, stdout: '' } })
    stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)

    expect(world.spawns).toHaveLength(0)
    expect(world.toasts).toEqual([])
    expect(await panelOf($)).toContain('inativo: fora de um repositório git')
  })

  test('a missing git binary is inert too, never an error', async ($, on) => {
    const world = newWorld({ git: 'unavailable' })
    stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)

    expect(world.spawns).toHaveLength(0)
    expect(world.toasts).toEqual([])
  })
})

describe('dirty tracking', () => {
  test('Edit, Write and MultiEdit on watched files are counted, the preview keeps distinct paths', async ($, on) => {
    stand(on, newWorld({ plan: {} }), {})

    await edit($, file('src/a.ts'))
    await edit($, file('src/a.ts'))
    await write($, file('src/b.php'))
    await multiEdit($, file('src/c.vue'))

    expect(await panelOf($)).toContain('edições pendentes: 4 (src/a.ts, src/b.php, src/c.vue)')
  })

  test('ignored directories, unwatched extensions and files outside the root are not counted', async ($, on) => {
    stand(on, newWorld())

    for (const ignored of [
      'node_modules/x.js',
      'vendor/y.php',
      'graphify-out/graph.js',
      '.git/hooks/h.js',
      'packages/app/node_modules/z.ts',
      'docs/notes.md',
      'Makefile',
    ]) {
      await edit($, file(ignored))
    }
    await edit($, '/srv/example/other-app/src/a.ts')
    await edit($, `${ROOT}-copy/src/a.ts`)

    expect(await panelOf($)).toContain('edições pendentes: nenhuma')
  })

  test('tools that do not edit files are not counted', async ($, on) => {
    stand(on, newWorld())

    await read($, file('src/a.ts'))
    await $.tool.call({ tool: 'Bash', command: 'echo hi' })

    expect(await panelOf($)).toContain('edições pendentes: nenhuma')
  })

  test('backslash paths of a Windows checkout are matched against the repository root', async ($, on) => {
    stand(on, newWorld({ root: 'C:/work/example-app', git: { exitCode: 0, stdout: 'C:/work/example-app\n' } }))

    await edit($, 'C:\\work\\example-app\\src\\a.ts')

    expect(await panelOf($)).toContain('edições pendentes: 1 (src/a.ts)')
  })

  test('the preview stops at five paths while the count keeps growing', async ($, on) => {
    stand(on, newWorld())

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await edit($, file(`src/${name}.ts`))

    expect(await panelOf($)).toContain('edições pendentes: 7 (src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts, ...)')
  })

  test('only watched extensions of the configured list count', { options: { watchExtensions: 'py' } }, async ($, on) => {
    stand(on, newWorld())

    await edit($, file('src/a.ts'))
    await edit($, file('src/a.py'))

    expect(await panelOf($)).toContain('edições pendentes: 1 (src/a.py)')
  })

  test('no turn end, no run: edits alone never start the command', async ($, on) => {
    const world = newWorld()
    stand(on, world)

    await edit($, file('src/a.ts'))

    expect(world.spawns).toHaveLength(0)
    expect(lastStatus(world)).toBeUndefined()
  })
})
