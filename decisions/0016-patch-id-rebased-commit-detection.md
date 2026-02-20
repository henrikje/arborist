# Patch-ID Rebased Commit Detection

Date: 2026-02-19

## Context

After rebasing a feature branch onto main, arb commands showed misleading push/pull counts. `arb status` said "3 to push, 2 to pull", `arb push` said "3 commits to push (force — 2 behind origin)", and `arb pull` offered to pull commits already present locally in rebased form. Git creates new commits with new hashes but identical diff content when rebasing, so `git rev-list --left-right --count` sees divergence on both sides, producing alarming numbers.

## Options

### Patch-ID based detection
Use `git patch-id --stable` to compute content-based hashes for commits on both sides of the divergence. Matching patch-ids mean the same change exists with different commit hashes — the definition of a rebased commit.
- **Pros:** Compares actual diff content, ignoring metadata (hash, date, message). Handles interactive rebase with `--reword` (message changes, content doesn't). No false positives from unrelated commits with identical subjects. The canonical git mechanism for this (used internally by `git cherry`, `git rebase --skip`). Follows the `predictMergeConflict()` pattern of nullable return for graceful degradation.
- **Cons:** Runs `git log -p` piped through `git patch-id` — more expensive than message matching. Only runs for diverged repos (both toPush > 0 and toPull > 0), so the cost is targeted.

### Commit message matching
Compare commit subjects between the two sides to identify likely rebased commits.
- **Pros:** Simpler to implement. Faster (no diff computation).
- **Cons:** False positives from unrelated commits with identical subjects. Misses interactive rebase with `--reword`. Not the canonical git mechanism for this purpose.

## Decision

Patch-ID based detection. Show net-new commit counts in status, push, and pull displays. "Rebased" is always default color (never yellow) — it's informational, not urgent.

## Reasoning

Patch-id is the right tool: it compares actual diff content, which is exactly what rebasing preserves. The git project itself uses patch-id for this purpose in `git cherry` and `git rebase --skip`. The cost is acceptable because detection only runs for diverged repos — the common case (no divergence) is free.

The display treatment is the more impactful decision. Instead of "3 to push, 2 to pull" (alarming), the user sees "1 to push, 2 rebased" (clear). The net-new count subtracts rebased commits from push counts: `newPush = toPush - rebased`. When all unpushed commits are rebased, the display shows just "2 rebased" with no yellow coloring — because the content exists on the remote, only the hashes differ. A force push will reconcile them.

The "rebased" label is deliberately never yellow across all commands (status, list, push, pull, remove). Yellow means "needs attention or action." Rebased is informational — the work is safe, it just needs a force push to clean up. This distinction follows the three-tier color scheme: green (success), yellow (needs attention), default (informational).

Pull behavior changes: when all to-pull commits are rebased locally, the repo is skipped with "rebased locally (push --force instead)" — pulling would undo the rebase.

## Consequences

Rebased commit counts appear in `arb status` (SHARE column), `arb status -v` (per-commit annotations), `arb push` (plan display), `arb pull` (skip or annotate), `arb list` (summary), and `arb remove` (summary). The `rebased` field on `RepoStatus.share` extends the canonical status model. Safety semantics are unchanged: rebased repos are still considered unsafe for removal since the rebased versions only exist locally.
