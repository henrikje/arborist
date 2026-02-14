# GUIDELINES.md

Design principles, UX conventions, and architectural patterns that govern the Arborist codebase. Each guideline explains *why* things work the way they do so new code stays consistent with existing code.

---

## Design Philosophy

### Safe and simple parallel multi-repo development

Everything in Arborist exists to let a developer work on multiple features across several repositories in parallel without losing or corrupting work. When a choice exists between power and safety, safety wins.

### Align with Git and good CLI practice

Commands, flags, and terminology mirror Git wherever possible. A developer who knows Git should feel at home immediately. Arborist is a thin coordination layer on top of Git worktrees, not a replacement for Git.

### Convention over configuration

Arborist uses marker directories (`.arb/`, `.arbws/`) and filesystem scanning instead of databases, registries, or config files beyond what's needed. If something can be discovered from the directory tree, it should be.

---

## UX Guidelines

### Color semantics

- **Green**: success confirmation only — the final summary line ("Pushed 3 repo(s)"), staged changes in status. Used very sparingly.
- **Yellow**: noteworthy or mildly risky — things that need attention or action. Unpushed commits, local changes, unexpected branches, skipped repos, unstaged/untracked files, operations with caveats.
- **Red**: errors or immediate risks — failed operations, at-risk workspaces, fatal messages.
- **Dim (gray)**: de-emphasized, supplementary information — column headings, commit hashes, section labels in expanded views.
- **Bold**: structural emphasis — section separators in `exec` (`==> repo <==`).
- **Default (no color)**: normal, expected content. Repo names, branch names, inline progress results, informational counts ("up to date", "3 ref(s) updated"). The baseline.

### Descriptive outcomes, not just status

Tell the user *what happened*, not just *that it happened*. Instead of a generic "ok", describe the practical outcome so the user understands the result without investigating further.

- Push/pull: include the commit count from the assessment — "pushed 3 commit(s)", "pulled 2 commit(s)".
- Rebase/merge: past-tense of the action — "rebased onto origin/main", "merged onto origin/main".
- Add/create (worktrees): past-tense — "created".
- Drop: past-tense — "removed", "branch deleted".
- Fetch: describe what changed — "3 ref(s) updated" or "up to date".

### Membership-changing commands

Scope: `add`, `drop`, `create` (and workspace selection in `remove`).

Accept `[repos...]` args. When none given and stdin is a TTY, show an interactive picker. Offer `-a, --all-repos` for scripting. Non-TTY without args is an error with usage guidance.

### State-changing commands

Scope: `push`, `pull`, `rebase`, `merge`.

Accept optional `[repos...]` to narrow scope; default to all repos in the workspace. Follow the five-phase workflow: assess → plan → confirm → execute → summarize. Each defines a typed assessment interface (e.g. `PushAssessment`) classifying repos into will-operate / up-to-date / skip-with-reason. This separates decision-making from execution and makes the plan display trivial.

### Safety gates for destructive operations

When an operation would cause data loss, Arborist refuses and explains why. The `remove` command detects at-risk workspaces (unpushed commits, uncommitted changes) and will not delete them without `--force`. The plan display always shows what's at risk and why, so the developer can make an informed decision.

### TTY-aware behavior

Colors, progress indicators, and interactive prompts only appear when stderr is connected to a terminal. In non-TTY contexts (pipes, CI), output is plain text and confirmation prompts require `--yes` to proceed. The `output.ts` module wraps all color formatting through a `isTTY()` guard, and commands check `isTTY()` before launching interactive prompts.

### Inline progress with line replacement

Scope: all sequential multi-repo commands that suppress git output (push, pull, rebase, merge, drop, add/create worktrees).

In TTY mode: write `  [repo] verb...` as a progress indicator, then on completion use `\r` + ANSI clear to replace the entire line with `  [repo] <descriptive result>`. In non-TTY mode: skip the progress line, write only the result line. Result uses default color (not green) — green is reserved for the final summary line.

`exec` intentionally uses `==> repo <==` section headers instead because it supports interactive content (inherited stdin/stdout/stderr). Parallel operations (fetch) don't use this pattern — they show an aggregate counter during work, then per-repo results after completion.

### Summary line after operations

Every multi-repo command ends with a single green line on stderr that aggregates counts, like "Pushed 3 repo(s), 1 up to date, 2 skipped". This gives instant confirmation of what happened without scrolling.

### Helpful skip reasons

When a repo is skipped during the plan phase, the reason is always stated. Examples: "diverged from origin (use --force)", "uncommitted changes", "local repo", "not pushed yet", "on branch X, expected Y". The developer should never have to guess why a repo was excluded.

### Error recovery guidance

Scope: all state-changing commands (push, pull, rebase, merge).

When a repo fails mid-execution, stop, print the git error output and step-by-step instructions for resolving the issue, and tell the user to re-run for remaining repos. The developer is never left stranded.

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

### Repo classification: local vs remote

`classifyRepos()` separates repos into those with remotes and local-only repos. Commands that interact with remotes (fetch, pull, integrate) use this to gracefully skip local repos with a reason. This allows mixed local/remote workspaces.
