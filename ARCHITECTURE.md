# ARCHITECTURE.md

Technical patterns and development conventions for the Arborist codebase.

---

## Architectural Patterns

### Canonical status model

`status.ts` is the single source of truth for repository state. `RepoStatus` is a 5-section model (identity, local, base, share, operation). `RepoFlags` computes independent boolean flags from that model. Named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) group flags by concern. Shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`, `flagLabels`) derive decisions and display text.

Every command that needs to understand repo state must work from `RepoStatus` and `RepoFlags` — never invent local representations or ad-hoc git queries. When adding a new concept, extend the model in `status.ts` so every consumer benefits:

1. Add the observation to `RepoStatus` if it's raw git state.
2. Add a flag to `RepoFlags` if it represents a condition that needs attention.
3. Add the flag to `computeFlags()` and the label to `FLAG_LABELS`.
4. All existing consumers (status display, list aggregation, remove safety checks, etc.) automatically pick it up through `isAtRisk()` and `flagLabels()`.

Commands must use shared functions (`isAtRisk`, `wouldLoseWork`, `flagLabels`) rather than re-deriving conclusions from raw flags — this keeps evaluation logic centralized. `resolveWhereFilter()` handles `--dirty`/`--where` option validation and resolution; `repoMatchesWhere()` tests a `RepoFlags` against a parsed filter expression.

**Remote roles terminology.** The two remote roles are `base` (integration) and `share` (sharing), defined in `RepoRemotes`. The corresponding status sections are `base` and `share` in `RepoStatus`. The user-facing column headers are `BASE` and `SHARE`. Flag labels are `behind base` and `behind share`. Note: the git remote *name* may still be `"upstream"` (a fork workflow convention), but the *role* in code is always `base`.

### Shared library composition

Commands compose small, focused library functions rather than inheriting from base classes. `integrate.ts` demonstrates how to parameterize shared logic: rebase and merge share the exact same five-phase flow, differing only in the git subcommand and verb strings.

### Parallel fetch, sequential mutations

Network I/O (fetching) runs in parallel for speed. State-changing git operations (push, pull, rebase, merge) run sequentially for predictable ordering, clear errors, and the ability to stop on first failure. `parallelFetch()` batches all network I/O upfront to avoid per-repo latency during the sequential phase. `pull` is excluded from the fetch flag system — `git pull` inherently fetches. Quiet mode (`-q`) on dashboard commands skips fetching by default for scripting speed.

### Output separation: stderr for UX, stdout for data

All human-facing output (progress, prompts, summaries, errors) goes to stderr. Only machine-parseable data goes to stdout. The `output.ts` module enforces this with `success`/`info`/`warn`/`error` helpers (stderr) and a separate `stdout` helper.

### Detail sections

Supplementary information that follows main per-repo output — verbose commit/file detail in `arb status --verbose`, template drift warnings in `arb delete`, unknown template variable warnings in `arb template apply` and `arb template list`.

A detail section is a labeled, indented block of related items appearing between per-repo results and the summary line, set apart by blank lines:

- **Header**: 6-space indent (`SECTION_INDENT`) + descriptive label (yellow for warnings, dim for neutral). Ends with `:\n`.
- **Items**: 10-space indent (`ITEM_INDENT`) + one line per item.
- **Spacing**: blank line before the header. No trailing blank line — the caller provides the final separator.

`SECTION_INDENT` and `ITEM_INDENT` are defined in `status-verbose.ts`; `displayTemplateDiffs` and `displayUnknownVariables` in `templates.ts` use the same literal values.

When to use: any supplementary list (commits, files, variables, warnings) below the main table or per-repo output. When not to use: inline per-repo annotations (use the `[repo] result` line pattern) or top-level error messages (use `warn()` / `error()`).

### Context validation guards

`requireWorkspace()` and `requireBranch()` validate context at the top of action handlers, exiting early with helpful messages before any work is done.

### Exception-based exit handling

Commands and library code never call `process.exit()` directly. They throw `ArbError` (exit 1) for errors or `ArbAbort` (exit 130) for user cancellations. A single try/catch in `index.ts` maps these to exit codes. Always call `error()` or `warn()` for user-facing output *before* throwing — the handler does not print the exception message, it only maps the type to an exit code.

Exception types:
- `ArbError` — error condition → `process.exit(1)`.
- `ArbAbort` — user cancellation (declined prompt, Ctrl-C during inquirer) → prints `info(err.message)` (default: "Aborted.") then `process.exit(130)`.

The only `process.exit()` calls live in `index.ts`: the top-level catch handler and the SIGINT signal handler. Signal handlers must call `process.exit()` directly because they cannot throw into an async context. See `decisions/0036-exception-based-exit-handling.md`.

### Phased rendering

Commands with `--fetch`/`--no-fetch` use `runPhasedRender` to show stale data instantly while a fetch runs in the background, then replace it with fresh data. The render-then-clear order ensures content is always visible — no blank gaps between phases. `reportFetchFailures` must be called after `runPhasedRender` completes, not inside a render callback. Dashboard commands (`status`, `list`) and `branch --verbose` support pressing Escape to cancel the background fetch and exit immediately with stale data on stdout. The keypress listener (`listenForAbortKeypress`) is a no-op when stdin is not a TTY. See `decisions/0039-two-phase-status-render.md`, `decisions/0041-render-then-clear-phased-rendering.md`, and `decisions/0047-escape-to-cancel-background-fetch.md`.

### Repo classification and remote validation

All repos must have valid, resolvable git remotes. `resolveRemotesMap()` resolves remote roles (base/share) and propagates errors with actionable fix instructions rather than silently degrading.

### Request-scoped GitCache

Commands create a `GitCache` instance and pass it to status and template functions. The cache stores Promises so concurrent callers coalesce onto the same in-flight git process. After a fetch, call `cache.invalidateAfterFetch()`. Low-level functions (`getRemoteNames`, `resolveRemotes`, `getRemoteUrl`, `getDefaultBranch`) should only be imported in `git-cache.ts` and test files. See `decisions/0044-request-scoped-git-cache.md`.

### In-progress state for partially-completing commands

Commands that can fail partway through sequential multi-repo execution carry explicit in-progress state in `.arbws/config`. This enables `--continue` (resume) and `--abort` (roll back), modeled after git's own rebase/merge-in-progress pattern. See `decisions/0025-rebranch-migration-state.md`.

---

## Decision Records

The `decisions/` directory captures significant design and product decisions — context, options, chosen approach, and reasoning. Read relevant records before proposing changes to features they cover.

After implementing a feature involving a significant decision, distill a `decisions/NNNN-*.md` from the plan — strip implementation details, keep only context, options, decision, reasoning, and consequences. If the decision reveals a new enduring principle, add it to GUIDELINES.md and reference it from the record. See `decisions/README.md` for the template.

Existing decision files must never be modified. If a decision is revisited, write a new record referencing the original.
