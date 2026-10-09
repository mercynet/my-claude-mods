import { describe, expect, test } from 'claude-code/testing'

import { checkCompose } from '../hooks/doctor/compose'
import { checkEmptyFiles, checkRequiredPaths, emptinessOf, NEAR_EMPTY_BYTES, READ_LIMIT_BYTES } from '../hooks/doctor/files'
import { checkNodeDeps, nodeServers } from '../hooks/doctor/nodeDeps'
import { parseList, readConfig } from '../hooks/doctor/options'
import { isRepoRelative, joinPath, shellWord } from '../hooks/doctor/paths'
import {
  HEALTHY_TEXT,
  ROOT,
  addCompose,
  addDir,
  addFile,
  contextOf,
  failed,
  newFake,
  ok,
} from './world'

describe('checkCompose', () => {
  test('without a compose file the check is skipped and docker is never called', async () => {
    const fake = newFake()

    expect(await checkCompose(contextOf(fake))).toMatchObject({ id: 'compose', status: 'skipped' })
    expect(fake.runs).toEqual([])
  })

  test('every declared service running is ok', async () => {
    const fake = newFake()
    addCompose(fake, ['web', 'db', 'cache'], ['cache', 'db', 'web'])

    expect(await checkCompose(contextOf(fake))).toEqual({
      id: 'compose',
      status: 'ok',
      reason: '3 serviço(s) em execução',
    })
  })

  test('stopped services warn with the exact up command', async () => {
    const fake = newFake()
    addCompose(fake, ['web', 'db', 'cache'], ['web'])

    expect(await checkCompose(contextOf(fake))).toEqual({
      id: 'compose',
      status: 'warn',
      reason: 'parados: db, cache (1/3 em execução)',
      fix: 'docker compose up -d db cache',
    })
  })

  test('ignored services are neither expected nor reported', async () => {
    const fake = newFake()
    addCompose(fake, ['web', 'migrate'], ['web'])

    const result = await checkCompose(contextOf(fake, { ignoreServices: ['migrate'] }))

    expect(result).toMatchObject({ status: 'ok', reason: '1 serviço(s) em execução' })
  })

  test('a compose file declaring only ignored services has nothing to check', async () => {
    const fake = newFake()
    addCompose(fake, ['migrate'], [])

    expect(await checkCompose(contextOf(fake, { ignoreServices: ['migrate'] }))).toMatchObject({ status: 'skipped' })
  })

  test('the compose.yaml spelling is found too', async () => {
    const fake = newFake()
    addFile(fake, 'compose.yaml')
    fake.responses.set('docker compose config', ok('web\n'))
    fake.responses.set('docker compose ps', ok(''))

    expect(await checkCompose(contextOf(fake))).toMatchObject({ status: 'warn', fix: 'docker compose up -d web' })
  })

  test('both docker calls run in the repository root with a timeout', async () => {
    const fake = newFake()
    addCompose(fake, ['web'], ['web'])
    const seen: unknown[] = []
    const ctx = contextOf(fake)
    const run = ctx.ports.run
    ctx.ports.run = (argv, init) => {
      seen.push(init)
      return run(argv, init)
    }

    await checkCompose(ctx)

    expect(seen).toEqual([
      { cwd: ROOT, timeoutMs: 6000 },
      { cwd: ROOT, timeoutMs: 6000 },
    ])
  })

  test('docker missing is skipped, not a failure', async () => {
    const fake = newFake()
    addFile(fake, 'docker-compose.yml')
    fake.responses.set('docker compose config', new Error('spawn docker ENOENT'))
    fake.responses.set('docker compose ps', new Error('spawn docker ENOENT'))

    expect(await checkCompose(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'docker indisponível (não encontrado ou não arranca)',
    })
  })

  test('a docker timeout is skipped with its own reason', async () => {
    const fake = newFake()
    addFile(fake, 'docker-compose.yml')
    fake.responses.set('docker compose config', ok('web\n'))
    fake.responses.set('docker compose ps', new Error('command timed out after 6000ms'))

    expect(await checkCompose(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'o docker não respondeu a tempo',
    })
  })

  test('permission denied on the socket is skipped', async () => {
    const fake = newFake()
    addFile(fake, 'docker-compose.yml')
    fake.responses.set('docker compose config', ok('web\n'))
    fake.responses.set(
      'docker compose ps',
      failed('permission denied while trying to connect to the Docker daemon socket'),
    )

    expect(await checkCompose(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'sem permissão para o socket do docker',
    })
  })

  test('an unreachable daemon is skipped', async () => {
    const fake = newFake()
    addFile(fake, 'docker-compose.yml')
    fake.responses.set('docker compose config', ok('web\n'))
    fake.responses.set('docker compose ps', failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'))

    expect(await checkCompose(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'daemon do docker inacessível',
    })
  })

  test('another docker failure quotes the first stderr line', async () => {
    const fake = newFake()
    addFile(fake, 'docker-compose.yml')
    fake.responses.set('docker compose config', failed('\nservices.web.image must be a string\nmore detail', 15))
    fake.responses.set('docker compose ps', ok(''))

    expect(await checkCompose(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'docker compose falhou: services.web.image must be a string',
    })
  })
})

describe('checkNodeDeps', () => {
  const mcp = (servers: Record<string, { command: string }>) => JSON.stringify({ mcpServers: servers })

  test('without .mcp.json the check is skipped', async () => {
    const fake = newFake()
    addFile(fake, 'package.json', '{}')

    expect(await checkNodeDeps(contextOf(fake))).toMatchObject({ id: 'node-deps', status: 'skipped' })
  })

  test('without package.json the check is skipped', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', mcp({ local: { command: 'node' } }))

    expect(await checkNodeDeps(contextOf(fake))).toMatchObject({ status: 'skipped' })
  })

  test('node_modules present is ok', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', mcp({ local: { command: 'node' } }))
    addFile(fake, 'package.json', '{}')
    addDir(fake, 'node_modules')

    expect(await checkNodeDeps(contextOf(fake))).toEqual({
      id: 'node-deps',
      status: 'ok',
      reason: 'node_modules presente',
    })
  })

  test('node_modules missing fails, naming the servers that run node, with npm install', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', mcp({ local: { command: 'node' }, docs: { command: 'npx' } }))
    addFile(fake, 'package.json', '{}')

    expect(await checkNodeDeps(contextOf(fake))).toEqual({
      id: 'node-deps',
      status: 'fail',
      reason: 'node_modules ausente: servidores MCP que executam scripts node (local) falham ao ligar',
      fix: 'npm install',
    })
  })

  test('the install command follows the lockfile', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', mcp({ local: { command: '/usr/bin/node' } }))
    addFile(fake, 'package.json', '{}')
    addFile(fake, 'pnpm-lock.yaml')

    expect(await checkNodeDeps(contextOf(fake))).toMatchObject({ status: 'fail', fix: 'pnpm install' })
  })

  test('only servers that do not run local node scripts is skipped', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', mcp({ docs: { command: 'npx' }, remote: { command: 'docker' } }))
    addFile(fake, 'package.json', '{}')

    expect(await checkNodeDeps(contextOf(fake))).toMatchObject({
      status: 'skipped',
      reason: 'nenhum servidor MCP executa scripts node',
    })
  })

  test('an unreadable .mcp.json still fails, without naming servers', async () => {
    const fake = newFake()
    addFile(fake, '.mcp.json', '{ not json')
    addFile(fake, 'package.json', '{}')

    expect(await checkNodeDeps(contextOf(fake))).toMatchObject({
      status: 'fail',
      reason: 'node_modules ausente: servidores MCP que executam scripts node falham ao ligar',
      fix: 'npm install',
    })
  })

  test('nodeServers reads command basenames, with extension and path', () => {
    const json = mcp({ a: { command: 'C:\\tools\\Node.exe' }, b: { command: 'python' }, c: { command: 'tsx' } })

    expect(nodeServers(json)).toEqual({ hasServers: true, names: ['a', 'c'] })
    expect(nodeServers('{}')).toBeUndefined()
  })
})

describe('emptinessOf', () => {
  test('a zero-byte file is empty', () => {
    expect(emptinessOf(0, '')).toBe('vazio (0 bytes)')
  })

  test('a file below the near-empty threshold is flagged with its size', () => {
    expect(emptinessOf(30, '<?php return [];')).toBe('quase vazio (30 bytes)')
  })

  test('an empty routes collection is flagged in the three spellings', () => {
    const padding = ' '.repeat(NEAR_EMPTY_BYTES)

    expect(emptinessOf(400, `<?php return array (\n  'routes' => \n  array (\n  ),\n${padding});`)).toBe("coleção 'routes' vazia")
    expect(emptinessOf(400, `<?php return ['routes' => [], 'x' => 1];${padding}`)).toBe("coleção 'routes' vazia")
    expect(emptinessOf(400, `{ "routes": [] ${padding}}`)).toBe("coleção 'routes' vazia")
  })

  test('a routes collection with entries is healthy', () => {
    expect(emptinessOf(400, `<?php return ['routes' => ['a' => 1]]; // ${'x'.repeat(NEAR_EMPTY_BYTES)}`)).toBeUndefined()
  })

  test('a file that was not read can only be judged by being empty', () => {
    expect(emptinessOf(READ_LIMIT_BYTES + 1, undefined)).toBeUndefined()
  })
})

describe('checkEmptyFiles', () => {
  test('without configured files the check is skipped', async () => {
    expect(await checkEmptyFiles(contextOf(newFake()))).toMatchObject({ id: 'empty-files', status: 'skipped' })
  })

  test('configured files that do not exist are skipped', async () => {
    const result = await checkEmptyFiles(contextOf(newFake(), { emptyFiles: ['cache/data.php'] }))

    expect(result).toMatchObject({ status: 'skipped', reason: 'nenhum dos ficheiros configurados existe' })
  })

  test('a healthy file is ok', async () => {
    const fake = newFake()
    addFile(fake, 'cache/data.php', HEALTHY_TEXT)

    expect(await checkEmptyFiles(contextOf(fake, { emptyFiles: ['cache/data.php'] }))).toEqual({
      id: 'empty-files',
      status: 'ok',
      reason: '1 ficheiro(s) com conteúdo',
    })
  })

  test('an empty file warns with the remove command', async () => {
    const fake = newFake()
    addFile(fake, 'cache/data.php', '')

    expect(await checkEmptyFiles(contextOf(fake, { emptyFiles: ['cache/data.php'] }))).toEqual({
      id: 'empty-files',
      status: 'warn',
      reason: 'cache/data.php: vazio (0 bytes)',
      fix: 'rm cache/data.php',
    })
  })

  test('several findings are listed and quoted for the shell', async () => {
    const fake = newFake()
    addFile(fake, 'cache/a.php', '')
    addFile(fake, 'my cache/b.php', '<?php return [];')
    addFile(fake, 'cache/c.php', HEALTHY_TEXT)

    const result = await checkEmptyFiles(contextOf(fake, { emptyFiles: ['cache/a.php', 'my cache/b.php', 'cache/c.php'] }))

    expect(result.status).toBe('warn')
    expect(result.reason).toContain('cache/a.php: vazio (0 bytes)')
    expect(result.reason).toContain('my cache/b.php: quase vazio')
    expect(result.fix).toBe("rm cache/a.php 'my cache/b.php'")
  })

  test('a file above the read limit is never read', async () => {
    const fake = newFake()
    addFile(fake, 'cache/big.php', HEALTHY_TEXT)
    fake.sizes.set(`${ROOT}/cache/big.php`, READ_LIMIT_BYTES + 1)

    const result = await checkEmptyFiles(contextOf(fake, { emptyFiles: ['cache/big.php'] }))

    expect(result.status).toBe('ok')
    expect(fake.reads).toEqual([])
  })

  test('a directory with the configured name is not a file', async () => {
    const fake = newFake()
    addDir(fake, 'cache/data.php')

    expect(await checkEmptyFiles(contextOf(fake, { emptyFiles: ['cache/data.php'] }))).toMatchObject({
      status: 'skipped',
    })
  })

  test('paths outside the repository are flagged and never touched', async () => {
    const fake = newFake()

    const result = await checkEmptyFiles(contextOf(fake, { emptyFiles: ['../secret', '/etc/passwd'] }))

    expect(result).toMatchObject({ status: 'warn', reason: 'caminho fora do repositório ignorado: ../secret, /etc/passwd' })
    expect(fake.reads).toEqual([])
  })
})

describe('checkRequiredPaths', () => {
  test('without configured paths the check is skipped', async () => {
    expect(await checkRequiredPaths(contextOf(newFake()))).toMatchObject({ id: 'required-paths', status: 'skipped' })
  })

  test('every path present is ok', async () => {
    const fake = newFake()
    addDir(fake, 'vendor')
    addFile(fake, '.env')

    expect(await checkRequiredPaths(contextOf(fake, { requiredPaths: ['vendor', '.env'] }))).toEqual({
      id: 'required-paths',
      status: 'ok',
      reason: '2 caminho(s) presentes',
    })
  })

  test('missing paths warn and are listed', async () => {
    const fake = newFake()
    addDir(fake, 'vendor')

    expect(await checkRequiredPaths(contextOf(fake, { requiredPaths: ['vendor', '.env', 'storage'] }))).toEqual({
      id: 'required-paths',
      status: 'warn',
      reason: 'em falta: .env, storage',
      fix: 'crie ou restaure: .env, storage',
    })
  })

  test('an invalid entry warns even when the rest is present', async () => {
    const fake = newFake()
    addDir(fake, 'vendor')

    expect(await checkRequiredPaths(contextOf(fake, { requiredPaths: ['vendor', '../outside'] }))).toMatchObject({
      status: 'warn',
      reason: 'caminho fora do repositório ignorado: ../outside',
    })
  })
})

describe('options and paths', () => {
  test('parseList splits on commas, trims and drops empties', () => {
    expect(parseList(' a/b , ,c ,')).toEqual(['a/b', 'c'])
    expect(parseList(['x', ' y '])).toEqual(['x', 'y'])
    expect(parseList('')).toEqual([])
    expect(parseList(undefined)).toEqual([])
    expect(parseList(3)).toEqual([])
  })

  test('readConfig reads the three keys and leaves unset ones empty', () => {
    expect(readConfig({ emptyFiles: 'a,b', ignoreServices: 'job' })).toEqual({
      emptyFiles: ['a', 'b'],
      requiredPaths: [],
      ignoreServices: ['job'],
    })
  })

  test('isRepoRelative rejects absolute, drive and parent paths', () => {
    expect(isRepoRelative('cache/a.php')).toBe(true)
    expect(isRepoRelative('/etc/passwd')).toBe(false)
    expect(isRepoRelative('C:\\temp')).toBe(false)
    expect(isRepoRelative('a/../../b')).toBe(false)
    expect(isRepoRelative('a\\..\\b')).toBe(false)
  })

  test('joinPath normalises the separators at the seam', () => {
    expect(joinPath('/srv/example/', '/a/b')).toBe('/srv/example/a/b')
  })

  test('shellWord quotes only what needs it', () => {
    expect(shellWord('a/b-c.php')).toBe('a/b-c.php')
    expect(shellWord("it's here")).toBe("'it'\\''s here'")
  })
})
