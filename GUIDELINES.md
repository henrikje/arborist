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

Arborist coordinates multi-repo operations (push, rebase, merge) and provides workspace-level overview (status, log). It does not replace Git for authoring operations. Committing, staging, interactive rebase, and PR creation belong to direct interaction with each repository. `arb exec` bridges the gap for anything Arborist doesn't cover.

### Do one thing and do it well

Each command has a clear, single purpose. Avoid adding flags or modes that expand a command's scope beyond its core question. When a use case falls outside a command's purpose, `arb exec` is the escape hatch — not a new flag.

### Filesystem as database

Arborist uses marker directories (`.arb/`, `.arbws/`), filesystem scanning, and git's own metadata instead of databases, registries, or config files. If something can be discovered from the directory tree or inferred from git state, Arborist does not store it. This makes state inspectable, debuggable, and impossible to corrupt through arb bugs alone. Prefer convention over configuration.

### One workspace, one branch

A workspace has exactly one shared branch and one optional base branch. All repos work on the same feature branch; the base branch is the workspace's integration target. Per-repo default branches and remotes can differ — they are discovered at runtime — but the feature branch and base are workspace-level concerns. This invariant enables wrong-branch detection, consistent sync operations, and workspace identity. Base branches resolve against local refs when the base branch is checked out in a linked worktree (i.e., a workspace exists for it), and against remote refs otherwise. Local resolution means the stacked workspace tracks the base workspace's actual state — ahead/behind counts update live when the base workspace commits, without requiring a fetch. Remote refs are still used for merge detection (squash merges happen upstream). See `decisions/0098-local-branch-base-resolution.md` (revisits `decisions/0089-branch-model-flexibility-analysis.md`).

### Minimal, semantic CLI

A command earns its place when it encapsulates domain knowledge (multi-repo coordination, fork workflows), provides safety gates (refuses risky operations, detects at-risk state), or renders data that isn't directly comparable. A command that wraps `rm`, `ls`, or `cp` on a plain-text file does not earn its place — the filesystem already provides that interface.

### Evaluating new operations

When a new operation is proposed — whether it becomes a command, a flag, a subcommand, or nothing at all — work through these questions in order.

**1. Coordination or authoring?** The authoring boundary (DR-0023) is the first gate. If the operation belongs to the developer's role as author — how they present their work — it belongs in `arb exec` or outside Arborist entirely. The commit-message problem is a useful tell: if any automated choice is likely wrong and will need manual correction, the operation is on the authoring side.

**2. New operation or variant of an existing one?** If the mechanism is fundamentally the same as an existing command applied differently, it is a variant and belongs as a flag on that command. Detection logic for the variant case typically lives in the parent command already — splitting it out would mean detection in one place and recovery in another.

**3. For variants — how rare?** An escape hatch invoked once per stack lifecycle or to recover from an unusual state is an optional flag. A frequent alternate mode deserves a more prominent option or its own subcommand.

**4. For new operations — is the coordination value substantial?** Does it need a plan/confirm flow, conflict prediction, an abort/continue state machine, or non-trivial per-repo assessment? Would `arb exec` leave users meaningfully worse off? Substantial value earns a dedicated command. Thin value earns an `arb exec` recipe in the docs.

**5. For new commands — weight determines placement.** Lightweight, noun-focused operations (show state, rename, simple mutations) go under a subcommand group (e.g. `arb branch show`, `arb branch rename`). Heavyweight operations with multi-phase workflows, conflict handling, or state machines go at the top level alongside `rebase`, `merge`, and `push`.

The underlying principle: a command earns its place when Arborist has meaningful knowledge to contribute that the user cannot easily replicate with `arb exec` — conflict prediction, divergence analysis, cross-repo state coordination, safe rollback. When that knowledge is absent or thin, the value is not there.

### Prefer correctness over backwards compatibility

Arborist is in pre-release. The priority is getting the design right — not preserving compatibility with earlier pre-release behavior. When a better approach is found, adopt it directly: rename commands, change defaults, restructure output. Breaking changes are expected and acceptable during this phase.

### Record significant decisions

When a feature or change involves weighing meaningful options, preserve the reasoning in a decision record. See ARCHITECTURE.md § Decision Records for the process and template.

---

## UX Guidelines

### Color semantics

- **Green**: success confirmation only — the final summary line ("Pushed 3 repos"). Used sparingly.
- **Yellow**: noteworthy or mildly risky — things that need attention or action. Unpushed commits, local changes, unexpected branches, skipped repos, operations with caveats.
- **Red**: errors or immediate risks — failed operations, at-risk workspaces, fatal messages.
- **Dim (gray)**: de-emphasized, supplementary — column headings, commit hashes, section labels.
- **Cyan**: interactive-tool alignment — used to match the accent color of `@inquirer` prompts, keeping arb output visually consistent with interactive selections.
- **Bold**: structural emphasis — section separators in `exec` (`==> repo <==`).
- **Default (no color)**: normal, expected content. Repo names, branch names, inline progress results, informational counts.

### Clear, descriptive output

Tell the user *what happened*, not just *that it happened*. Use descriptive per-repo outcomes: "pushed 3 commits", "rebased onto origin/main", "3 refs updated", "created", "detached", "up to date". When a repo is skipped, the reason is always stated ("diverged from origin", "uncommitted changes", "on branch X, expected Y") — the developer should never have to guess.

- **Summary lines.** Every multi-repo command ends with a single green summary line on stderr that aggregates counts ("Pushed 3 repos, 1 up to date, 2 skipped") via `finishSummary()` in `render/render.ts`. Do not use `success()` or `error()` for multi-item summary output.
- **Nothing to do.** When no items qualify for the operation, use `info()` with a verb-specific message (`Nothing to push`, `All repos up to date`). Never `warn()`, no trailing period.
- **State labels.** Synthetic state labels in table cells (`detached`, `no branch`, `gone`) are wrapped in parentheses to distinguish them from actual values.
- **Workspace-level refs.** When displaying workspace-level base or share refs (derived from per-repo data), prefer `configuredRef` over `ref` (show user's intent, not the fallback). Format as `remote/branch`.

### Command interaction patterns

**Membership-changing commands** (`attach`, `detach`, `create`, workspace selection in `delete`): accept `[repos...]` args. When none given and stdin is a TTY, show an interactive picker. Offer `-a, --all-repos` for scripting. Non-TTY without args is an error with usage guidance. Note: `detach`, `delete`, and `branch rename` follow the same five-phase plan flow as state-changing commands (assess → plan → confirm → execute → summarize). Only `create` (guided flow with parameter-echo pattern) and `attach` (simple execute-report) are structurally different.

**State-changing commands** (`push`, `pull`, `rebase`, `merge`, `reset`, `retarget`): accept optional `[repos...]` to narrow scope; default to all repos. Follow the five-phase workflow: assess → plan → confirm → execute → summarize. Each defines a typed assessment interface classifying repos into will-operate / up-to-date / skip-with-reason.

**Overview commands** (`status`, `log`) are read-only. They scope to the feature branch via base branch resolution, skip detached/drifted repos with explanation, and support `[repos...]` filtering, `--json`, and `--verbose`.

### Expected flags per command category

When adding a new command to a category, verify it carries all expected flags. Exceptions need a documented reason (e.g. `pull` omitting `--no-fetch` because it inherently fetches).

**Sync commands** (`push`, `pull`, `rebase`, `merge`, `reset`, `retarget`):

| Flag | Purpose |
|------|---------|
| `--fetch` / `--no-fetch` (`-N`) | Control pre-fetch (default: fetch) |
| `--yes` (`-y`) | Skip confirmation prompt |
| `--dry-run` | Show plan without executing |
| `--verbose` (`-v`) | Show commits in the plan |
| `--include-wrong-branch` | Include repos on a different branch |
| `--where` (`-w`) | Filter repos by status flags |

Individual sync commands add domain-specific flags (`--force`, `--autostash`, `--graph`, `--base`, etc.) as needed. `pull` always fetches and does not offer `--no-fetch`. `retarget` always operates on all repos — it does not accept `[repos...]` or `--where`. `--verbose` shows commit subjects in the plan; the label describes direction (e.g., "Outgoing to remote:", "Resetting:"). Orthogonal to `--graph` — both can combine. See `decisions/0040-branch-divergence-graph.md`.

**Membership commands** (`attach`, `detach`, `create`, workspace selection in `delete`):

| Flag | Purpose |
|------|---------|
| `[repos...]` | Positional repo selection |
| `--all-repos` (`-a`) | Select all repos (scripting) |
| Interactive picker | When no args and TTY |

**Overview commands** (`status`, `log`):

| Flag | Purpose |
|------|---------|
| `[repos...]` | Positional repo selection |
| `--json` / `--schema` | Structured output to stdout |
| `--verbose` (`-v`) | Extended detail |
| `--where` (`-w`) | Filter repos by status flags |
| `--dirty` (`-d`) | Shorthand for `--where dirty` |

### Command groups for subsystems

When multiple operations manage the same `.arb/` subsystem (repos, templates), group them under a singular noun (`repo`, `template`) with subcommands. Each command group designates a read-only subcommand as the default — the subcommand that runs when the group name is invoked bare. The default is always an inspection subcommand (`list` or `show`), never a mutation.

### Fetch behavior

**Sync commands** (`push`, `rebase`, `merge`), **dashboard commands** (`status`, `list`), **membership commands** (`attach`, `create`, `detach`), and **plan commands** (`delete`) fetch by default. **`branch show`** fetches by default in verbose mode only. `-N, --no-fetch` skips the pre-fetch when refs are fresh. Dashboard commands use phased rendering for instant feedback. Short-option assignments: `-N` → `--no-fetch` (common action), `-f` → `--force` (conventional), `--fetch` has no short option (infrequent — fetch is the default).

**`pull`** always fetches — it inherently needs fresh remote state to assess what to pull. It does not offer `--no-fetch`.

**`log`** does not fetch by default — stale content is less confusing. `--fetch` opts in.

The `ARB_NO_FETCH` environment variable globally suppresses automatic fetching — equivalent to passing `-N` to every command. Explicit `--fetch` overrides it. `pull` is unaffected (it always fetches). See `decisions/0045-universal-fetch-flags.md` and `decisions/0087-arb-no-fetch-env-var.md`.

### Network timeouts

All git operations that contact the network (fetch, push, pull, clone) must have a timeout to prevent indefinite hangs. Use `gitNetwork()` from `src/lib/git/git.ts` for individual network calls, or `parallelFetch()` for batch fetches (which uses `gitNetwork()` internally with a shared global deadline). Local git operations use `gitLocal()`, which has its own timeout (default 5s, `ARB_GIT_TIMEOUT` env var) to protect against cloud-synced filesystems blocking on undownloaded files.

Timeout values follow a resolution hierarchy: operation-specific env var → `ARB_NETWORK_TIMEOUT` → built-in default. Use `networkTimeout(specificVar, defaultSeconds)` to resolve. Current defaults: fetch 120s, push 120s, pull 120s, clone 300s. Exit code 124 indicates timeout (matching Unix `timeout` convention).

### Progress feedback

**Sequential commands** (push, pull, rebase, merge, detach, attach): in TTY mode, write `  [repo] verb...` as progress, then replace the line with `  [repo] <descriptive result>` on completion. Non-TTY: skip progress, write only results. `exec` uses `==> repo <==` section headers instead (supports interactive content).

**Fetch-then-display commands** (status, list): use phased rendering to show stale data instantly while the fetch runs, then replace with fresh data. See ARCHITECTURE.md for technical details.

### TTY-aware behavior

Colors, progress indicators, and interactive prompts only appear when stderr is connected to a terminal. In non-TTY contexts (pipes, CI), output is plain text and confirmation prompts require `--yes`.

Color output is additionally disabled when the `NO_COLOR` environment variable is set (any value, including empty — per the no-color.org convention) or when `TERM=dumb`. The `shouldColor()` function in `tty.ts` encapsulates this logic. Use `shouldColor()` for color decisions and `isTTY()` for interactive features (prompts, cursor control, progress indicators).

### Adaptive table output

Column *visibility* is driven by data, not terminal width. A column is hidden when its data is redundant across all rows (e.g., all repos share the same base ref) — never because the terminal is too narrow. When a column is hidden, its shared value appears in the parenthetical header note so no information is lost. Column *values* are truncated to fit the terminal width. Truncatable columns declare a minimum width; the renderer distributes overflow reduction across them, preserving remote prefixes (`origin/` + 3 chars + ellipsis). When terminal width is unknown, no truncation is applied. See `decisions/0092`.

### Repo specification: positional vs option

When repos are the command's primary target, they are positional arguments (`arb push [repos...]`). When the positional is consumed by another argument, repos become `--repo <name>` (repeatable). Examples: `arb exec <command...>` (positional consumed by command), `arb template diff [file] --repo <name>`.

### Status-based filtering: `--where` and `--dirty`

`--where` (`-w`) filters repos by `RepoFlags`. Supported on every command that gathers workspace status: `status`, `log`, `exec`, `open`, `list`, `delete`, `push`, `pull`, `rebase`, `merge`, `reset`. Commands that don't gather status (e.g. `attach`, `create`, `branch rename`) do not get `--where`.

`--dirty` (`-d`) is a shorthand for `--where dirty`, mutually exclusive with `--where`. Only offered where "dirty" is a natural filter: `status`, `log`, `exec`, `open`, `list`. Omitted from sync commands and `delete`.

Filter terms are organized by orthogonal dimension (see ARCHITECTURE.md). Positional terms use the `<position>-<axis>` pattern (`ahead-share`, `behind-base`) so axis relationships are obvious. Filter names describe state, not suggested action — whether a repo "needs rebase" depends on the user's intent; the filter just says `behind-base`. Named positive terms exist only where they provide non-trivial composition (`pushed` = `^ahead-share+^no-share`) or are natural vocabulary (`clean`, `safe`); trivially-derivable positives use `^` negation instead (`^behind-base` rather than a named `synced-base`).

All commands use `resolveWhereFilter()` from `status.ts` for validation. Follow the existing pattern when adding `--where` to a new command.

### Quiet output and stdin piping

`--quiet` / `-q` outputs one primary identifier per line to stdout — no headers, no ANSI, no trailing whitespace. Supported on `list`, `status`, `repo list`. Conflicts with `--json` and `--verbose`.

Commands accepting positional `[repos...]` also accept names from stdin when piped. Positional args take precedence, then stdin, then default (all). Commands that inherit stdin (`exec`, `open`) are excluded.

### Short flag allocation

Short flags carry consistent meaning across the CLI. Before assigning a short flag to a new option, check this table — reusing a letter with different semantics creates muscle-memory traps.

| Short | Long form | Scope |
|-------|-----------|-------|
| `-a` | `--all-repos` | Membership commands |
| `-a` | `--all-safe` | `delete` only (workspace-level, not repo-level) |
| `-b` | `--branch` | `create` |
| `-d` | `--dirty` | Overview and execution commands |
| `-f` | `--force` | Per-command safety override |
| `-g` | `--graph` | `rebase`, `merge`, `retarget` |
| `-n` | `--max-count` | `log` only (mirrors `git log -n`) |
| `-N` | `--no-fetch` | All commands with fetch behavior |
| `-p` | `--parallel` | `exec` |
| `-q` | `--quiet` | `status`, `list`, `repo list`, `branch show` |
| `-r` | `--delete-remote` | `delete`, `rename`, `branch rename` |
| `-v` | `--verbose` | Sync commands, overview commands, `branch show` |
| `-w` | `--where` | All commands with status-based filtering |
| `-y` | `--yes` | All mutation commands |

The `-a` overload is intentional: it distinguishes repo-level (`--all-repos`) from workspace-level (`--all-safe`) selection. `-n` is reserved for `git log`'s `--max-count` convention; `--dry-run` is long-only. Avoid adding new overloads — if a letter is taken, leave the new option long-only.

### Error recovery guidance

Recovery depends on whether failures are independent or systemic.

**Conflicts** (rebase, merge, pull): repos are independent — arb continues processing all, then prints a consolidated conflict report with per-repo resolution instructions. Summary uses yellow. Exit 1.

**Unexpected failures** (push): often systemic (auth, server errors). Arb stops at first failure, prints git's error output, and tells the user to investigate and re-run.

### Error message guidelines

Error messages should tell the user what went wrong. Add recovery guidance only when the next step is **non-obvious** — when the root cause is ambiguous, the recovery involves unfamiliar commands or flags, or the system is in a state the user wouldn't expect.

Do not add hints for routine situations a competent CLI user can figure out (e.g. "workspace not found" does not need "run `arb list`"). Reserve hints for:
- **Ambiguous failures** — when the message alone doesn't explain *why* (e.g. git network errors that could be auth, connectivity, or a bad URL).
- **Non-obvious recovery** — when the fix involves flags or commands the user may not know exist (e.g. `--continue`, `--abort`, `--force`).
- **Unexpected state** — when the system is in a state that shouldn't normally occur (e.g. missing remotes, corrupted worktree refs).
- **Domain-specific jargon** — when the error uses terms the user may not understand (e.g. "template drift").

The `error()` call (stderr) carries the full message. The `ArbError` message should be self-contained — in non-TTY or piped contexts it may be the only thing the user sees.

For network/git failures, use `classifyNetworkError()` from `src/lib/sync/network-errors.ts` to distinguish auth, connectivity, and URL problems. The push command is the reference implementation.

### Table spacing convention

**Plan commands** (state-changing: `rebase`, `merge`, `push`, `pull`, `delete`, `branch rename`): blank line before and after the table. The blank lines separate the plan from fetch output above and the confirmation prompt below.

**Overview commands** (read-only: `status`, `list`, `branch`, `repo list`, `template list`): minimize vertical padding. Blank lines appear only for structural clarity between distinct elements (e.g., a context header and the table body).

### Documentation: help is reference, README is tutorial

`--help` is the authoritative reference — every option, argument, and behavioral detail. Keep descriptions concise but complete. The README walks through workflows and explains the mental model, linking to `arb help <command>` for details.
