import { joinPath } from './paths'
import { firstLine, messageOf, result } from './result'
import type { CheckResult, Context, Exec } from './types'

export const COMPOSE_ID = 'compose'
export const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
export const DOCKER_TIMEOUT_MS = 6000

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')

function unavailable(error: unknown): string {
  const message = messageOf(error)
  if (/time(d)? ?out/i.test(message)) return 'o docker não respondeu a tempo'
  return 'docker indisponível (não encontrado ou não arranca)'
}

function failure(exec: Exec): string {
  if (/permission denied/i.test(exec.stderr)) return 'sem permissão para o socket do docker'
  if (/cannot connect|daemon/i.test(exec.stderr)) return 'daemon do docker inacessível'
  return `docker compose falhou: ${firstLine(exec.stderr) || `código ${exec.exitCode}`}`
}

export async function checkCompose(ctx: Context): Promise<CheckResult> {
  const present = await Promise.all(COMPOSE_FILES.map(name => ctx.ports.exists(joinPath(ctx.root, name))))
  if (!present.some(Boolean)) return result(COMPOSE_ID, 'skipped', 'nenhum ficheiro compose na raiz do repositório')

  const init = { cwd: ctx.root, timeoutMs: DOCKER_TIMEOUT_MS }
  let declared: Exec
  let running: Exec
  try {
    ;[declared, running] = await Promise.all([
      ctx.ports.run(['docker', 'compose', 'config', '--services'], init),
      ctx.ports.run(['docker', 'compose', 'ps', '--services', '--status', 'running'], init),
    ])
  } catch (error) {
    return result(COMPOSE_ID, 'skipped', unavailable(error))
  }

  if (declared.exitCode !== 0) return result(COMPOSE_ID, 'skipped', failure(declared))
  if (running.exitCode !== 0) return result(COMPOSE_ID, 'skipped', failure(running))

  const ignored = new Set(ctx.config.ignoreServices)
  const expected = lines(declared.stdout).filter(service => !ignored.has(service))
  if (expected.length === 0) return result(COMPOSE_ID, 'skipped', 'nenhum serviço a verificar')

  const up = new Set(lines(running.stdout))
  const stopped = expected.filter(service => !up.has(service))
  if (stopped.length === 0) return result(COMPOSE_ID, 'ok', `${expected.length} serviço(s) em execução`)

  return result(
    COMPOSE_ID,
    'warn',
    `parados: ${stopped.join(', ')} (${expected.length - stopped.length}/${expected.length} em execução)`,
    `docker compose up -d ${stopped.join(' ')}`,
  )
}
