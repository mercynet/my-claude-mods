# my-claude-mods

Personal [Claude Code](https://code.claude.com) mods: small plugins that hook into the session to
show state, guard against mistakes or keep tooling fresh. Each mod is a self-contained folder with
its own tests.

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add mercynet/my-claude-mods
/plugin install spec-band --marketplace mercynet/my-claude-mods
```

Requires a Claude Code version with mod support (2.1.275 or later).

## Mods

| Mod | What it does | Touches |
|---|---|---|
| [context-forecast](context-forecast) | Context window forecast, clear-or-compact score, usage limits, guided compaction | Observes the session; may ask for a model call only if topic detection is switched on |
| [lean-context](lean-context) | Measures, and once approved strips, configured sections of the project instruction file from the context sent to the model | Rewrites the context sent to the model; never edits files on disk; inert until configured |
| [spec-band](spec-band) | Band above the prompt with the branch's active spec: STATE age, phase, stale-STATE warning | Reads files; writes nothing |
| [env-doctor](env-doctor) | Read-only preflight of the dev environment, plus `/env` | Runs `docker compose` queries and reads files; fixes nothing |
| [graph-sync](graph-sync) | Refreshes a code knowledge graph in the background after edits | Spawns the configured update command (default `graphify update .`) in repos that already have `graphify-out/` |

User-facing strings are in Portuguese; code and docs are in English.

## Configuration

Mods with project-specific behaviour take their settings from `userConfig`, stored in your Claude
Code settings under `pluginConfigs.<mod>`. A mod with nothing configured does nothing rather than
guess: `lean-context` is inert until you list the sections to cut, `env-doctor` only runs the checks
that apply to the repository. Each mod's README lists its keys.

## Tests

```
claude plugin validate <mod>
claude plugin test <mod>
```
