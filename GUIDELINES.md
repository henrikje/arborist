# GUIDELINES.md

Design principles, UX conventions, and architectural patterns that govern the Arborist codebase. Each guideline explains *why* things work the way they do so new code stays consistent with existing code.

---

## Design Philosophy

### Safe and simple parallel multi-repo development

Everything in Arborist exists to let a developer work on multiple features across several repositories in parallel without losing or corrupting work. When a choice exists between power and safety, safety wins.

### Align with Git and good CLI practice

Commands, flags, and terminology mirror Git wherever possible. A developer who knows Git should feel at home immediately. Arborist is a thin coordination layer on top of Git worktrees, not a replacement for Git.

### Visibility and control are everything

Arborist operates across many repositories, so clarity is non-negotiable. The developer must always have a complete, honest view of the workspace — what changed, what drifted, what is at risk — and nothing mutates without explicit approval. The user is never left guessing about the current state or the consequences of an action. Features such as a fast, information-dense, and scannable `arb status`, along with preview–confirm–execute workflows for state changes, are expressions of this principle: visibility first, control always in the developer's hands.

### Convention over configuration

Arborist uses marker directories (`.arb/`, `.arbws/`) and filesystem scanning instead of databases, registries, or config files beyond what's needed. If something can be discovered from the directory tree, it should be.

---

## UX Guidelines

### Color semantics

- **Green**: success confirmation only — the final summary line ("Pushed 3 repos"), staged changes in status. Used very sparingly.
- **Yellow**: noteworthy or mildly risky — things that need attention or action. Unpushed commits, local changes, unexpected branches, skipped repos, unstaged/untracked files, operations with caveats.
- **Red**: errors or immediate risks — failed operations, at-risk workspaces, fatal messages.
- **Dim (gray)**: de-emphasized, supplementary information — column headings, commit hashes, section labels in expanded views.
- **Bold**: structural emphasis — section separators in `exec` (`==> repo <==`).
- **Default (no color)**: normal, expected content. Repo names, branch names, inline progress results, informational counts ("up to date", "3 refs updated"). The baseline.

### Descriptive outcomes, not just status

Tell the user *what happened*, not just *that it happened*. Instead of a generic "ok", describe the practical outcome so the user understands the result without investigating further.

- Push/pull: include the commit count from the assessment — "pushed 3 commits", "pulled 2 commits".
- Rebase/merge: past-tense of the action — "rebased onto origin/main", "merged onto origin/main".
- Add/create (worktrees): past-tense — "created".
- Drop: past-tense — "removed", "branch deleted".
- Fetch: describe what changed — "3 refs updated" or "up to date".

### Membership-changing commands

Scope: `add`, `drop`, `create` (and workspace selection in `remove`).

Accept `[repos...]` args. When none given and stdin is a TTY, show an interactive picker. Offer `-a, --all-repos` for scripting. Non-TTY without args is an error with usage guidance.

### State-changing commands

Scope: `push`, `pull`, `rebase`, `merge`.

Accept optional `[repos...]` to narrow scope; default to all repos in the workspace. Follow the five-phase workflow: assess → plan → confirm → execute → summarize. Each defines a typed assessment interface (e.g. `PushAssessment`) classifying repos into will-operate / up-to-date / skip-with-reason. This separates decision-making from execution and makes the plan display trivial.

### Command groups for `.arb/` subsystems

When multiple operations manage the same `.arb/` subsystem (repos, templates), group them under a singular noun (`repo`, `template`) with subcommands. The parent command shows help when invoked without a subcommand. Each subcommand has its own summary, description, options, and action. This keeps the top-level command list focused on workflows while grouping management operations by the resource they act on.

### Safety gates for destructive operations

When an operation would cause data loss, Arborist refuses and explains why. The `remove` command detects at-risk workspaces (unpushed commits, uncommitted changes) and will not delete them without `--force`. Use `--yes` to skip the confirmation prompt without overriding safety checks. The plan display always shows what's at risk and why, so the developer can make an informed decision.

### TTY-aware behavior

Colors, progress indicators, and interactive prompts only appear when stderr is connected to a terminal. In non-TTY contexts (pipes, CI), output is plain text and confirmation prompts require `--yes` to proceed. The `output.ts` module wraps all color formatting through a `isTTY()` guard, and commands check `isTTY()` before launching interactive prompts.

### Inline progress with line replacement

Scope: all sequential multi-repo commands that suppress git output (push, pull, rebase, merge, drop, add/create worktrees).

In TTY mode: write `  [repo] verb...` as a progress indicator, then on completion use `\r` + ANSI clear to replace the entire line with `  [repo] <descriptive result>`. In non-TTY mode: skip the progress line, write only the result line. Result uses default color (not green) — green is reserved for the final summary line.

`exec` intentionally uses `==> repo <==` section headers instead because it supports interactive content (inherited stdin/stdout/stderr). Parallel operations (fetch) don't use this pattern — they show an aggregate counter during work, then per-repo results after completion.

### Summary line after operations

Every multi-repo command ends with a single green line on stderr that aggregates counts, like "Pushed 3 repos, 1 up to date, 2 skipped". This gives instant confirmation of what happened without scrolling.

### Helpful skip reasons

When a repo is skipped during the plan phase, the reason is always stated. Examples: "diverged from origin (use --force)", "uncommitted changes", "local repo", "not pushed yet", "on branch X, expected Y". The developer should never have to guess why a repo was excluded.

### Error recovery guidance

Scope: all state-changing commands (push, pull, rebase, merge).

The recovery pattern depends on whether failures are **independent and mechanical** or **systemic and investigative**.

**Conflicts (rebase, merge, pull):** Repos are fully independent — a conflict in repo-a has no effect on repo-b. Recovery is always the same mechanical process: resolve conflicts, then `--continue` or `--abort`. So arb continues processing all repos, then prints a consolidated conflict report with per-repo resolution instructions. The summary line uses yellow (needs attention, not an error). Exit 1.

**Unexpected failures (push):** Post-assessment push failures are genuinely unexpected (auth errors, server errors, branch protection). They are often systemic — if one repo fails due to auth, the rest likely will too. Recovery depends on the specific error, not a fixed procedure. So arb stops at the first failure, prints git's error output for diagnosis, and tells the user to investigate and re-run.

In both cases, the developer is never left stranded — arb always shows what happened and what to do next.

### Repo specification: positional vs option

When repos are the command's primary target, they are positional arguments (`arb push [repos...]`). When the positional is consumed by another primary argument (a command, a file path), repos become a secondary filter via the `--repo <name>` option, which can be specified multiple times. Examples: `arb exec <command...>` runs in all repos (positional consumed by command), `arb template diff [file] --repo <name>` filters by repo (positional consumed by file path).

### Documentation: help is reference, README is tutorial

The `--help` output for each command is the authoritative reference. It should document every option, argument, and behavioral detail a user needs. Keep descriptions concise but complete.

The README is a tutorial. It walks through workflows with examples and explains the mental model. It does not need to cover every option or every command — it focuses on the bigger picture and links to `arb help <command>` for details.

---

## Architectural Patterns

### Command registration with lazy context

Each command lives in its own file under `src/commands/` and exports a `register*Command(program, getCtx)` function. The `getCtx` callback lazily resolves `ArbContext` (base dir, repos dir, current workspace) only when the command's action handler actually runs. This means commands like `init` and `help` never need a valid arb root.

### Shared library composition

Commands compose small, focused library functions rather than inheriting from base classes. Git helpers, repo selection, workspace context, parallel fetch, and output formatting are all independent modules. The `integrate.ts` module demonstrates how to parameterize shared logic: rebase and merge share the exact same five-phase flow, differing only in the git subcommand and the verb strings.

### Parallel fetch, sequential mutations

Network I/O (fetching from remotes) runs in parallel for speed, with a configurable timeout. State-changing git operations (push, pull, rebase, merge) run sequentially, one repo at a time. This gives predictable ordering, clear error messages, and the ability to stop on first failure with actionable recovery instructions.

### Output separation: stderr for UX, stdout for data

All human-facing output (progress lines, prompts, summaries, errors) goes to stderr. Only machine-parseable data goes to stdout. This enables piping arb output to other tools. The `output.ts` module enforces this by providing `success`/`info`/`warn`/`error` helpers that write to stderr and a separate `stdout` helper for data.

### Context validation guards

`requireWorkspace()` and `requireBranch()` validate that the developer is inside a workspace with a configured branch, exiting early with a helpful message if not. Commands call these at the top of their action handler so failures happen before any work is done, not halfway through an operation.

### Filesystem as database

Arborist maintains no state files beyond the `.arb/` marker directory, `.arbws/config` in each workspace, and git's own metadata. Workspaces are discovered by scanning for directories containing `.arbws`. Repos are discovered by scanning `.arb/repos/` for directories containing `.git`. This makes the state inspectable, debuggable, and impossible to corrupt through arb bugs alone.

### Mutating commands fetch by default, read-only commands do not

State-changing commands (`pull`, `push`, `rebase`, `merge`) automatically fetch from all remotes before assessing the workspace. This ensures operations are based on the latest remote state, preventing mistakes like rebasing onto a stale base branch. Use `--no-fetch` to skip when refs are known to be fresh.

Read-only commands (`status`, `list`) do not fetch by default to stay fast for frequent use. Both support `--fetch` to opt in when fresh remote data is needed.

The parallel pre-fetch also serves a performance purpose: `parallelFetch()` fetches all repos concurrently, while the subsequent mutation operations (pull, push, rebase, merge) run sequentially one repo at a time. Batching the network I/O upfront avoids per-repo fetch latency during the sequential phase.

### Canonical status model

`status.ts` defines Arborist's view of reality for repository state. The `RepoStatus` type is a 5-section model (identity, local, base, share, operation) that captures everything git tells us about a repo. `RepoFlags` computes independent boolean flags from that model. Named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) group flags by concern. Shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`, `flagLabels`) derive decisions and display text from those flags and sets.

**Terminology: remote roles vs status sections.** The two remote roles are `upstream` (integration) and `share` (sharing), defined in `RepoRemotes`. The corresponding status sections are `base` and `share` in `RepoStatus`. The user-facing column headers are `BASE` and `SHARE`. Flag labels are `behind base` and `behind share`. When writing code or documentation, use `upstream`/`share` for git remote names, `base`/`share` for status model sections.

**This model is the single source of truth.** Every command that needs to understand repo state — whether for display, filtering, safety checks, or operational decisions — must work from `RepoStatus` and `RepoFlags`. Do not invent local status representations, ad-hoc dirty checks, or one-off git queries that duplicate what the model already captures. If a command needs information that the model doesn't provide, extend the model in `status.ts` so every consumer benefits.

**Extend, don't fork.** When adding a new concept (e.g. a new kind of issue, a new git state to detect):
1. Add the observation to `RepoStatus` if it's raw git state.
2. Add a flag to `RepoFlags` if it represents a condition that needs attention.
3. Add the flag to `computeFlags()` and the label to `FLAG_LABELS`.
4. All existing consumers (status display, list aggregation, remove safety checks, etc.) automatically pick it up through `isAtRisk()` and `flagLabels()`.

**Rendering and derived decisions should be centralized.** Functions like `isAtRisk()` (used for filtering and aggregate counts) and `flagLabels()` (used for summary lines in both `status` and `list`) exist so that the same logic governs every place a repo's state is evaluated. Commands should call these shared functions rather than re-deriving the same conclusions from raw fields.

### Repo classification: local vs remote

`classifyRepos()` separates repos into those with remotes and local-only repos. Commands that interact with remotes (fetch, pull, integrate) use this to gracefully skip local repos with a reason. This allows mixed local/remote workspaces.
