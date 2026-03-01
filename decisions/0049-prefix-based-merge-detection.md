# Prefix-Based Merge Detection for Post-Merge Commits

Date: 2026-03-01

## Context

After a branch is merged (squash or regular), users sometimes add new commits to fix bugs or make follow-up changes. When they run `arb push`, the existing merge detection fails because: (1) the ancestor check fails since HEAD includes the new commit which isn't on main, (2) the squash patch-id check fails because the cumulative diff now includes the new commit's changes, and (3) the gating condition for squash detection requires `toPush === 0` or the remote branch to be gone, but with new unpushed commits `toPush > 0`. The push goes through unprotected, creating a branch that shares problematic history with main.

## Options

### Option A: Prefix-based detection

Extend `detectBranchMerged()` with a prefix loop that tries `HEAD~1`, `HEAD~2`, etc. If `HEAD~K` matches a merge/squash on main, the branch was merged with K new commits on top. Recovery via `arb rebase` replays only the new commits onto updated main using `git rebase --onto`.

- **Pros:** Works regardless of when the user adds new commits. No persistent state. Reuses existing detection and rebase --onto execution paths. Naturally provides the count of new commits for messaging.
- **Cons:** Adds git operations (up to ~10 per prefix iteration). Slightly more complex detection logic.

### Option B: Persistent merge state tracking

When `arb status` detects a merge, persist a flag in `.arbws/config`. On push, check the flag.

- **Pros:** Zero extra git cost at push time.
- **Cons:** Fundamentally fragile — the flag is only set when detection succeeds before new commits are added. If the user adds the fix before running `arb status`, the flag was never set and the push goes through unprotected. This fails for the exact scenario we're trying to protect against.

## Decision

Option A: prefix-based detection with rebase recovery.

## Reasoning

Option B's persistent state approach has a fatal flaw: it can only record merge status that was successfully detected in a prior run. The primary scenario — user adds commits after merge but before running any arb command — means the flag was never set. Option A works retroactively by examining the commit history at detection time, regardless of when the user added commits. The performance cost (~10 extra git operations worst case) only applies to repos with unpushed commits where full-range detection already failed, which is a narrow condition.

## Consequences

- `detectBranchMerged()` now accepts a `prefixLimit` parameter; existing callers default to 0 (no prefix search).
- `MergeDetectionResult` gains a `newCommitsAfterMerge` field for downstream messaging.
- Push assessment uses a new `merged-new-work` skip flag (yellow, not benign) distinct from `already-merged` (dim, benign).
- `arb rebase` automatically detects and handles the "merged + new work" state without any new flags — it reuses the `retargetFrom`/`retargetTo` execution path with `git rebase --onto`.
- The prefix limit is capped at `min(toPush, 10)` to bound worst-case git operations.
- If a user has more than 10 new commits after merge, detection won't trigger. This is acceptable — 10+ commits after a merged branch is an unusual workflow that likely warrants manual intervention.
