# env-doctor

Claude Code mod: a read-only preflight of the development environment. It runs once
when a session starts, in the background, and again on demand with `/env`.

It never fixes anything. It reports what is wrong and prints the command that would
fix it, nothing more.

## What you see

- Everything fine: the status line entry is cleared and no toast is shown.
- Something wrong: the status line shows `env: 1 falha, 2 avisos` and one toast names
  the worst item (a failure before a warning).
- `/env`: one line per check, always fresh, each as `[ok]`, `[warn]`, `[fail]` or `[skip]`,
  then the reason and, when there is one, `correção: <command>`. UI text is in Portuguese.

## Checks

| Check | When it applies | Result |
|---|---|---|
| `compose` | `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` or `compose.yaml` in the repository root | `warn` listing declared services that are not running, fix `docker compose up -d <services>`. Docker missing, daemon unreachable, permission denied or a timeout is `skip` with that reason, never a failure. |
| `node-deps` | `.mcp.json` and `package.json` in the root | `fail` when `node_modules` is missing and some MCP server runs a node script (`node`, `tsx`, `ts-node`, `bun`, `deno`); fix is `npm install`, or `pnpm install`, `yarn install` or `bun install` by lockfile. Skipped when no server runs node, or when either file is absent. An unparsable `.mcp.json` still fails. |
| `empty-files` | `emptyFiles` option is set | `warn` for a file that is empty, nearly empty, or holds an empty `routes` collection; fix is `rm <path>`. |
| `required-paths` | `requiredPaths` option is set | `warn` for each path that does not exist. |

The repository root is `git rev-parse --show-toplevel`, falling back to the session root.

### What `empty-files` can and cannot tell

A file is flagged when any of these holds: zero bytes; less than 128 characters of
content once whitespace is trimmed; or a `routes` key assigned an empty array
(`'routes' => array ()`, `'routes' => []`, `"routes": []`). Files above 64 KiB are never
read, so a large file is only ever judged by being zero bytes. The `routes` signature is
the only content-based one: there is no general way to know that an arbitrary cache file
was written without data, so a file that is empty in some other way is not detected.

## Options

| Key | Default | Meaning |
|---|---|---|
| `emptyFiles` | empty (check off) | Comma-separated repository-relative paths for the `empty-files` check. |
| `requiredPaths` | empty (check off) | Comma-separated repository-relative paths that must exist. |
| `ignoreServices` | empty | Compose services that need not be running (one-shot jobs). |

Absolute paths and paths with `..` are never read: they are reported and ignored.

## Budget and failure handling

Checks run in parallel and share one budget of 8 seconds. A check that has not answered
by then is reported as `[skip] ... sem resposta em 8s`. A check that throws becomes a
skipped result. The session-start preflight is scheduled after startup, so it never delays
the first prompt, and any error there goes to the debug log only.

## What it never does

- Write, delete, move or create any file, or change any setting.
- Start, stop or restart containers, install packages, or run anything but
  `git rev-parse --show-toplevel`, `docker compose config --services` and
  `docker compose ps --services --status running`.
- Read outside the repository, or read a file above 64 KiB.
- Send anything over the network.

## Tests

```
claude plugin validate .
claude plugin test .
```

## Install

```
/plugin install env-doctor --marketplace mercynet/my-claude-mods
```
