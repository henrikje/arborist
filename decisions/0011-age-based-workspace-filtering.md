# Age-Based Workspace Filtering

Date: 2026-03-10

## Context

A user wanted a way to delete workspaces that hadn't been touched in a long time — "abandoned" workspaces — regardless of their dirty/clean status. Dirty-but-old changes are effectively abandoned and safe to discard. New workspaces should not be deleted even if merged and clean, since the user might want to revisit them or review Claude conversation history.

The existing `--where` filter system supports boolean status flags (dirty, gone, merged, etc.) but not quantitative thresholds. "Old" is not a boolean: it requires a duration threshold. Two design questions arose: (1) how to express age as a filter, and (2) what "last modified" means for a workspace.

## Options

### Extend `--where` with parameterized age terms

Add terms like `older-than:30d` to the `--where` syntax. The parser would need to distinguish boolean terms from value-carrying terms.

- **Pros:** Single unified filter syntax.
- **Cons:** `FILTER_TERMS` is a flat `Record<string, (f: RepoFlags) => boolean>` — age is workspace-level, not per-repo. Supporting it would require threading workspace context through `repoMatchesWhere()` or a parallel filter concept. Invasive changes to a heavily-used API, with proportionally little benefit.

### Dedicated `--older-than` / `--newer-than` flags

Separate age-based options that accept duration strings (`30d`, `2w`, `3m`, `1y`), processed independently of `--where` and composed via AND.

- **Pros:** Clean separation of concerns — boolean repo state vs. quantitative workspace age. No changes to the `--where` parsing or `RepoFlags` model. Composable with `--where`. Reads naturally: `arb delete --older-than 90d`.
- **Cons:** Adds two new options per command; feels like a parallel system.

## Decision

Dedicated `--older-than` / `--newer-than` flags (Option B). The `--where` system is intentionally designed around per-repo boolean state; age is fundamentally different.

## Reasoning

The `--where` system's key invariant is `(flags: RepoFlags) => boolean` — pure functions over per-repo state. Age doesn't fit that model: it's a workspace-level aggregate with a user-supplied threshold. Forcing it in would require either adding a synthetic "is_old" flag (confusing, threshold-dependent) or redesigning the filter evaluation pipeline (invasive, high blast radius).

Dedicated flags follow a common CLI convention for range-based filtering, and are composable with `--where` at the command level rather than the expression level — which is where the composition naturally belongs. The symmetry `--older-than`/`--newer-than` mirrors the mental model of "find workspaces in a time range."

## Consequences

`resolveAgeFilter()` and `matchesAge()` live alongside `resolveWhereFilter()` and `workspaceMatchesWhere()` in `status.ts`. Commands that support age filtering call both independently and AND their results. Other multi-workspace commands (`exec`, `detach`, etc.) can adopt the pattern trivially. The `--where` parser is unchanged.

---

# What "Last Modified" Means

Date: 2026-03-10

## Context

The original `lastCommit` field (HEAD commit author date) was used for the LAST COMMIT display column. For age filtering, `lastCommit` is insufficient: it misses (1) source files edited but not yet committed, and (2) work done in git-ignored workspace-level directories such as `.claude/` (Claude conversation history, plans, notes). A workspace in active use might not have a recent commit but still has recent file activity.

## Options

### Last commit date only

Use `lastCommit` (already available on `WorkspaceSummary`).

- **Pros:** Zero additional cost. Already computed.
- **Cons:** Misses uncommitted edits and all git-ignored work. A workspace with 2 months of uncommitted coding effort would be misclassified as "old."

### `max(lastCommit, git index mtime)`

Read the `.git/index` file's mtime per repo (updated by `git add` and checkout).

- **Pros:** Cheap (one `stat()` per repo). Captures staged work.
- **Cons:** Misses unstaged source edits and all workspace-level git-ignored directories including `.claude/`.

### Filesystem mtime scan (two-phase)

**Phase A**: recursively stat all non-repo items in `<wsDir>/` (e.g. `.claude/`, `.arbws/`, notes). These are always small and contain no build artifacts. **Phase B**: per repo, use `git ls-files --cached --others --exclude-standard` to enumerate relevant files and stat each. This respects `.gitignore` (skips `node_modules`, `dist`, etc.) without a hardcoded exclusion list.

- **Pros:** Captures all meaningful activity: committed work, staged work, unstaged source edits, and git-ignored workspace-level files (`.claude/`, `.arbws/`). Principled: `.gitignore` is the developer's own signal for "generated content."
- **Cons:** More expensive than commit-date-only: one `git ls-files` subprocess per repo. Must be opt-in to avoid slowing down all `arb list` calls.

### Hardcoded artifact directory skip list

Walk the entire workspace tree, skipping dirs named `node_modules`, `dist`, `build`, etc.

- **Pros:** Simple.
- **Cons:** Arbitrary: misses language/framework-specific artifact dirs (`_build/` in Elixir, `vendor/` in Go, etc.). No principled stopping point.

## Decision

Two-phase filesystem mtime scan (Option C), computed opt-in. The existing `workspaceRepoDirs()` function already distinguishes repo dirs from non-repo dirs, making the split natural. Phase B uses `git ls-files` to leverage the project's own `.gitignore` for exclusions.

## Reasoning

The primary use case is "don't accidentally delete workspaces I'm actively working on." That requires capturing unstaged edits and Claude conversation history — neither of which `lastCommit` or index mtime alone provides.

The two-phase split follows directly from the arborist workspace model: non-repo items at `<wsDir>/` are always small (no build systems run there), so they can be scanned completely. Repo dirs need scoping via `.gitignore` to avoid scanning `node_modules`. Using `git ls-files --others --exclude-standard` for Phase B avoids a hardcoded exclusion list and instead uses the developer's own signal for what's generated content.

The opt-in `{ gatherActivity?: boolean }` option on `gatherWorkspaceSummary()` ensures zero cost for all existing commands that don't need age filtering. Per-repo `lastActivity` is populated as a byproduct of the workspace scan, making future per-repo age filtering (e.g., in `arb status`) trivial to enable.

## Consequences

`getWorkspaceActivityDate()` and `getRepoActivityDate()` live in `src/lib/workspace/activity.ts`. `WorkspaceSummary.lastActivity` and `RepoStatus.lastActivity` are `string | null`, populated only when the caller passes `{ gatherActivity: true }`. The LAST COMMIT display column is unchanged — `lastCommit` remains the value shown in the table; `lastActivity` is used exclusively for age filtering. Commands that use age filtering must pass `gatherActivity: true`, making the cost visible at the call site. Claude conversations inside a repo (git-ignored within a worktree) are not captured, but the common case — `.claude/` at the workspace root — is fully covered by Phase A.
