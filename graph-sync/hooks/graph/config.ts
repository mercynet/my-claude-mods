export const VERSION = '0.1.0'

export const GRAPH_DIR = 'graphify-out'

export const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([GRAPH_DIR, 'node_modules', 'vendor', '.git'])

export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit'])

export const PATH_PREVIEW = 5

export const STATUS_OK_MS = 10_000

export const TOAST_FAILURE_MS = 8_000

export const VERSION_CHECK_MS = 15_000

export const OUTPUT_LIMIT = 8_000

export const MIN_DEFER_MS = 1_000

export const STORE_DIAG = 'diag'
