import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'

import { branchFromGit, labelOf } from './band/branch'
import { GIT_TIMEOUT_MS, parseOptions } from './band/config'
import type { BandOptions } from './band/config'
import { buildView } from './band/format'
import { isInside, joinPath } from './band/paths'
import { parsePhase } from './band/phase'
import { countTasks } from './band/tasks'

const snapshotAtom = atom({ plugin: 'spec-band', key: 'snapshot' } as const, null)
const editsAtom = atom({ plugin: 'spec-band', key: 'edits' } as const, 0)

const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/

async function readTasks($: EngineInterface, path: string) {
  try {
    return countTasks(await $.fs.read(path))
  } catch {
    return null
  }
}

async function readState($: EngineInterface, path: string) {
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') return { mtimeMs: null, phase: null }
    const phase = await $.fs.read(path).then(parsePhase, () => null)
    return { mtimeMs: stat.mtimeMs, phase }
  } catch {
    return { mtimeMs: null, phase: null }
  }
}

async function probe($: EngineInterface, options: BandOptions): Promise<Snapshot | null> {
  try {
    const root = await $.session.root()
    const output = await $.process.run(['git', '-C', root, 'branch', '--show-current'], { timeoutMs: GIT_TIMEOUT_MS })
    const branch = branchFromGit(output)
    if (branch.kind !== 'branch') return null

    const specDir = joinPath(joinPath(root, options.specsDir), branch.name)
    const dir = await $.fs.stat(specDir).catch(() => undefined)
    if (dir?.kind !== 'dir') return null

    const [tasks, state] = await Promise.all([
      readTasks($, joinPath(specDir, options.tasksFile)),
      readState($, joinPath(specDir, options.stateFile)),
    ])

    return { label: labelOf(branch.name), tasks, stateMtimeMs: state.mtimeMs, phase: state.phase }
  } catch {
    return null
  }
}

async function refresh($: EngineInterface, options: BandOptions, isEdit: boolean): Promise<void> {
  const next = await probe($, options)
  const previous = await read($, snapshotAtom)
  const edits = await read($, editsAtom)

  const isSameSpec = previous !== null && next !== null && previous.label === next.label
  const isStateUnchanged = isSameSpec && next.stateMtimeMs !== null && previous.stateMtimeMs === next.stateMtimeMs
  const counted = isStateUnchanged ? edits + (isEdit ? 1 : 0) : 0

  await update($, editsAtom, () => counted)
  await update($, snapshotAtom, () => next)
  $.ui.invalidate('ui.render')
}

async function refreshQuietly($: EngineInterface, options: BandOptions, isEdit = false): Promise<void> {
  try {
    await refresh($, options, isEdit)
  } catch {
    // The band is advisory: a failed probe must never reach the session.
  }
}

export const register: Register = (on, raw) => {
  const options = parseOptions(raw)

  on('session.start', async ($, e, next) => {
    await refreshQuietly($, options)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await refreshQuietly($, options)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshQuietly($, options)

    return next(e)
  })

  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      const path = (e as unknown as { file_path?: unknown }).file_path
      const isInProject = typeof path !== 'string' || isInside(await $.session.root().catch(() => '/'), path)
      await refreshQuietly($, options, isInProject)
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const snapshot = await read($, snapshotAtom)
    if (e.props.hasSurvey || snapshot === null) return below

    const edits = await read($, editsAtom)
    const now = await $.clock.now()
    const view = buildView({
      label: snapshot.label,
      tasks: snapshot.tasks,
      stateFile: options.stateFile,
      ageMs: snapshot.stateMtimeMs === null ? null : now - snapshot.stateMtimeMs,
      phase: snapshot.phase,
      edits,
      staleAfterEdits: options.staleAfterEdits,
    })

    const { Box, Text } = $.ui.resolve(e)

    const own = (
      <Box>
        {view.isStale ? (
          <Text color="yellow" wrap="truncate">
            {`▸ ${view.text}`}
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {view.text}
          </Text>
        )}
      </Box>
    )

    return below.type === 'engine' ? (
      own
    ) : (
      <Box flexDirection="column">
        {own}
        {below}
      </Box>
    )
  })
}
