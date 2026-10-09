import { joinPath } from './paths'
import { result } from './result'
import type { CheckResult, Context } from './types'

export const NODE_DEPS_ID = 'node-deps'

const NODE_RUNNERS = new Set(['node', 'nodejs', 'tsx', 'ts-node', 'bun', 'deno'])

const LOCKFILES: readonly (readonly [string, string])[] = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['yarn.lock', 'yarn install'],
  ['bun.lockb', 'bun install'],
  ['bun.lock', 'bun install'],
]

const runnerOf = (command: unknown): string =>
  typeof command === 'string' ? (command.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd)$/i, '').toLowerCase() : ''

export type McpServers = { names: string[]; hasServers: boolean }

export function nodeServers(json: string): McpServers | undefined {
  try {
    const parsed: unknown = JSON.parse(json)
    const servers = (parsed as { mcpServers?: Record<string, { command?: unknown }> } | null)?.mcpServers
    if (servers === null || typeof servers !== 'object') return undefined
    const entries = Object.entries(servers)
    return {
      hasServers: entries.length > 0,
      names: entries.filter(([, server]) => NODE_RUNNERS.has(runnerOf(server?.command))).map(([name]) => name),
    }
  } catch {
    return undefined
  }
}

async function installCommand(ctx: Context): Promise<string> {
  for (const [file, command] of LOCKFILES) {
    if (await ctx.ports.exists(joinPath(ctx.root, file))) return command
  }
  return 'npm install'
}

export async function checkNodeDeps(ctx: Context): Promise<CheckResult> {
  const mcpPath = joinPath(ctx.root, '.mcp.json')
  const [hasMcp, hasPackage] = await Promise.all([
    ctx.ports.exists(mcpPath),
    ctx.ports.exists(joinPath(ctx.root, 'package.json')),
  ])
  if (!hasMcp) return result(NODE_DEPS_ID, 'skipped', 'sem .mcp.json na raiz do repositório')
  if (!hasPackage) return result(NODE_DEPS_ID, 'skipped', 'sem package.json na raiz do repositório')
  if (await ctx.ports.exists(joinPath(ctx.root, 'node_modules'))) return result(NODE_DEPS_ID, 'ok', 'node_modules presente')

  const servers = nodeServers(await ctx.ports.read(mcpPath).catch(() => ''))
  if (servers !== undefined && servers.hasServers && servers.names.length === 0) {
    return result(NODE_DEPS_ID, 'skipped', 'nenhum servidor MCP executa scripts node')
  }

  const which = servers !== undefined && servers.names.length > 0 ? ` (${servers.names.join(', ')})` : ''
  return result(
    NODE_DEPS_ID,
    'fail',
    `node_modules ausente: servidores MCP que executam scripts node${which} falham ao ligar`,
    await installCommand(ctx),
  )
}

