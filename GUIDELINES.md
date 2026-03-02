# GUIDELINES.md

Design principles and UX conventions that govern the Arborist codebase. Each guideline explains *why* things work the way they do so new code stays consistent.

---

## Design Philosophy

### Safe and simple parallel multi-repo development

Everything in Arborist exists to let a developer work on multiple features across several repositories in parallel without losing or corrupting work. When a choice exists between power and safety, safety wins.

### Align with Git and good CLI practice

Commands, flags, and terminology mirror Git wherever possible. A developer who knows Git should feel at home immediately. Arborist is a thin coordination layer on top of Git worktrees, not a replacement for Git.

### Visibility, safety, and protection

The developer must always have a complete, honest view of the workspace — what changed, what drifted, what is at risk — and nothing mutates without explicit approval. When an operation would cause data loss, Arborist refuses and explains why. The plan display always shows what's at risk so the developer can make an informed decision. Option `--yes` skips the confirmation prompt; `--force` overrides safety checks — never combine their semantics into a single flag.

### Detect, warn, and protect

Beyond showing honest state, Arborist actively watches for conditions that signal trouble and responds before they cause harm: refusing to remove workspaces with unpushed commits, detecting merged base branches, warning on unexpected branch drift, providing per-repo conflict recovery instead of stopping at the first failure. When implementing a new command, ask "what can go wrong that I should detect?" — proactive detection is a first-class concern.

### Coordination and overview, not authoring

Arborist coordinates multi-repo operations (push, rebase, merge) and provides workspace-level overview (status, log, diff). It does not replace Git for authoring operations. Committing, staging, interactive rebase, and PR creation belong to direct interaction with each repository. `arb exec` bridges the gap for anything Arborist doesn't cover.

### Do one thing and do it well

Each command has a clear, single purpose. Avoid adding flags or modes that expand a command's scope beyond its core question. When a use case falls outside a command's purpose, `arb exec` is the escape hatch — not a new flag.

### Filesystem as database

Arborist uses marker directories (`.arb/`, `.arbws/`), filesystem scanning, and git's own metadata instead of databases, registries, or config files. If something can be discovered from the directory tree or inferred from git state, Arborist does not store it. This makes state inspectable, debuggable, and impossible to corrupt through arb bugs alone. Prefer convention over configuration.

### Minimal, semantic CLI

A command earns its place when it encapsulates domain knowledge (multi-repo coordination, fork workflows), provides safety gates (refuses risky operations, detects at-risk state), or renders data that isn't directly comparable. A command that wraps `rm`, `ls`, or `cp` on a plain-text file does not earn its place — the filesystem already provides that interface.

### Prefer correctness over backwards compatibility

Arborist is in pre-release. The priority is getting the design right — not preserving compatibility with earlier pre-release behavior. When a better approach is found, adopt it directly: rename commands, change defaults, restructure output. Breaking changes are expected and acceptable during this phase.

### Record significant decisions

When a feature or change involves weighing meaningful options, preserve the reasoning in a decision record. See ARCHITECTURE.md § Decision Records for the process and template.

---

## UX Guidelines

### Color semantics

- **Green**: success confirmation only — the final summary line ("Pushed 3 repos"). Used sparingly.
- **Yellow**: noteworthy or mildly risky — this that need attention or action. Unpushed commits, local changes, unexpected branches, skipped repos, operations with caveats.
- **Red**: errors or immediate risks — failed operations, at-risk workspaces, fatal messages.
- **Dim (gray)**: de-emphasized, supplementary — column headings, commit hashes, section labels.
- **Bold**: structural emphasis — section separators in `exec` (`==> repo <==`).
- **Default (no color)**: normal, expected content. Repo names, branch names, inline progress results, informational counts.

### Clear, descriptive output

Tell the user *what happened*, not just *that it happened*. Use descriptive per-repo outcomes: "pushed 3 commits", "rebased onto origin/main", "3 refs updated", "created", "detached", "up to date". Every multi-repo command ends with a single green summary line on stderr that aggregates counts ("Pushed 3 repos, 1 up to date, 2 skipped"). When a repo is skipped, the reason is always stated ("diverged from origin", "uncommitted changes", "on branch X, expected Y") — the developer should never have to guess.

### Command interaction patterns

**Membership-changing commands** (`attach`, `detach`, `create`, workspace selection in `delete`): accept `[repos...]` args. When none given and stdin is a TTY, show an interactive picker. Offer `-a, --all-repos` for scripting. Non-TTY without args is an error with usage guidance.

**State-changing commands** (`push`, `pull`, `rebase`, `merge`): accept optional `[repos...]` to narrow scope; default to all repos. Follow the five-phase workflow: assess → plan → confirm → execute → summarize. Each defines a typed assessment interface classifying repos into will-operate / up-to-date / skip-with-reason.

**Overview commands** (`status`, `log`, `diff`) are read-only. They scope to the feature branch via base branch resolution, skip detached/drifted repos with explanation, and support `[repos...]` filtering, `--json`, and `--verbose`.

### Command groups for subsystems

When multiple operations manage the same `.arb/` subsystem (repos, templates), group them under a singular noun (`repo`, `template`) with subcommands. Each command group designates a read-only subcommand as the default — the subcommand that runs when the group name is invoked bare. The default is always an inspection subcommand (`list` or `show`), never a mutation.

### Fetch behavior

**Sync commands** (`push`, `rebase`, `merge`) and **dashboard commands** (`status`, `list`) fetch by default. `-N, --no-fetch` skips the pre-fetch when refs are fresh. Dashboard commands use phased rendering for instant feedback. Short-option assignments: `-N` → `--no-fetch` (common action), `-f` → `--force` (conventional), `--fetch` has no short option (infrequent — fetch is the default).

**Content commands** (`log`, `diff`) do not fetch by default — stale content is less confusing. `--fetch` opts in.

See `decisions/0045-universal-fetch-flags.md`.

### Progress feedback

**Sequential commands** (push, pull, rebase, merge, detach, attach): in TTY mode, write `  [repo] verb...` as progress, then replace the line with `  [repo] <descriptive result>` on completion. Non-TTY: skip progress, write only results. `exec` uses `==> repo <==` section headers instead (supports interactive content).

**Fetch-then-display commands** (status, list): use phased rendering to show stale data instantly while the fetch runs, then replace with fresh data. See ARCHITECTURE.md for technical details.

### TTY-aware behavior

Colors, progress indicators, and interactive prompts only appear when stderr is connected to a terminal. In non-TTY contexts (pipes, CI), output is plain text and confirmation prompts require `--yes`. The `output.ts` module wraps all color formatting through `isTTY()`.

### Repo specification: positional vs option

When repos are the command's primary target, they are positional arguments (`arb push [repos...]`). When the positional is consumed by another argument, repos become `--repo <name>` (repeatable). Examples: `arb exec <command...>` (positional consumed by command), `arb template diff [file] --repo <name>`.

### Status-based filtering: `--where` and `--dirty`

`--where` (`-w`) filters repos by `RepoFlags`. Supported on every command that gathers workspace status: `status`, `diff`, `log`, `exec`, `open`, `list`, `delete`, `push`, `pull`, `rebase`, `merge`. Commands that don't gather status (e.g. `attach`, `create`, `branch rename`) do not get `--where`.

`--dirty` (`-d`) is a shorthand for `--where dirty`, mutually exclusive with `--where`. Only offered where "dirty" is a natural filter: `status`, `diff`, `log`, `exec`, `open`, `list`. Omitted from sync commands and `delete`.

All commands use `resolveWhereFilter()` from `status.ts` for validation. Follow the existing pattern when adding `--where` to a new command.

### Quiet output and stdin piping

`--quiet` / `-q` outputs one primary identifier per line to stdout — no headers, no ANSI, no trailing whitespace. Supported on `list`, `status`, `repo list`. Conflicts with `--json` and `--verbose`.

Commands accepting positional `[repos...]` also accept names from stdin when piped. Positional args take precedence, then stdin, then default (all). Commands that inherit stdin (`exec`, `open`) are excluded.

### Error recovery guidance

Recovery depends on whether failures are independent or systemic.

**Conflicts** (rebase, merge, pull): repos are independent — arb continues processing all, then prints a consolidated conflict report with per-repo resolution instructions. Summary uses yellow. Exit 1.

**Unexpected failures** (push): often systemic (auth, server errors). Arb stops at first failure, prints git's error output, and tells the user to investigate and re-run.

### Table spacing convention

**Plan commands** (state-changing: `rebase`, `merge`, `push`, `pull`, `delete`, `rebranch`, `clean`): blank line before and after the table. The blank lines separate the plan from fetch output above and the confirmation prompt below.

**Overview commands** (read-only: `status`, `list`, `branch`, `repo list`, `template list`): no surrounding blank lines. The table is the entire output; extra padding wastes screen real estate.

### Documentation: help is reference, README is tutorial

`--help` is the authoritative reference — every option, argument, and behavioral detail. Keep descriptions concise but complete. The README walks through workflows and explains the mental model, linking to `arb help <command>` for details.
