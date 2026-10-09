# graph-sync

Keeps a code knowledge graph fresh while you work. After the agent edits code, the mod runs an
AST-only update command (default `graphify update .`) in the background once the turn ends, so the
graph is not a week behind the code the agent is about to query.

It is opt-in per repository: the mod does nothing unless `<repo root>/graphify-out` exists.

## What it does

1. Watches `Edit`, `Write` and `MultiEdit` calls. An edit to a file under the repository root, with
   a watched extension and outside `graphify-out/`, `node_modules/`, `vendor/` and `.git/` (at any
   depth), adds one to the session's pending-edit count.
2. When a main-conversation turn ends and edits are pending, it starts the command in the
   background, with the repository root as working directory and no shell. The turn end never waits
   for it; the child is owned by the mod and ends with it.
3. Shows `grafo: atualizando...` in the status line while it runs, `grafo ok (38s)` for ten seconds
   after a success, and `grafo: falhou` (plus a toast with the exit code and the first stderr line)
   after a failure, until the next success.
4. Records every run in `$.store` per repository: start time, duration, exit code, outcome and the
   number of edits it covered.

Rules that keep it from being noisy:

- At most one run per `minIntervalMinutes`, counted from the start of the last run of any session.
  Edits that arrive inside the interval trigger one deferred check when it ends, which waits for the
  current turn to finish.
- A run that fails is not retried until a new edit arrives. `/graph now` is the manual retry.
- Edits made while a run is in flight keep the set dirty, so one more run follows.
- If the executable is not found, one toast is shown and the mod is off for the session.
  `/graph now` checks again.
- Every error is swallowed into a `diag` entry in the store; the mod never blocks a tool call or a
  turn, and never writes a file of the repository itself.

## What it never does

- It never touches a documentation or knowledge graph, and never runs a paid or model-backed
  extraction. It runs exactly the configured command and nothing else. Point `command` at an
  AST-only update; the mod cannot tell what a command costs.
- It does not see changes made through `Bash` (`sed -i`, formatters, git checkouts). Those are
  picked up the next time one of the watched tools edits a file, or by `/graph now`.

## Commands

- `/graph` or `/graph status`: repository, command, whether a run is in progress and since when,
  pending edits with the first paths, the last run (time, duration, exit code, edits covered), a
  pending failure, and the configuration.
- `/graph now`: runs once, ignoring the interval and the pending-edit count. It still honours the
  lock, and it re-checks a missing executable.

## Measuring the real cost

The cost of an update on a large repository is not known up front. Let a few turns run, then read
`/graph`: the last run shows its duration, and `minIntervalMinutes` is the knob to trade freshness
for CPU. The same record is in the store under `last:<repo root>`.

## Concurrency lock

Before starting, the mod writes `lock:<repo root>` to the store with the session id and the start
time. Another session on the same checkout sees a live lock and skips its run. A lock is stale, and
ignored, once it is older than `timeoutSeconds`, and a lock left by this same session with no run of
this module instance behind it (a reload killed the child) is ignored at once. The lock is released
when the run ends and when the session ends. It is best effort: the store is read and then written,
so two sessions starting within the same moment can both run.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `command` | `graphify update .` | Split on whitespace into an argument vector; there is no shell and no quoting. |
| `minIntervalMinutes` | `5` | Minimum time between two run starts for the same repository. `0` disables the interval. |
| `timeoutSeconds` | `600` | A run is killed after this long and counts as a failure; also the age at which a lock is stale. Clamped to 10..3600. |
| `watchExtensions` | `php,ts,tsx,js,jsx,py,go,rs,java,rb,cs,vue` | Comma-separated, no dots. |

## Install

```
/plugin install graph-sync --marketplace <owner>/<repo>
```

## Development

```
claude plugin validate .
claude plugin test .
```

## Install

```
/plugin install graph-sync --marketplace mercynet/my-claude-mods
```
