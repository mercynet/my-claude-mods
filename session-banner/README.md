# session-banner

Claude Code mod: shows a plain-text logo above the prompt when a session starts. The logo is
painted with a left-to-right gradient, a subtle vertical sheen and one shimmer sweep, with a thin
gradient rule and a dim tagline under it. It disappears at your first prompt.

## When it shows

- **Once, at the start of each session** (a new process, or a resume). Never again by itself: not
  after a turn, not after another prompt, not on a timer.
- **It hides at the first prompt you send**, or after `lingerSeconds` when that is set.
- **`/banner` shows it again** (with the shimmer). It is the only way back, and it hides at the next
  prompt too.
- **During mod development a reload does not show it again**, because the "already shown" flag lives
  in the session state, which survives reloads. Use `/banner` to see your changes.
- It never draws in `-p` runs or the SDK (no surface, nobody looking), and a run like that does not use
  up the one showing.

## It does not depend on the project

It works the same in every folder you open, git repository or not. It runs no process, reads no
project file and asks for no project path. The only thing taken from the session is the default
tagline: the name of the session folder (empty at `/` or a drive root, or when the folder cannot be
read).

## The art file

Plain text, Unicode blocks (`█ ▀ ▄ ▌ ▐ ▘ ▝ ▖ ▗ ▚ ▞ ▛ ▜ ▙ ▟`) or anything width-1 you like. The color comes
from the mod; the file carries none. Any non-space character is ink.

The default location is `~/.claude/banner.txt`, in your home directory, so one file serves every
project. `artFile` accepts `~/...`, an absolute path, or a path relative to your home directory.
A missing or unreadable file makes the mod inert: no toast, no log line, no error.

Up to 64 rows and 512 columns, 64 KB. Rows are clipped to the band width; a band narrower than 60% of
the art, or shorter than the art, draws nothing rather than a mutilated logo. Under the art the mod adds
a rule row and a tagline row when there is room for them, and drops the tagline first, then the rule.

## Options

| Key | Default | Meaning |
|---|---|---|
| `artFile` | `~/.claude/banner.txt` | The art file (see above). |
| `colors` | `#1f6fb2,#52b6ec` | Gradient stops, left to right, 1 to 8 hex colors. A bad list restores the default. |
| `tagline` | empty | Text under the logo. Empty is the session folder name; `-` means none. |
| `lingerSeconds` | `0` | Seconds until it hides by itself. `0` means until the first prompt. |

`NO_COLOR` set to anything non-empty turns the colors and the shimmer off.

## Sharing the band with other mods

The band above the prompt is one slot that several mods draw into. The banner asks whatever sits
beneath it first and draws itself above that result, so another mod's band stays visible under the
logo. A mod that sits above the banner and draws without asking beneath it hides the banner (and
everything else beneath it): that is that mod's choice, not something this mod can change.

## Surfaces

The terminal draws the logo as a `Raster` (true color cells). Other surfaces that have the band (the
desktop app) draw the art as plain text in the first gradient color.

## Tests

```
claude plugin validate .
claude plugin test .
```

## Install

```
/plugin install session-banner --marketplace mercynet/my-claude-mods
```
