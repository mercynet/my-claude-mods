# spec-band

A one-line band above the prompt for projects that keep a spec folder per branch.
It shows where the active spec stands, so the position survives a `/clear` and a
stale state file does not go unnoticed.

```
42 · tarefas 7/12 · STATE 3 min · fase B
```

| Segment | Source | Left out when |
|---|---|---|
| `42` | numeric prefix of the branch name, else the branch name cut to 24 characters | never |
| `tarefas 7/12` | markdown checkboxes (`- [ ]`, `- [x]`, any list marker) in the tasks file, fenced code ignored | the file is missing or holds no checkbox |
| `STATE 3 min` | modification time of the state file (`agora`, `N min`, `N h`, `N d`) | the file is missing or unreadable |
| `fase B` | `phase: A\|B\|C\|review` line (the last one wins), else a single `Phase X` in the text above the first `##` heading | none or several different phases are found |

## Stale state warning

Every successful `Edit`, `Write` or `MultiEdit` inside the project adds one to a counter. The
counter goes back to zero when the state file's modification time changes, or when the branch
changes. Once it reaches `staleAfterEdits` the band turns yellow and adds
`STATE.md sem atualizar há N edições`. Without a state file there is nothing to go stale, so
it never warns.

The band refreshes on session start, on each prompt, at the end of each turn and right after
an observed edit. There are no timers.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `specsDir` | `specs/_active` | Folder, relative to the project root, holding one subfolder per branch |
| `tasksFile` | `tasks.md` | Tasks file inside the branch's folder |
| `stateFile` | `STATE.md` | State file inside the branch's folder |
| `staleAfterEdits` | `15` | Edits without a state file change before the warning |

Folder and file names that are absolute or contain `..` fall back to the default.

## When the band is inert

It draws nothing, and never blocks or alters a tool call, when:

- the project is not a git repository, git is missing, or HEAD is detached;
- `specsDir` does not exist, or has no folder named after the current branch;
- reading the spec folder fails;
- a survey is on screen.

A failing read of the tasks or state file only drops that segment. The mod never writes a file.

## Development

```
claude plugin validate .
claude plugin test .
```

## Install

```
/plugin install spec-band --marketplace mercynet/my-claude-mods
```
