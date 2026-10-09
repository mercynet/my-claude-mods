import { describe, expect, test } from 'claude-code/testing'

import { addCompose, addDir, addFile, env, healthyWorld, stand, start } from './world'

const MCP = JSON.stringify({ mcpServers: { local: { command: 'node' } } })

describe('session start', () => {
  test('registers /env and does not wait for the preflight', async ($, on) => {
    const world = healthyWorld()
    stand(on, world)

    await start($)

    expect(world.registered).toEqual(['env'])
    expect(world.fake.runs).toEqual([])
  })

  test('a healthy environment clears the status and shows no toast', async ($, on) => {
    const world = healthyWorld()
    const clock = stand(on, world)

    await start($)
    await clock.settle()

    expect(world.fake.runs.length).toBeGreaterThan(0)
    expect(world.statusLog).toEqual([undefined])
    expect(world.toasts).toEqual([])
  })

  test('a stopped service sets the status and one toast naming it', async ($, on) => {
    const world = healthyWorld()
    addCompose(world.fake, ['web', 'db', 'cache'], ['web'])
    const clock = stand(on, world)

    await start($)
    await clock.settle()

    expect(world.statusLog).toEqual(['env: 1 aviso'])
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('compose: parados: db, cache')
  })

  test('a failure outranks warnings in the toast', async ($, on) => {
    const world = healthyWorld()
    addCompose(world.fake, ['web', 'db'], ['web'])
    addFile(world.fake, '.mcp.json', MCP)
    addFile(world.fake, 'package.json', '{}')
    const clock = stand(on, world)

    await start($)
    await clock.settle()

    expect(world.statusLog).toEqual(['env: 1 falha, 1 aviso'])
    expect(world.toasts[0]).toContain('node-deps')
    expect(world.toasts[0]).toContain('(+1 em /env)')
  })

  test('the git toplevel is the root the checks look at', async ($, on) => {
    const world = healthyWorld()
    const clock = stand(on, world)

    await start($)
    await clock.settle()

    expect(world.fake.runs[0]).toEqual(['git', 'rev-parse', '--show-toplevel'])
  })

  test('a preflight that cannot start is logged to debug and never throws', async ($, on) => {
    const world = healthyWorld()
    world.rootFails = true
    const clock = stand(on, world)

    await start($)
    await clock.settle()

    expect(world.debugLog[0]).toContain('env-doctor: preflight skipped')
    expect(world.toasts).toEqual([])
  })
})

describe('/env', () => {
  test('prints the table and reports a missing required path', async ($, on) => {
    const world = healthyWorld()
    stand(on, world)

    const { text } = await env($)

    expect(text).toContain('[ok]   compose: 3 serviço(s) em execução')
    expect(text).toContain('[skip] node-deps')
    expect(text).toContain('[skip] empty-files: nenhum ficheiro configurado')
    expect(text).toContain('[skip] required-paths')
  })

  test('every run is fresh and updates the status', async ($, on) => {
    const world = healthyWorld()
    addCompose(world.fake, ['web', 'db'], ['web'])
    stand(on, world)

    const first = await env($)
    addCompose(world.fake, ['web', 'db'], ['web', 'db'])
    const second = await env($)

    expect(first.text).toContain('[warn] compose: parados: db')
    expect(first.text).toContain('correção: docker compose up -d db')
    expect(second.text).toContain('[ok]   compose')
    expect(world.statusLog).toEqual(['env: 1 aviso', undefined])
  })

  test('docker missing turns the compose line into a skip', async ($, on) => {
    const world = healthyWorld()
    world.fake.responses.clear()
    addFile(world.fake, 'docker-compose.yml')
    stand(on, world)

    const { text } = await env($)

    expect(text).toContain('[skip] compose: docker indisponível')
  })

  test('a docker call that never answers is cut by the budget', async ($, on) => {
    const world = healthyWorld()
    world.hangDocker = true
    const clock = stand(on, world)

    const pending = env($)
    await clock.settle()
    await clock.advance(8000)
    const { text } = await pending

    expect(text).toContain('[skip] compose: sem resposta em 8s')
    expect(text).toContain('[skip] node-deps')
  })
})

describe('configuration', () => {
  test('without the emptyFiles option an empty file is ignored', async ($, on) => {
    const world = healthyWorld()
    addFile(world.fake, 'cache/data.php', '')
    stand(on, world)

    const { text } = await env($)

    expect(text).toContain('[skip] empty-files')
  })

  test('with the option set, the empty file warns and the status says so', { options: { emptyFiles: 'cache/data.php' } }, async ($, on) => {
    const world = healthyWorld()
    addFile(world.fake, 'cache/data.php', '')
    stand(on, world)

    const { text } = await env($)

    expect(text).toContain('[warn] empty-files: cache/data.php: vazio (0 bytes) | correção: rm cache/data.php')
    expect(world.statusLog).toEqual(['env: 1 aviso'])
  })

  test('requiredPaths and ignoreServices from the options reach their checks', {
    options: { requiredPaths: 'vendor, .env', ignoreServices: 'cache' },
  }, async ($, on) => {
    const world = healthyWorld()
    addCompose(world.fake, ['web', 'cache'], ['web'])
    addDir(world.fake, 'vendor')
    stand(on, world)

    const { text } = await env($)

    expect(text).toContain('[ok]   compose: 1 serviço(s) em execução')
    expect(text).toContain('[warn] required-paths: em falta: .env')
  })
})
