# ARCHITECTURE.md

Technical patterns and development conventions for the Arborist codebase.

---

## Architectural Patterns

### Canonical status model

`status/status.ts` is the single source of truth for repository state. `RepoStatus` is a 5-section model (identity, local, base, share, operation). `RepoFlags` computes independent boolean flags from that model. Named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) group flags by concern. Shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`) in `status/` derive decisions; display functions (`flagLabels`, `formatStatusCounts`, `buildStatusCountsCell`) live in `render/analysis.ts`.

**Orthogonal status dimensions.** `RepoFlags` fields map to 7 orthogonal dimensions of repo state. Each flag belongs to exactly one dimension, and filters are named to reflect their dimension:

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

**Structured sub-objects in base and share.** The `base` section uses an optional `merge?` sub-object to group merge lifecycle fields (`kind`, `newCommitsAfter?`, `commitHash?`, `detectedPr?`) — present only when a merge is detected. The `share` section uses an optional `outdated?` sub-object (`total`, `rebased`, `replaced`, `squashed`) to consolidate divergence detection results — present only when detection ran. Consumers use `share.outdated?.total ?? 0` instead of manually summing individual fields.

Every command that needs to understand repo state must work from `RepoStatus` and `RepoFlags` — never invent local representations or ad-hoc git queries. When adding a new concept, extend the model in `status.ts` so every consumer benefits:

1. Add the observation to `RepoStatus` if it's raw git state.
2. Add a flag to `RepoFlags` if it represents a condition that needs attention.
3. Add the flag to `computeFlags()` and the label to `FLAG_LABELS`.
4. All existing consumers (status display, list aggregation, remove safety checks, etc.) automatically pick it up through `isAtRisk()` and `flagLabels()`.

Commands must use shared functions (`isAtRisk`, `wouldLoseWork`, `flagLabels`) rather than re-deriving conclusions from raw flags — this keeps evaluation logic centralized. `resolveWhereFilter()` handles `--dirty`/`--where` option validation and resolution; `repoMatchesWhere()` tests a `RepoFlags` against a parsed filter expression.

**Remote roles terminology.** The two remote roles are `base` (integration) and `share` (sharing), defined in `RepoRemotes`. The corresponding status sections are `base` and `share` in `RepoStatus`. The user-facing column headers are `BASE` and `SHARE`. Flag labels are `behind base` and `behind share`. Note: the git remote *name* may still be `"upstream"` (a fork workflow convention), but the *role* in code is always `base`.

### Import rules

`src/lib/` is organized into semantic subdirectories (`core/`, `terminal/`, `git/`, `status/`, `render/`, `workspace/`, `sync/`, `json/`, `help/`). Circular dependencies between files or directories are not allowed — enforced by `bun run cycles` (madge).

- **Siblings allowed**: any directory may import from any sibling directory (e.g. `render/` → `status/`).
- **Children must not import parents**: a file must not import from its own directory's `index.ts`. When a child file needs a type defined in the barrel, extract that type into a `types.ts` leaf file in the same directory.
- **Within `lib/`**: use direct file imports (`../status/status`) to avoid barrel-induced circular dependency issues.
- **Command files and `src/index.ts`**: use barrel imports (`../lib/status`).
- **Cycle fix pattern**: when a cycle is detected, identify the shared type causing it and extract it into a `types.ts` file that has no upstream imports from the cycled module.

### Shared library composition

Commands compose small, focused library functions rather than inheriting from base classes. `integrate.ts` demonstrates how to parameterize shared logic: rebase and merge share the exact same five-phase flow, differing only in the git subcommand and verb strings.

Mutation commands model their assess-phase results as discriminated unions in `sync/types.ts`. `RepoAssessment`, `PullAssessment`, and `PushAssessment` are the source of truth for plan/execution state; command code narrows on `outcome` instead of relying on optional flat fields. Command-specific classification stays near the command domain (`classify-integrate.ts`, `pull.ts`, `push.ts`), while orchestration stays in the top-level command flow.

Cross-command status reuse lives in `sync/assess-with-cache.ts`. `buildCachedStatusAssess()` owns the common mechanics for mutation commands that assess from `RepoStatus`: previous-status caching, no-op fetch reuse via `unchangedRepos`, `gatherRepoStatus()`, and `--where` filtering. `runPlanFlow()` remains an orchestration primitive; it does not know command-specific assessment rules.

Additional building blocks for mutation commands: `finishSummary(parts, hasErrors)` in `render/render.ts` renders the final green/yellow summary line and throws `ArbError` when `hasErrors` is true. `confirmOrExit({ yes, message })` in `sync/mutation-flow.ts` handles the confirmation prompt or `--yes` skip. `skipCell(reason, skipFlag?)` and `upToDateCell()` in `render/plan-format.ts` produce standard plan-table cells for skipped and up-to-date repos. `dryRunNotice()` in `terminal/output.ts` prints the dry-run exit message.

**Classification check order.** Repo classifiers (`classify-integrate.ts`, `pull.ts`, `classify-retarget.ts`) follow a consistent check order: (1) blocker checks — fetch failed, operation in progress, detached HEAD, wrong branch; (2) state-availability checks — no base, no remote, already merged, target resolution; (3) up-to-date / nothing-to-do — the early return that avoids unnecessary skip messages; (4) dirty check — only reached when work is actually needed; (5) will-operate. This ordering ensures the user sees the most informative skip reason first. A dirty check that fires before up-to-date would misleadingly suggest `--autostash` for repos that don't need syncing.

When shared assessment logic accepts override options (e.g. `includeInProgress`, `includeWrongBranch`, `autostash`), every command that delegates to that logic must expose the corresponding flag to the user. Hardcoding an override to `false` without a CLI escape hatch means the user cannot recover from the skipped state without switching commands. When adding a new override parameter to shared logic, grep for all call sites and wire the flag through. When a new command delegates to existing shared logic, check the options interface for overrides that need CLI exposure.

### Mutation command flow

`runPlanFlow<TAssessment>(options)` in `sync/mutation-flow.ts` orchestrates the five-phase flow for all mutation commands: fetch → assess → format plan → confirm → execute. `PlanFlowOptions<TAssessment>` configures each phase — `assess` classifies repos, `formatPlan` renders the plan table, and the command's action handler runs execution and summarization after `runPlanFlow` returns. Reference implementations: `push.ts` for sync, `integrate.ts` for parameterized rebase/merge.

The optional `postAssess` callback runs after assessment, before plan formatting. It is the extension point for verbose commit gathering and conflict prediction. The verbose pattern: `postAssess` calls `getCommitsBetweenFull()`, slices to `VERBOSE_COMMIT_LIMIT` (from `sync/constants.ts`), and stores the result in the assessment's `verbose` field. The plan formatter then passes these to `verboseCommitsToNodes()` (from `render/status-verbose.ts`) via the `afterRow` property on `TableRow`, which the renderer appends after the corresponding table row. Six commands use this pattern identically.

### Parallel fetch, sequential mutations

Network I/O (fetching) runs in parallel for speed. State-changing git operations (push, pull, rebase, merge) run sequentially for predictable ordering, clear errors, and the ability to stop on first failure. `parallelFetch()` batches all network I/O upfront to avoid per-repo latency during the sequential phase. `pull` is excluded from the fetch flag system — `git pull` inherently fetches. Quiet mode (`-q`) on dashboard commands skips fetching by default for scripting speed.

### Output separation: stderr for UX, stdout for data

All human-facing output (progress, prompts, summaries, errors) goes to stderr. Only machine-parseable data goes to stdout. The `output.ts` module enforces this with `success`/`info`/`warn`/`error` helpers (stderr) and a separate `stdout` helper.

### Context validation guards

`requireWorkspace()` and `requireBranch()` validate context at the top of action handlers, exiting early with helpful messages before any work is done.

### Exception-based exit handling

Commands and library code never call `process.exit()` directly. They throw `ArbError` (exit 1) for errors or `ArbAbort` (exit 130) for user cancellations. A single try/catch in `index.ts` maps these to exit codes. Always call `error()` or `warn()` for user-facing output *before* throwing — the handler does not print the exception message, it only maps the type to an exit code.

Exception types:
- `ArbError` — error condition → `process.exit(1)`.
- `ArbAbort` — user cancellation (declined prompt, Ctrl-C during inquirer) → prints `info(err.message)` (default: "Aborted.") then `process.exit(130)`.

The only `process.exit()` calls live in `index.ts`: the top-level catch handler and the SIGINT signal handler. Signal handlers must call `process.exit()` directly because they cannot throw into an async context. See `decisions/0036-exception-based-exit-handling.md`.

### Declarative render model

Table output is built as a tree of `OutputNode` values (`render/model.ts`), then rendered to an ANSI string by `render()` in a single pass. This separates structure from presentation. `TableColumnDef` defines each column's `key`, `header`, optional `show` (data-driven visibility: `true`, `false`, or `"auto"`), `truncate` (width-driven value shortening with a `min` floor), and `align`. `Cell` carries both `plain` text (for width measurement) and styled `Span[]` (for ANSI rendering). Analysis functions in `render/analysis.ts` produce `Cell` values from `RepoStatus`; view builders like `buildStatusView()` assemble them into `TableNode`; `render()` resolves column widths, applies truncation if the table exceeds terminal width, and emits the final string. `height-fit.ts` handles vertical truncation when `maxLines` is provided (used by watch mode). `createRenderContext()` detects terminal width (`process.stdout.columns` → `COLUMNS` env → `undefined`) and TTY status.

### Phased rendering

Commands with `--fetch`/`--no-fetch` use `runPhasedRender` to show stale data instantly while a fetch runs in the background, then replace it with fresh data. The render-then-clear order ensures content is always visible — no blank gaps between phases. `reportFetchFailures` must be called after `runPhasedRender` completes, not inside a render callback. Dashboard commands (`status`, `list`) and `branch --verbose` support pressing Ctrl+C to cancel the background fetch and exit immediately with stale data on stdout. Dashboard commands use `preserveTypeahead: true` with `runPhasedRender` so characters typed during the fetch stay in the kernel input buffer and appear at the shell prompt after arb exits — echo is suppressed via `stty -echo noflsh` instead of raw mode. Mutation commands use the default raw-mode suppression. See `decisions/0039-two-phase-status-render.md`, `decisions/0041-render-then-clear-phased-rendering.md`, and `decisions/0085-preserve-typeahead-during-fetch.md`.

### Repo classification and remote validation

All repos must have valid, resolvable git remotes. `resolveRemotesMap()` resolves remote roles (base/share) and propagates errors with actionable fix instructions rather than silently degrading.

### Request-scoped GitCache

Commands create a `GitCache` instance and pass it to status and template functions. The cache stores Promises so concurrent callers coalesce onto the same in-flight git process. After a fetch, call `cache.invalidateAfterFetch()`. Low-level functions (`getRemoteNames`, `resolveRemotes`, `getRemoteUrl`, `getDefaultBranch`) should only be imported in `git-cache.ts` and test files. See `decisions/0044-request-scoped-git-cache.md`.

### Minimum Git version: 2.17

Arborist requires Git 2.17 or later, enforced by `assertMinimumGitVersion()` at the start of every command that creates a `GitCache`. The 2.17 floor is set by `worktree add --no-track` and `worktree remove`, which are fundamental to workspace creation and deletion.

New code must only use git features available in 2.17+. Features from newer versions require both:
1. **Version gating** — check `cache.getGitVersion()` and degrade gracefully or skip.
2. **Strong justification** — the feature must provide significant value that cannot be achieved with 2.17 primitives.

Current exceptions:
- **`worktree repair`** (2.30) — gated in `branch-rename.ts`; workspace directory rename is refused on older git with a warning.
- **`merge-tree --write-tree`** (2.38) — gated in `git.ts`; conflict prediction silently returns null.

When adding a new git feature above 2.17, document it in this list and write a decision record.

### Scripts (`scripts/`)

Files in `scripts/` are standalone Bun scripts that run outside the CLI runtime. They may use `console.log`/`console.error` and `process.exit()` directly — the exception-based exit handling convention applies only to `src/` code. Scripts should import pure logic from `src/lib/` where possible so that decision logic is unit-testable (e.g. `scripts/set-version.ts` delegates to `src/lib/core/version.ts`).

### Config format and validation

Workspace config (`.arbws/config.json`) and project config (`.arb/config.json`) are stored as JSON, validated at read/write time by Zod schemas in `core/config.ts`. Types are derived via `z.infer<>`, following the same pattern as JSON output schemas in `json-types.ts`. Legacy config files (old INI format or old `config` filename without `.json` extension) are auto-migrated on first read. See `decisions/0067-json-config-format.md`.

### In-progress state for partially-completing commands

Commands that can fail partway through sequential multi-repo execution carry explicit in-progress state in `.arbws/config.json`. This enables `--continue` (resume) and `--abort` (roll back), modeled after git's own rebase/merge-in-progress pattern. See `decisions/0025-rebranch-migration-state.md`.

### Git worktree directory layout

Linked worktrees (what arb creates) share the canonical repo's `.git/` directory but store per-worktree state in a dedicated entry:

- **Per-worktree** (`.git/worktrees/<entry>/`): `HEAD`, `index`, `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`, `rebase-merge/`, `rebase-apply/`
- **Shared** (`.git/` root): `objects/`, `refs/`, `logs/`, `packed-refs`, `config`, `info/`

The forward reference (worktree `.git` file → `gitdir: .../.git/worktrees/<entry>`) and backward reference (`.git/worktrees/<entry>/gitdir` → worktree path) are maintained by git. `readGitdirFromWorktree()` reads the forward reference; `clean.ts` handles repair of both directions. Any feature that watches or reads from the canonical `.git/` directory must account for this split — shared paths receive writes from all worktrees, not just the current one.

### Watch loop

`arb watch` in `terminal/watch-loop.ts` monitors two path categories per repo: the worktree working directory (with gitignore filtering, for dirty/untracked detection) and the canonical `.git/` directory (with a whitelist filter, for ref and state changes). The whitelist only passes `refs/`, `packed-refs`, and this worktree's own entry dir — see "Git worktree directory layout" above for why.

Debouncing uses leading + trailing edges: the first event after a quiet period triggers an immediate render; subsequent events within the burst are debounced (300ms trailing). After each render, a mute window of equal length suppresses events caused by the render's own git operations (e.g., `git status` touching `.git/index`). If events arrive during rendering, a dirty flag schedules a post-mute re-render. When a render completes with no pending events, the system returns to leading-edge mode. See `decisions/0094-leading-edge-debounce.md`. Suspended commands (full command flows triggered from watch) stop watchers → tear down stdin → run command → wait → resume watchers → re-render.

### Shell completion

Bash (`shell/arb.bash`) uses a manual `while` loop to find the subcommand, then dispatches to per-subcommand functions. Zsh (`shell/arb.zsh`) uses `_arguments -C -` with `*::arg:->args` for a two-level dispatch. The `-` flag is critical — it stops global option parsing at the first positional argument (the subcommand). Without it, subcommand-specific options like `-v` are rejected as unknown global options and completion silently fails. When adding a new command, add both a `__arb_complete_<cmd>` function in bash and a `case` entry under `args)` in zsh.

### Install scripts

`install.sh` and `uninstall.sh` have non-obvious invariants: the binary must be replaced via `rm` + `cp`, not overwrite-in-place — macOS caches code-signing verification per inode. The RC block (`.zshrc`/`.bashrc`) must be appended at the end of the file so arb's PATH entry wins over Homebrew. RC block removal must be positional (only lines adjacent to the marker) — global pattern matching can accidentally delete user lines. Both scripts share cleanup logic but are separate files; changes must be made in both.

---

## Commit Conventions

All commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint.

### Release-note types

Use `feat`, `fix`, or `perf` for changes included in release notes. These require a scope. Scope must be a single word, never comma-separated.

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

Use imperative mood ("add", "fix", "remove"), lowercase, no trailing period. The subject describes *what changed*, not implementation details:

- `feat(pull): add --reset flag to arb pull`
- `fix(branch): handle case-only branch renames on macOS`
- `perf(status): parallelize repo status gathering`
- `test(integration): add case-sensitivity filesystem tests`
- `refactor: implement auto-hide for table columns`

---

## Decision Records

The `decisions/` directory captures significant design and product decisions — context, options, chosen approach, and reasoning. Read relevant records before proposing changes to features they cover.

After implementing a feature involving a significant decision, distill a `decisions/NNNN-*.md` from the plan — strip implementation details, keep only context, options, decision, reasoning, and consequences. If the decision reveals a new enduring principle, add it to GUIDELINES.md and reference it from the record. See `decisions/README.md` for the template.

Existing decision files must never be modified. If a decision is revisited, write a new record referencing the original.
