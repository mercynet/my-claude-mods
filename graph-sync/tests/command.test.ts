import { describe, expect, test } from 'claude-code/testing'

import { ROOT, edit, endTurn, file, graph, newWorld, panelOf, stand } from './world'

describe('/graph', () => {
  test('without graphify-out it explains why it is inert', async ($, on) => {
    stand(on, newWorld({ hasGraph: false }))

    const text = await panelOf($)

    expect(text).toContain('graph-sync 0.1.0')
    expect(text).toContain(`inativo: sem graphify-out em ${ROOT}`)
    expect(text).toContain('comando: graphify update .')
  })

  test('shows the pending edits, the last run and the configuration', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 38_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(38_000)
    await edit($, file('src/b.php'))
    await edit($, file('src/c.php'))

    const text = await panelOf($)

    expect(text).toContain(`repositório: ${ROOT}`)
    expect(text).toContain('execução: parada')
    expect(text).toContain('edições pendentes: 2 (src/b.php, src/c.php)')
    expect(text).toContain('última execução: 2023-11-14 22:13 UTC, 38s, ok (código 0), 1 edição(ões)')
    expect(text).toContain('intervalo mínimo: 5min · limite: 10min · extensões: php, ts,')
  })

  test('/graph status is the same panel', async ($, on) => {
    stand(on, newWorld())

    expect((await graph($, 'status')).text).toBe((await graph($)).text)
  })

  test('an unknown argument prints the usage', async ($, on) => {
    stand(on, newWorld())

    expect((await graph($, 'bogus')).text).toBe('uso: /graph [status | now]')
  })
})

describe('/graph now', () => {
  test('runs without pending edits and inside the interval, and still honours the lock', async ($, on) => {
    const world = newWorld({ plan: { durationMs: 2_000 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.advance(2_000)
    expect(world.spawns).toHaveLength(1)

    const started = await graph($, 'now')
    await clock.settle()
    expect(started.text).toContain('atualização iniciada')
    expect(world.spawns).toHaveLength(2)
    expect(await panelOf($)).toContain('execução: em curso')

    const busy = await graph($, 'now')
    expect(busy.text).toContain('já há uma atualização em curso')
    expect(world.spawns).toHaveLength(2)

    await clock.advance(2_000)
    expect(await panelOf($)).toContain('execução: parada')
  })

  test('is refused outside a repository that opted in', async ($, on) => {
    const world = newWorld({ hasGraph: false })
    stand(on, world)

    expect((await graph($, 'now')).text).toContain('graph-sync inativo: sem graphify-out')
    expect(world.spawns).toHaveLength(0)
  })

  test('retries after a failure even without a new edit', async ($, on) => {
    const world = newWorld({ plan: { code: 3 } })
    const clock = stand(on, world)

    await edit($, file('src/a.ts'))
    await endTurn($)
    await clock.settle()
    expect(world.spawns).toHaveLength(1)

    world.plan = { code: 0 }
    await graph($, 'now')
    await clock.settle()

    expect(world.spawns).toHaveLength(2)
    expect(await panelOf($)).not.toContain('falha em aberto')
  })
})
