# lean-context

Claude Code mod that measures, and only once approved applies, a context cut: it removes the
sections you list from the project instruction file (`AGENTS.md` by default) while the current
branch has no active spec. The file on disk is never changed, so other agents that read it keep
working; the mod rewrites only the context Claude Code sends to the model.

## Configuration

All three fields are `userConfig` options (set them in the plugin config menu or under
`pluginConfigs` in settings).

| Key | Default | Meaning |
|---|---|---|
| `omittableSections` | empty | Level-2 (`##`) titles that may leave the context in lean mode, separated by `;`. A title may end in `\|bytes`, the size you expect, which enables the drift warning. Empty means the mod is inert. |
| `instructionFile` | `AGENTS.md` | Name of the instruction file the cut applies to (file name only). |
| `specsDir` | `specs/_active` | Project-relative folder whose subfolders are named after branches that have an active spec. Its parent folder must exist, otherwise the mod stays inert in that project. |

Example: `omittableSections` = `Section A|2500;Section B;Section C|7500`.

Invalid values (a `specsDir` with `..`, an `instructionFile` with a path in it) make the mod inert
and the panel says why. They never cut anything.

## Modes

| Mode | When | Effect |
|---|---|---|
| `full` | `<specsDir>/<branch>` exists for the current branch, or `/lean mode full` | context untouched |
| `lean` | no active spec and no override | the listed sections leave the instruction file |

The signal is the spec folder for the branch, never the prompt text, its size, or a model.

### Fail-open

Any doubt resolves to `full` and nothing is cut:

- `git` unavailable, failing, or a detached HEAD;
- an invalid branch name, or an unreadable `specsDir`;
- an instruction file with an unclosed code fence (the parser is not reliable then);
- instruction files of unknown origin (another hook rewrote the `claudeMd` block);
- a project without the configured specs folder (the mod is inert in other projects).

## What is cut

A deny-list of titles, never an allow-list. Each section runs from its `##` heading to the next
level 1 or 2 heading, ignoring lines inside code fences, so a section added to the file later never
disappears. One pointer line stays per section:

    [omitted in lean mode: AGENTS.md section X, ~N KB; read on demand]

A level-1 heading ends the cut, so anything that follows it survives. When a section's size differs
more than 30% from the `|bytes` you configured, the panel warns.

## Commands

- `/lean` shows mode, what would be cut, the estimated saving, history, A/B figures, verdict and context weight.
- `/lean apply` applies the cut to new conversations in lean mode; `/lean simulate` goes back. By default the mod only simulates: it records what it would cut and measures the real first request.
- `/lean mode full|lean|auto` forces the mode of this conversation, or returns to automatic.
- `/lean dismiss` refuses the proposal to apply the cut in this project (see below).
- `/lean reset` erases the history (the apply/simulate setting and refusals stay).

## Proposal to apply

While simulating, at the end of each turn of the main conversation the mod checks whether there is
enough evidence to suggest `/lean apply`: at least 3 lean conversations of this project with a
measured first request, and a cut worth 12% or more of that first request. When there is, it shows
one toast and one transcript line per conversation with the numbers. It never applies by itself.

`/lean dismiss` stores the refusal per project with the gain measured at that moment; the proposal
returns only if the gain grows by 5 percentage points.

## Escalating from lean to full mid-conversation

Context already sent is not rewritten (that would invalidate the cache). On the next `prompt.submit`
the mod adds, once, a reminder listing the omitted sections. A compaction rebuilds the context and
discards a pending reminder.

## Stored data

`$.store`: `settings` (apply/simulate), `history` (last 40 conversations: mode, sections, bytes
saved, measured first request, end of the first turn, weight per category/skills/MCP/memory, observed
order of `prompt.submit` and `prompt.context`), `diag` (last event). `$.state` (per session):
`override`, `active`.

## Install

```
/plugin install lean-context --marketplace mercynet/my-claude-mods
```
