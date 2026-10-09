export type Status = 'ok' | 'warn' | 'fail' | 'skipped'

export type CheckResult = {
  id: string
  status: Status
  reason: string
  fix?: string
}

export type Exec = { exitCode: number; stdout: string; stderr: string }

export type FileInfo = { kind: 'file' | 'dir' | 'other'; size: number }

export type Ports = {
  run: (argv: readonly string[], init: { cwd: string; timeoutMs: number }) => Promise<Exec>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<FileInfo>
  read: (path: string) => Promise<string>
}

export type Config = {
  emptyFiles: readonly string[]
  requiredPaths: readonly string[]
  ignoreServices: readonly string[]
}

export type Context = { root: string; ports: Ports; config: Config }

export type Check = { id: string; run: (ctx: Context) => Promise<CheckResult> }
