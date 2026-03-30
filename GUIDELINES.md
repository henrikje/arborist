# GUIDELINES.md

Design principles, conventions, and technical patterns for the Arborist codebase. Each section explains *why* things work the way they do so new code stays consistent.

---

## Design Principles

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

**1. Coordination or authoring?** The authoring boundary (DR-0023) is the first gate. If the operation belongs to the developer's role as author — how they present their work — it belongs in `arb exec` or outside Arborist entirely. The commit-message problem is a useful tell: if any automated choice is likely wrong and will need manual correction, the operation is on the authoring side. Example: `arb extract` restructures existing commits into two stacked workspaces without creating new content — coordination, not authoring (DR-0099).

**2. New operation or variant of an existing one?** If the mechanism is fundamentally the same as an existing command applied differently, it is a variant and belongs as a flag on that command. Detection logic for the variant case typically lives in the parent command already — splitting it out would mean detection in one place and recovery in another.

**3. For variants — how rare?** An escape hatch invoked once per stack lifecycle or to recover from an unusual state is an optional flag. A frequent alternate mode deserves a more prominent option or its own subcommand.

**4. For new operations — is the coordination value substantial?** Does it need a plan/confirm flow, conflict prediction, an abort/continue state machine, or non-trivial per-repo assessment? Would `arb exec` leave users meaningfully worse off? Substantial value earns a dedicated command. Thin value earns an `arb exec` recipe in the docs.

**5. For new commands — weight determines placement.** Lightweight, noun-focused operations (show state, rename, simple mutations) go under a subcommand group (e.g. `arb branch show`, `arb branch rename`). Heavyweight operations with multi-phase workflows, conflict handling, or state machines go at the top level alongside `rebase`, `merge`, and `push`.

The underlying principle: a command earns its place when Arborist has meaningful knowledge to contribute that the user cannot easily replicate with `arb exec` — conflict prediction, divergence analysis, cross-repo state coordination, safe rollback. When that knowledge is absent or thin, the value is not there.

### Prefer correctness over backwards compatibility

Arborist is in pre-release. The priority is getting the design right — not preserving compatibility with earlier pre-release behavior. When a better approach is found, adopt it directly: rename commands, change defaults, restructure output. Breaking changes are expected and acceptable during this phase.

### Record significant decisions

When a feature or change involves weighing meaningful options, preserve the reasoning in a decision record. See § Commit Conventions for the process and template.

---

## Command Conventions

### Command interaction patterns

**Three command categories have distinct interaction patterns.**

**Membership-changing commands** (`attach`, `detach`, `create`, workspace selection in `delete`): accept `[repos...]` args. When none given and stdin is a TTY, show an interactive picker. Offer `-a, --all-repos` for scripting. Non-TTY without args is an error with usage guidance. Note: `detach`, `delete`, and `branch rename` follow the same five-phase plan flow as state-changing commands (assess → plan → confirm → execute → summarize). Only `create` (guided flow with parameter-echo pattern) and `attach` (simple execute-report) are structurally different.

**State-changing commands** (`push`, `pull`, `rebase`, `merge`, `reset`, `retarget`): accept optional `[repos...]` to narrow scope; default to all repos. Follow the five-phase workflow: assess → plan → confirm → execute → summarize. Each defines a typed assessment interface classifying repos into will-operate / up-to-date / skip-with-reason.

**Overview commands** (`status`, `log`) are read-only. They scope to the feature branch via base branch resolution, skip detached/drifted repos with explanation, and support `[repos...]` filtering, `--json`, and `--verbose`.

### Expected flags per command category

**When adding a new command to a category, verify it carries all expected flags.** Exceptions need a documented reason (e.g. `pull` omitting `--no-fetch` because it inherently fetches).

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

**Group commands under a singular noun (`repo`, `template`) with subcommands. The default is always a read-only inspection subcommand (`list` or `show`), never a mutation.**

### Fetch behavior

**Sync commands** (`push`, `rebase`, `merge`), **dashboard commands** (`status`, `list`), **membership commands** (`attach`, `create`, `detach`), and **plan commands** (`delete`) fetch by default. **`branch show`** fetches by default in verbose mode only. `-N, --no-fetch` skips the pre-fetch when refs are fresh. Dashboard commands use phased rendering for instant feedback. Short-option assignments: `-N` → `--no-fetch` (common action), `-f` → `--force` (conventional), `--fetch` has no short option (infrequent — fetch is the default).

**`pull`** always fetches — it inherently needs fresh remote state. It does not offer `--no-fetch`.

**`log`** does not fetch by default — stale content is less confusing. `--fetch` opts in.

The `ARB_NO_FETCH` environment variable globally suppresses automatic fetching — equivalent to passing `-N` to every command. Explicit `--fetch` overrides it. `pull` is unaffected (it always fetches). See `decisions/0045-universal-fetch-flags.md` and `decisions/0087-arb-no-fetch-env-var.md`.

### Network timeouts

**All git operations that contact the network must have a timeout.** Use `gitNetwork()` from `src/lib/git/git.ts` for individual network calls, or `parallelFetch()` for batch fetches (which uses `gitNetwork()` internally with a shared global deadline). Local git operations use `gitLocal()`, which has its own timeout (default 5s, `ARB_GIT_TIMEOUT` env var) to protect against cloud-synced filesystems blocking on undownloaded files.

Timeout values follow a resolution hierarchy: operation-specific env var → `ARB_NETWORK_TIMEOUT` → built-in default. Use `networkTimeout(specificVar, defaultSeconds)` to resolve. Current defaults: fetch 120s, push 120s, pull 120s, clone 300s. Exit code 124 indicates timeout (matching Unix `timeout` convention).

### Repo specification: positional vs option

**Repos are positional when they're the primary target (`arb push [repos...]`). They become `--repo <name>` (repeatable) when another argument consumes the positional.** Examples: `arb exec <command...>` (positional consumed by command), `arb template diff [file] --repo <name>`.

### Status-based filtering: `--where` and `--dirty`

**`--where` (`-w`) filters repos by `RepoFlags`.** Supported on every command that gathers workspace status: `status`, `log`, `exec`, `open`, `list`, `delete`, `push`, `pull`, `rebase`, `merge`, `reset`. Commands that don't gather status (e.g. `attach`, `create`, `branch rename`) do not get `--where`.

**`--dirty` (`-d`) is a shorthand for `--where dirty`, mutually exclusive with `--where`.** Only offered where "dirty" is a natural filter: `status`, `log`, `exec`, `open`, `list`. Omitted from sync commands and `delete`.

Filter terms are organized by orthogonal dimension (see § Status Model). Positional terms use the `<position>-<axis>` pattern (`ahead-share`, `behind-base`) so axis relationships are obvious. Filter names describe state, not suggested action — whether a repo "needs rebase" depends on the user's intent; the filter just says `behind-base`. Named positive terms exist only where they provide non-trivial composition (`pushed` = `^ahead-share+^no-share`) or are natural vocabulary (`clean`, `safe`); trivially-derivable positives use `^` negation instead (`^behind-base` rather than a named `synced-base`).

All commands use `resolveWhereFilter()` from `status.ts` for validation. Follow the existing pattern when adding `--where` to a new command.

### Quiet output and stdin piping

**`--quiet` / `-q` outputs one primary identifier per line to stdout — no headers, no ANSI, no trailing whitespace.** Supported on `list`, `status`, `repo list`. Conflicts with `--json` and `--verbose`.

**Commands accepting positional `[repos...]` also accept names from stdin when piped.** Positional args take precedence, then stdin, then default (all). Commands that inherit stdin (`exec`, `open`) are excluded.

### Short flag allocation

**Short flags carry consistent meaning across the CLI. Check this table before assigning a new one.**

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

---

## Status Model

### RepoStatus and RepoFlags

**`status/status.ts` is the single source of truth for repository state. Never invent local representations or ad-hoc git queries.** `RepoStatus` is a 5-section model (identity, local, base, share, operation). `RepoFlags` computes independent boolean flags from that model. Named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) group flags by concern. Shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`) in `status/` derive decisions; display functions (`flagLabels`, `formatStatusCounts`, `buildStatusCountsCell`) live in `render/analysis.ts`.

**Commands must use shared functions (`isAtRisk`, `wouldLoseWork`, `flagLabels`) rather than re-deriving conclusions from raw flags** — this keeps evaluation logic centralized. `resolveWhereFilter()` handles `--dirty`/`--where` option validation and resolution; `repoMatchesWhere()` tests a `RepoFlags` against a parsed filter expression.

### Orthogonal status dimensions

**`RepoFlags` fields map to 7 orthogonal dimensions. Each flag belongs to exactly one dimension, and filters are named to reflect their dimension.**

| Dimension | Flags | Filter terms |
|-----------|-------|-------------|
| Local | `isDirty`, `hasConflict`, `hasStaged`, `hasModified`, `hasUntracked` | `dirty`, `conflict`, `staged`, `modified`, `untracked`, `clean` |
| Branch | `isWrongBranch`, `isDetached` | `wrong-branch`, `detached` |
| Base position | `isAheadOfBase`, `isBehindBase`, `isDiverged` | `ahead-base`, `behind-base`, `diverged` |
| Base lifecycle | `isMerged`, `isBaseMerged`, `isBaseMissing` | `merged`, `base-merged`, `base-missing` |
| Share lifecycle | `hasNoShare`, `isGone` | `no-share`, `gone` |
| Share position | `isAheadOfShare`, `isBehindShare` | `ahead-share`, `behind-share` |
| Infrastructure | `isShallow`, `hasOperation`, `isTimedOut` | `shallow`, `operation`, `timed-out` |

Positional filters use the `<position>-<axis>` pattern (`ahead-share`, `behind-base`) to make axis relationships obvious. Lifecycle and infrastructure filters use standalone names when unambiguous (`gone`, `merged`, `shallow`). Flag names align with filter names: `isBehindBase` → `behind-base`, `isAheadOfShare` → `ahead-share`, etc. When adding a new flag, identify which dimension it belongs to and follow the naming convention of that dimension. See `decisions/0083-orthogonal-filter-dimensions.md`.

### Structured sub-objects

**Use optional sub-objects instead of flat optional fields.** The `base` section uses an optional `merge?` sub-object to group merge lifecycle fields (`kind`, `newCommitsAfter?`, `commitHash?`, `detectedPr?`) — present only when a merge is detected. The `share` section uses an optional `outdated?` sub-object (`total`, `rebased`, `replaced`, `squashed`) to consolidate divergence detection results — present only when detection ran. Consumers use `share.outdated?.total ?? 0` instead of manually summing individual fields.

### Analysis pipeline

**After basic ahead/behind counting, three optional analysis phases run, each gated independently.** Share divergence detection runs when both `toPush` and `toPull` are positive. Replay plan analysis runs when both `ahead` and `behind` are positive, using `matchDivergedCommits()` to identify which local commits already exist on base. Merge detection runs when `shouldRunMergeDetection()` is true, and `computeMergeDetectionStrategy()` further gates which methods apply based on `share.refMode` and push/pull state. Results are cached in the analysis cache keyed by HEAD+base+share SHAs. The replay plan and merge detection can independently detect the same squash-merge — the replay plan via patch-id matching (always runs when ahead+behind > 0), merge detection via `detectBranchMerged()` (gated by share state). When extending gating conditions, ensure both paths agree to avoid status/rebase disagreement.

### Extending the model

**When adding a new concept, extend the model in `status.ts` so every consumer benefits:**

1. Add the observation to `RepoStatus` if it's raw git state.
2. Add a flag to `RepoFlags` if it represents a condition that needs attention.
3. Add the flag to `computeFlags()` and the label to `FLAG_LABELS`.
4. All existing consumers (status display, list aggregation, remove safety checks, etc.) automatically pick it up through `isAtRisk()` and `flagLabels()`.

### Remote roles terminology

**Remote roles are `base` (integration) and `share` (sharing), defined in `RepoRemotes`.** The corresponding status sections are `base` and `share` in `RepoStatus`. The user-facing column headers are `BASE` and `SHARE`. Flag labels are `behind base` and `behind share`. Note: the git remote *name* may still be `"upstream"` (a fork workflow convention), but the *role* in code is always `base`.

---

## Mutation Flow

### Shared library composition

**Commands compose small, focused library functions rather than inheriting from base classes.** `integrate.ts` demonstrates how to parameterize shared logic: rebase and merge share the exact same five-phase flow, differing only in the git subcommand and verb strings.

### Mutation command flow

**`runPlanFlow<TAssessment>()` in `sync/mutation-flow.ts` orchestrates the five-phase flow: fetch → assess → format plan → confirm → execute.** `PlanFlowOptions<TAssessment>` configures each phase — `assess` classifies repos, `formatPlan` renders the plan table, and the command's action handler runs execution and summarization after `runPlanFlow` returns. Reference implementations: `push.ts` for sync, `integrate.ts` for parameterized rebase/merge.

### Assessment modeling

**Model assess-phase results as discriminated unions in `sync/types.ts`.** `RepoAssessment`, `PullAssessment`, and `PushAssessment` are the source of truth for plan/execution state; command code narrows on `outcome` instead of relying on optional flat fields. Command-specific classification stays near the command domain (`classify-integrate.ts`, `pull.ts`, `push.ts`), while orchestration stays in the top-level command flow.

### postAssess and verbose pattern

**The optional `postAssess` callback runs after assessment, before plan formatting.** It is the extension point for verbose commit gathering and conflict prediction. The verbose pattern: `postAssess` calls `getCommitsBetweenFull()`, slices to `VERBOSE_COMMIT_LIMIT` (from `sync/constants.ts`), and stores the result in the assessment's `verbose` field. The plan formatter then passes these to `verboseCommitsToNodes()` (from `render/status-verbose.ts`) via the `afterRow` property on `TableRow`, which the renderer appends after the corresponding table row. Six commands use this pattern identically.

### Classification check order

**Classifiers follow a fixed check order: (1) blockers, (2) state-availability, (3) up-to-date, (4) dirty, (5) will-operate.**

```ts
function classifyRepo(status, flags, options): Assessment {
  // 1. Blockers — hard stops regardless of state
  if (status.operation)         return { outcome: "skip", reason: "operation in progress" };
  if (flags.isDetached)         return { outcome: "skip", reason: "detached HEAD" };
  if (flags.isWrongBranch && !options.includeWrongBranch)
                                return { outcome: "skip", reason: "wrong branch" };

  // 2. State availability — can't assess without these
  if (!status.base.ref)         return { outcome: "skip", reason: "no base branch" };
  if (flags.isMerged)           return { outcome: "skip", reason: "already merged" };

  // 3. Up-to-date — nothing to do (must come BEFORE dirty)
  if (status.base.ahead === 0)  return { outcome: "up-to-date" };

  // 4. Dirty — only reached when work is actually needed
  if (flags.isDirty && !options.autostash)
                                return { outcome: "skip", reason: "uncommitted changes" };

  // 5. Will operate
  return { outcome: "will-operate", commits: status.base.ahead };
}
```

This ordering ensures the user sees the most informative skip reason first. A dirty check that fires before up-to-date would misleadingly suggest `--autostash` for repos that don't need syncing. Reference implementations: `classify-integrate.ts`, `classify-retarget.ts`.

### Shared override exposure

**When shared assessment logic accepts override options (e.g. `includeInProgress`, `includeWrongBranch`, `autostash`), every command that delegates to that logic must expose the corresponding CLI flag.** Hardcoding an override to `false` without a CLI escape hatch means the user cannot recover from the skipped state without switching commands. When adding a new override parameter to shared logic, grep for all call sites and wire the flag through. When a new command delegates to existing shared logic, check the options interface for overrides that need CLI exposure.

### Cross-command status reuse

**`buildCachedStatusAssess()` in `sync/assess-with-cache.ts` owns the common mechanics for mutation commands that assess from `RepoStatus`.** It handles previous-status caching, no-op fetch reuse via `unchangedRepos`, `gatherRepoStatus()`, and `--where` filtering. `runPlanFlow()` remains an orchestration primitive; it does not know command-specific assessment rules.

### Parallel fetch, sequential mutations

**Fetch runs in parallel for speed. State-changing git operations run sequentially for predictable ordering, clear errors, and stop-on-failure.** `parallelFetch()` batches all network I/O upfront to avoid per-repo latency during the sequential phase. `pull` is excluded from the fetch flag system — `git pull` inherently fetches. Quiet mode (`-q`) on dashboard commands skips fetching by default for scripting speed.

### Building blocks

Additional building blocks for mutation commands:
- `finishSummary(parts, hasErrors)` in `render/render.ts` — renders the final green/yellow summary line and throws `ArbError` when `hasErrors` is true. Use this for multi-repo summaries, not `success()` or `error()`.
- `confirmOrExit({ yes, message })` in `sync/mutation-flow.ts` — handles the confirmation prompt or `--yes` skip.
- `skipCell(reason, skipFlag?)` and `upToDateCell()` in `render/plan-format.ts` — produce standard plan-table cells for skipped and up-to-date repos.
- `dryRunNotice()` in `terminal/output.ts` — prints the dry-run exit message.

---

## Output and Rendering

### Color semantics

**Colors have fixed meanings. Never use a color outside its designated purpose.**

- **Green**: success confirmation only — the final summary line ("Pushed 3 repos"). Used sparingly.
- **Yellow**: noteworthy or mildly risky — things that need attention or action. Unpushed commits, local changes, unexpected branches, skipped repos, operations with caveats.
- **Red**: errors or immediate risks — failed operations, at-risk workspaces, fatal messages.
- **Dim (gray)**: de-emphasized, supplementary — column headings, commit hashes, section labels.
- **Cyan**: interactive-tool alignment — used to match the accent color of `@inquirer` prompts, keeping arb output visually consistent with interactive selections.
- **Bold**: structural emphasis — section separators in `exec` (`==> repo <==`).
- **Default (no color)**: normal, expected content. Repo names, branch names, inline progress results, informational counts.

### Clear, descriptive output

**Tell the user *what happened*, not just *that it happened*.** Use descriptive per-repo outcomes: "pushed 3 commits", "rebased onto origin/main", "3 refs updated", "created", "detached", "up to date". When a repo is skipped, the reason is always stated ("diverged from origin", "uncommitted changes", "on branch X, expected Y") — the developer should never have to guess.

- **Summary lines.** Every multi-repo command ends with a single green summary line on stderr that aggregates counts ("Pushed 3 repos, 1 up to date, 2 skipped") via `finishSummary()` in `render/render.ts`. Do not use `success()` or `error()` for multi-item summary output.
- **Nothing to do.** When no items qualify for the operation, use `info()` with a verb-specific message (`Nothing to push`, `All repos up to date`). Never `warn()`, no trailing period.
- **State labels.** Synthetic state labels in table cells (`detached`, `no branch`, `gone`) are wrapped in parentheses to distinguish them from actual values.
- **Workspace-level refs.** When displaying workspace-level base or share refs (derived from per-repo data), prefer `configuredRef` over `ref` (show user's intent, not the fallback). Format as `remote/branch`.

### Output separation

**All human-facing output (progress, prompts, summaries, errors) goes to stderr. Only machine-parseable data goes to stdout.** The `output.ts` module enforces this with `success`/`info`/`warn`/`error` helpers (stderr) and a separate `stdout` helper.

### Progress feedback

**Sequential commands: show `[repo] verb...` progress in TTY, replace with result on completion. Non-TTY: skip progress, write only results.** `exec` uses `==> repo <==` section headers instead (supports interactive content).

**Fetch-then-display commands** (status, list): use phased rendering to show stale data instantly while the fetch runs, then replace with fresh data. See § Phased rendering.

### TTY-aware behavior

**Colors, progress indicators, and interactive prompts only appear when stderr is connected to a terminal.** In non-TTY contexts (pipes, CI), output is plain text and confirmation prompts require `--yes`.

Color output is additionally disabled when the `NO_COLOR` environment variable is set (any value, including empty — per the no-color.org convention) or when `TERM=dumb`. The `shouldColor()` function in `tty.ts` encapsulates this logic. Use `shouldColor()` for color decisions and `isTTY()` for interactive features (prompts, cursor control, progress indicators).

### Adaptive table output

**Column *visibility* is driven by data, not terminal width.** A column is hidden when its data is redundant across all rows (e.g., all repos share the same base ref) — never because the terminal is too narrow. When a column is hidden, its shared value appears in the parenthetical header note so no information is lost. Column *values* are truncated to fit the terminal width. Truncatable columns declare a minimum width; the renderer distributes overflow reduction across them, preserving remote prefixes (`origin/` + 3 chars + ellipsis). When terminal width is unknown, no truncation is applied. See `decisions/0092`.

### Table spacing convention

**Plan commands (state-changing): blank line before and after the table.** The blank lines separate the plan from fetch output above and the confirmation prompt below.

**Overview commands (read-only): minimize vertical padding.** Blank lines appear only for structural clarity between distinct elements (e.g., a context header and the table body).

### Declarative render model

**Build table output as `OutputNode` trees in `render/model.ts`, then render to ANSI in a single pass.** This separates structure from presentation. `TableColumnDef` defines each column's `key`, `header`, optional `show` (data-driven visibility: `true`, `false`, or `"auto"`), `truncate` (width-driven value shortening with a `min` floor), and `align`. `Cell` carries both `plain` text (for width measurement) and styled `Span[]` (for ANSI rendering). Analysis functions in `render/analysis.ts` produce `Cell` values from `RepoStatus`; view builders like `buildStatusView()` assemble them into `TableNode`; `render()` resolves column widths, applies truncation if the table exceeds terminal width, and emits the final string. `height-fit.ts` handles vertical truncation when `maxLines` is provided (used by watch mode). `createRenderContext()` detects terminal width (`process.stdout.columns` → `COLUMNS` env → `undefined`) and TTY status.

### Phased rendering

**Commands with `--fetch`/`--no-fetch` use `runPhasedRender` to show stale data instantly while a fetch runs in the background, then replace with fresh data.** The render-then-clear order ensures content is always visible — no blank gaps between phases. `reportFetchFailures` must be called after `runPhasedRender` completes, not inside a render callback. Dashboard commands (`status`, `list`) and `branch --verbose` support pressing Ctrl+C to cancel the background fetch and exit immediately with stale data on stdout. Dashboard commands use `preserveTypeahead: true` with `runPhasedRender` so characters typed during the fetch stay in the kernel input buffer and appear at the shell prompt after arb exits — echo is suppressed via `stty -echo noflsh` instead of raw mode. Mutation commands use the default raw-mode suppression. See `decisions/0039-two-phase-status-render.md`, `decisions/0041-render-then-clear-phased-rendering.md`, and `decisions/0085-preserve-typeahead-during-fetch.md`.

### Documentation: help is reference, README is tutorial

**`--help` is the authoritative reference — every option, argument, and behavioral detail.** Keep descriptions concise but complete. The README walks through workflows and explains the mental model, linking to `arb help <command>` for details.

---

## Error Handling

### Exception-based exit handling

Commands and library code signal errors by throwing `ArbError` (exit 1) or `ArbAbort` (exit 130); a single catch in `index.ts` maps these to exit codes.

**Always call `error()` or `warn()` before throwing `ArbError`.** The catch handler does not print the exception message — it only maps the type to an exit code. If you throw without logging first, the user sees nothing on stderr: just a silent exit 1.

```ts
// CORRECT — user sees the message
error(`Cannot capture HEAD for ${repo}`);
throw new ArbError(`Cannot capture HEAD for ${repo}`);

// WRONG — user sees nothing, process silently exits 1
throw new ArbError(`Cannot capture HEAD for ${repo}`);
```

Exception types:
- `ArbError` — error condition → `process.exit(1)`.
- `ArbAbort` — user cancellation (declined prompt, Ctrl-C during inquirer) → prints `info(err.message)` (default: "Aborted.") then `process.exit(130)`.

### gitLocal() return convention

**`gitLocal()` does not throw on non-zero exit — check `result.exitCode !== 0` to detect failures.** `try/catch` only catches spawn failures and timeouts, not git errors.

```ts
// CORRECT — check exitCode
const result = await gitLocal(repoDir, "rev-parse", "HEAD");
if (result.exitCode !== 0) {
  error(`Failed to resolve HEAD: ${result.stderr}`);
  throw new ArbError("...");
}
const head = result.stdout.trim();

// WRONG — try/catch silently succeeds on non-zero exit
try {
  const result = await gitLocal(repoDir, "rev-parse", "HEAD");
  const head = result.stdout.trim(); // empty string, no error thrown
} catch {
  // Never reached for git errors — only spawn failures and timeouts
}
```

### Context validation guards

**Call `requireWorkspace()` and `requireBranch()` at the top of action handlers.** These validate context early, exiting with helpful messages before any work is done.

### Error recovery guidance

**Conflicts continue all repos then print a consolidated report. Unexpected failures stop at first failure.**

**Conflicts** (rebase, merge, pull): repos are independent — arb continues processing all, then prints a consolidated conflict report with per-repo resolution instructions. Summary uses yellow. Exit 1.

**Unexpected failures** (push): often systemic (auth, server errors). Arb stops at first failure, prints git's error output, and tells the user to investigate and re-run.

### Error message guidelines

**Tell the user what went wrong. Add recovery hints only when the next step is non-obvious.** Do not add hints for routine situations a competent CLI user can figure out (e.g. "workspace not found" does not need "run `arb list`"). Reserve hints for:

- **Ambiguous failures** — when the message alone doesn't explain *why* (e.g. git network errors that could be auth, connectivity, or a bad URL).
- **Non-obvious recovery** — when the fix involves flags or commands the user may not know exist (e.g. `--continue`, `--abort`, `--force`).
- **Unexpected state** — when the system is in a state that shouldn't normally occur (e.g. missing remotes, corrupted worktree refs).
- **Domain-specific jargon** — when the error uses terms the user may not understand (e.g. "template drift").

The `error()` call (stderr) carries the full message. The `ArbError` message should be self-contained — in non-TTY or piped contexts it may be the only thing the user sees.

For network/git failures, use `classifyNetworkError()` from `src/lib/sync/network-errors.ts` to distinguish auth, connectivity, and URL problems. The push command is the reference implementation.

---

## Git Internals

### Repo classification and remote validation

**All repos must have valid, resolvable git remotes. Use `resolveRemotesMap()` for resolution.** It resolves remote roles (base/share) and propagates errors with actionable fix instructions rather than silently degrading.

### Request-scoped GitCache

**Create one `GitCache` per command and pass it to status and template functions.** The cache stores Promises so concurrent callers coalesce onto the same in-flight git process. After a fetch, call `cache.invalidateAfterFetch()`. Low-level functions (`getRemoteNames`, `resolveRemotes`, `getRemoteUrl`, `getDefaultBranch`) should only be imported in `git-cache.ts` and test files. See `decisions/0044-request-scoped-git-cache.md`.

### Minimum Git version: 2.17

**Git 2.17+ is required, enforced by `assertMinimumGitVersion()` at the start of every command that creates a `GitCache`.** The 2.17 floor is set by `worktree add --no-track` and `worktree remove`, which are fundamental to workspace creation and deletion.

**New code must only use git features available in 2.17+.** Features from newer versions require both:
1. **Version gating** — check `cache.getGitVersion()` and degrade gracefully or skip.
2. **Strong justification** — the feature must provide significant value that cannot be achieved with 2.17 primitives.

Current exceptions:
- **`worktree repair`** (2.30) — gated in `branch-rename.ts`; workspace directory rename is refused on older git with a warning.
- **`merge-tree --write-tree`** (2.38) — gated in `git.ts`; conflict prediction silently returns null.

When adding a new git feature above 2.17, document it in this list and write a decision record.

### Git worktree directory layout

**Linked worktrees share the canonical repo's `.git/` directory but store per-worktree state in `.git/worktrees/<entry>/`.**

- **Per-worktree** (`.git/worktrees/<entry>/`): `HEAD`, `index`, `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`, `rebase-merge/`, `rebase-apply/`
- **Shared** (`.git/` root): `objects/`, `refs/`, `logs/`, `packed-refs`, `config`, `info/`

The forward reference (worktree `.git` file → `gitdir: .../.git/worktrees/<entry>`) and backward reference (`.git/worktrees/<entry>/gitdir` → worktree path) are maintained by git. `readGitdirFromWorktree()` reads the forward reference; `clean.ts` handles repair of both directions. Any feature that watches or reads from the canonical `.git/` directory must account for this split — shared paths receive writes from all worktrees, not just the current one.

### Watch loop

**`arb watch` in `terminal/watch-loop.ts` monitors three path categories with debounce (leading + trailing edges) and a mute window.** The categories: per-repo worktree working directories (with gitignore filtering, for dirty/untracked detection), per-repo canonical `.git/` directories (with a whitelist filter, for ref and state changes), and the workspace root directory (for detecting newly attached repos and config changes). The whitelist only passes `refs/`, `packed-refs`, and this worktree's own entry dir — see § Git worktree directory layout for why.

Debouncing: the first event after a quiet period triggers an immediate render; subsequent events within the burst are debounced (300ms trailing). After each render, a mute window of equal length defers events to avoid re-renders caused by the render's own git operations (e.g., `git status` touching `.git/index`). Events during the mute are not dropped — they set a dirty flag and schedule a deferred render after the mute expires, so external changes (e.g. commits from another terminal) are always picked up. If events arrive during rendering, a dirty flag schedules a post-mute re-render. When a render completes with no pending events, the system returns to leading-edge mode. See `decisions/0094-leading-edge-debounce.md` and `decisions/0097-mute-window-deferred-render.md`.

The workspace root filter passes top-level entries and `.arbws/` changes, ignoring deep repo file changes already covered by per-repo watchers. Watchers are added dynamically when new repos are attached to the workspace. After each render, an `onPostRender` callback compares the current repo set against a tracked set and pushes new watch entries for any newly discovered repos. The watch loop starts watchers for new entries automatically, tracking started paths to avoid duplicates. Commands (push, pull, rebase, merge) and fetch use a live repo list that re-scans `workspaceRepoDirs` at invocation time, so newly attached repos are always included.

Suspended commands (full command flows triggered from watch) stop watchers → tear down stdin → run command → wait → resume watchers → re-render.

The loop registers SIGHUP, SIGTERM, and stdin `end` handlers so the process exits cleanly when the terminal closes or the session drops. Cleanup wraps terminal I/O (`teardownStdin`, `leaveAlternateScreen`) in try-catch because the terminal may already be gone when these run — resource cleanup (closing fs watchers, removing listeners) must always execute regardless. See `decisions/0095-watch-terminal-disconnect-handling.md`.

### Operation record and recovery

**State-changing commands write `.arbws/operation.json` for `--continue`/`--abort`/`arb undo` recovery.** Running a bare command during an in-progress operation is blocked with guidance — the user must explicitly choose `--continue` or `--abort`.

`arb undo [repos...]` supports selective per-repo undo. When repos are named, only those repos are undone and marked with `status: "undone"` in the operation record. The record is kept until all repos are resolved, at which point config is restored and the record is finalized. Workspace-level operations (config restore, directory rename for `rename` commands) are deferred to the final undo. The finalization check is outcome-based — naming every actionable repo explicitly produces the same result as a bare `arb undo`.

The shared infrastructure lives in `core/operation.ts` (schema, I/O, gate, reconciliation), `sync/continue-flow.ts` (shared continue orchestration), and `sync/undo/` (assessment, planning, execution for both `--abort` and `arb undo`). See `decisions/0095-operation-record-and-recovery-model.md`.

### Config format and validation

**Workspace config (`.arbws/config.json`) and project config (`.arb/config.json`) are stored as JSON, validated at read/write time by Zod schemas in `core/config.ts`.** Types are derived via `z.infer<>`, following the same pattern as JSON output schemas in `json-types.ts`. Legacy config files (old INI format or old `config` filename without `.json` extension) are auto-migrated on first read. See `decisions/0067-json-config-format.md`.

### Scripts (`scripts/`)

**Files in `scripts/` are standalone Bun scripts that run outside the CLI runtime.** They may use `console.log`/`console.error` and `process.exit()` directly — the exception-based exit handling convention applies only to `src/` code. Scripts should import pure logic from `src/lib/` where possible so that decision logic is unit-testable (e.g. `scripts/set-version.ts` delegates to `src/lib/core/version.ts`).

### Shell completion

**When adding a command, update both `shell/arb.bash` and `shell/arb.zsh`.** Bash uses a manual `while` loop to find the subcommand, then dispatches to per-subcommand functions. Zsh uses `_arguments -C -` with `*::arg:->args` for a two-level dispatch. The `-` flag is critical — it stops global option parsing at the first positional argument (the subcommand). Without it, subcommand-specific options like `-v` are rejected as unknown global options and completion silently fails. Add both a `__arb_complete_<cmd>` function in bash and a `case` entry under `args)` in zsh.

### Install scripts

**Binary replacement uses `rm` + `cp`, not overwrite-in-place — macOS caches code-signing verification per inode.** The RC block (`.zshrc`/`.bashrc`) must be appended at the end of the file so arb's PATH entry wins over Homebrew. RC block removal must be positional (only lines adjacent to the marker) — global pattern matching can accidentally delete user lines. Both scripts share cleanup logic but are separate files; changes must be made in both `install.sh` and `uninstall.sh`.

---

## Commit Conventions

All commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint.

### Release-note types

**Use `feat`, `fix`, or `perf` for changes included in release notes. These require a scope.** Scope must be a single word, never comma-separated.

**Scope** is the primary command affected by the change: `create`, `rebase`, `push`, etc. For second-level commands, use the command group: `branch`, `repo`, `template`.

When the change cannot be attributed to a particular command, use a cross-cutting scope:

- `analysis` — intelligence derived from git
- `cache` — persistent caching infrastructure
- `config` — configuration system
- `filter` — general improvements to filtering
- `render` — cross-command changes to rendering
- `shell` — shell integration

### Internal types

| Type | Scope | Examples |
|------|-------|---------|
| `test` | Test category: `unit`, `integration`, `fuzz`, `perf`, `pbt` | `test(integration): add case-sensitivity tests` |
| `chore` | Maintenance domain: `ci`, `main`, `deps` | `chore(ci): add post-release validation workflow` |
| `refactor` | No scope | `refactor: extract shared rename utility` |
| `docs` | No scope | `docs: update workspace description for clarity` |

### Subject line

**Use imperative mood ("add", "fix", "remove"), lowercase, no trailing period.** The subject describes *what changed*, not implementation details:

- `feat(pull): add --reset flag to arb pull`
- `fix(branch): handle case-only branch renames on macOS`
- `perf(status): parallelize repo status gathering`
- `test(integration): add case-sensitivity filesystem tests`
- `refactor: implement auto-hide for table columns`

### Decision records

**Capture significant design decisions in `decisions/NNNN-*.md`. Existing records must never be modified.** If a decision is revisited, write a new record referencing the original.

The `decisions/` directory captures context, options, chosen approach, and reasoning. Read relevant records before proposing changes to features they cover.

After implementing a feature involving a significant decision, distill a `decisions/NNNN-*.md` from the plan — strip implementation details, keep only context, options, decision, reasoning, and consequences. If the decision reveals a new enduring principle, add it to § Design Principles and reference it from the record. See `decisions/README.md` for the template.
