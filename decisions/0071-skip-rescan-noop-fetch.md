# Skip Re-Scan for Repos with No-Op Fetches

Date: 2026-03-12

## Context

Eight commands use two-phase rendering: scan all repos, show stale output immediately, fetch in background, then re-scan and replace with fresh output. The second scan repeats 4-15 git process spawns per repo even when the fetch brought no changes for that repo. With 19 repos and ~10 git calls each, the redundant second scan adds ~190 unnecessary processes in the common case where most repos are unchanged.

The `FetchResult.output` from `parallelFetch` is the stderr of `git fetch --prune`. When no refs changed, output is empty. When refs are updated, output contains lines like `abc..def main -> origin/main`. This is a reliable, conservative signal: empty output guarantees no remote ref changes occurred.

## Options

### Per-repo no-op detection

After fetch completes, check each repo's `FetchResult`. Repos with empty output and exitCode 0 reuse their phase-1 results. Only repos that received remote changes are re-scanned.

- **Pros:** Simple. High impact in common case (most repos unchanged). No stale data risk — phase-1 results are valid because remote refs didn't change. Conservative — false positives (unnecessary re-scans) are possible, false negatives (missed changes) are not.
- **Cons:** No savings when all repos have remote changes. Does not reduce work within a re-scanned repo.

### Extended GitCache for local operations

Cache fetch-independent git operations (`git status --porcelain`, `symbolic-ref`, `isShallowRepo`, etc.) inside `GitCache`. After fetch invalidation, only remote-dependent operations are re-executed.

- **Pros:** Reduces work even for repos that received changes.
- **Cons:** Caching working-tree state changes the GitCache contract (decision 0044 scopes it to stable remote-resolution queries). Requires 6-8 new cache maps with heterogeneous types. Marginal gain over per-repo detection (~4 cached vs ~6+ uncached calls per changed repo). Risk of stale local data if user edits files during the fetch window.

## Decision

Per-repo no-op detection. For `status` and `branch --verbose`, pass a `previousResults` map to `gatherWorkspaceSummary`. For mutation commands (push, pull, rebase, merge, reset, rename), pass an `unchangedRepos` set to the `assess` callback via `runPlanFlow`.

Additionally, track `git remote set-head --auto` changes in `parallelFetch`: if set-head updates the remote HEAD pointer (rare — requires a default-branch rename with no other ref changes), include that change in `FetchResult.output` so the repo is correctly re-scanned.

## Reasoning

The per-repo approach follows the "prefer simple solutions" guideline. In typical development, the vast majority of repos are unchanged between fetches. Skipping re-scans for unchanged repos eliminates 80-100% of redundant git calls with minimal code changes and no architectural risk. The extended cache approach would require changing GitCache's design contract for marginal additional benefit.

The `unchangedRepos` parameter on the `assess` callback keeps assessment logic in each command (rather than having `runPlanFlow` assume assessment structure), and the empty set on phase 1 makes the optimization transparent — commands that don't use it simply ignore the parameter.

## Consequences

- Phase-2 scanning is proportional to the number of repos that actually received remote changes, not the total workspace size.
- `gatherWorkspaceSummary` accepts an optional `previousResults` map — repos in the map skip `gatherRepoStatus` entirely.
- `runPlanFlow`'s `assess` callback gains an `unchangedRepos: Set<string>` parameter. Phase 1 passes an empty set; phase 2 passes the actual unchanged set.
- `parallelFetch` now runs `set-head --auto` before recording `FetchResult`, comparing before/after to detect remote HEAD changes.
