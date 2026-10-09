import type { InstructionFile, On, PromptContextBlock, PluginOptions, SessionContextBreakdown } from 'claude-code'
import { mock, test as baseTest } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

export const OPTIONS: PluginOptions = {
  omittableSections: 'Section A;Section B;Section C;Section D (extra notes)',
}

export const test = (name: string, body: TestBody): void => baseTest(name, { options: OPTIONS }, body)

export const lean = ($: Engine, args: string) =>
  $.command.run({
    command: 'lean',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

export const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

export const compose = ($: Engine) =>
  $.prompt.compose({
    model: 'test-model',
    promptModel: 'test-model',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  })

export const compact = ($: Engine, agentId?: string) =>
  $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [] }], agentId })

export const ROOT = '/srv/example/example-app'
export const SESSION = 'session-1'
export const FENCE = '```'

export type World = {
  sessionId: string
  root: string
  git: { exitCode: number; stdout: string } | 'unavailable'
  dirs: Set<string>
  turns: number
  contextTokens: number | undefined
  statusLog: string[]
  submittedContexts: (readonly string[] | undefined)[]
  dropNextSubmit: boolean
  skipCompaction: boolean
  breakdownCalls: number
  toasts: string[]
  transcript: string[]
}

export const AGENTS_TEXT = [
  '# AGENTS.md',
  '',
  '## Style rules',
  'No useless comments.',
  '',
  '## Development Guidelines',
  '### Critical Rules',
  '- NEVER skip the review checklist.',
  '',
  '## Section A',
  'Body of section A.',
  '',
  '## Section B',
  '- Body of section B.',
  '',
  '# Closing notes',
  'Do what has been asked.',
  '',
  '## Section C',
  'Body of section C.',
  FENCE + 'bash',
  '# never: keep this comment line',
  FENCE,
  '',
  '## Section D (extra notes)',
  'Body of section D.',
  '',
].join('\n')

export const agentsFile = (content = AGENTS_TEXT, dir = ROOT): InstructionFile => ({
  path: `${dir}/AGENTS.md`,
  kind: 'project',
  content,
  parent: `${dir}/CLAUDE.md`,
})

export const claudeMdBlock = (files: readonly InstructionFile[]): PromptContextBlock => ({
  name: 'claudeMd',
  text: files.map(file => file.content).join('\n'),
})

export const contextInput = (text = AGENTS_TEXT) => {
  const files = [agentsFile(text)]
  return { blocks: [claudeMdBlock(files), { name: 'currentDate', text: '2026-10-07' }], instructionFiles: files }
}

export const newWorld = (overrides: Partial<World> = {}): World => ({
  sessionId: SESSION,
  root: ROOT,
  git: { exitCode: 0, stdout: 'feature-x\n' },
  dirs: new Set([`${ROOT}/specs`, `${ROOT}/specs/_active`]),
  turns: 1,
  contextTokens: 31000,
  statusLog: [],
  submittedContexts: [],
  dropNextSubmit: false,
  skipCompaction: false,
  breakdownCalls: 0,
  toasts: [],
  transcript: [],
  ...overrides,
})

export const addSpec = (world: World, branch: string): void => {
  world.dirs.add(`${ROOT}/specs/_active/${branch}`)
}

export const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 6000, color: 'a', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 9000, color: 'b', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 150000, color: 'c', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 31000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'auto',
  percentage: 15,
  gridRows: [],
  model: 'test-model',
  memoryFiles: [
    { path: `${ROOT}/AGENTS.md`, type: 'Project', tokens: 8600 },
    { path: `${ROOT}/CLAUDE.md`, type: 'Project', tokens: 600 },
  ],
  mcpTools: [
    { name: 'mcp__context7__query-docs', serverName: 'context7', tokens: 700, isLoaded: true },
    { name: 'mcp__context7__resolve', serverName: 'context7', tokens: 500, isLoaded: true },
    { name: 'mcp__example-mcp__inspect', serverName: 'example-mcp', tokens: 900, isLoaded: false },
  ],
  agents: [],
  skills: { totalSkills: 25, includedSkills: 25, tokens: 3100, skillFrontmatter: [] },
  isAutoCompactEnabled: true,
  apiUsage: null,
}

export function stand(on: On, world: World, store: Record<string, unknown> = {}): void {
  mock.store(on, store)
  mock.clock(on, { now: 1_700_000_000_000 })

  on('session.id', () => ({ value: world.sessionId }))
  on('session.root', () => ({ value: world.root }))
  on('session.turns', () => ({ value: world.turns }))
  on('session.usage', (_$, e) => {
    if (e.breakdown !== undefined) world.breakdownCalls += 1
    return {
    value: {
      startedAt: 0,
      context: {
        window: 200000,
        tokens: world.contextTokens,
        breakdown: e.breakdown === undefined ? undefined : BREAKDOWN,
      },
      rateLimits: [],
    },
    }
  })
  on('process.run', (_$, e) => {
    if (world.git === 'unavailable') return { deny: `git not found for ${e.argv.join(' ')}` }
    return {
      value: {
        exitCode: world.git.exitCode,
        stdout: world.git.stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('fs.exists', (_$, e) => ({ value: world.dirs.has(e.path) }))
  on('fs.stat', (_$, e) =>
    world.dirs.has(e.path)
      ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('ui.status', (_$, e) => {
    world.statusLog.push(e.text ?? '')
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    if (e.to === 'transcript') world.transcript.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.context', (_$, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  on('session.compact', () => (world.skipCompaction ? { skip: 'skipped by the test' } : { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => {
    world.submittedContexts.push(e.context)
    if (world.dropNextSubmit) {
      world.dropNextSubmit = false
      return { drop: 'dropped by the test' }
    }
    return { text: e.text, context: e.context }
  })
}
