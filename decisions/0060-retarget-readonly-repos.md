# Retarget With Readonly Repos

Date: 2026-03-06

## Context

Workspaces often include "readonly" repos — repos that are part of the workspace but don't participate in the branch stack. These repos don't have the stack's base branch on their remote. When retargeting to a new base, the all-or-nothing gate (from decision 0017) blocked the entire operation because these repos couldn't find the target branch. Additionally, after a forced single-repo retarget, the workspace-level config applied the new base to all repos, causing readonly repos to falsely report "base merged" in status.

The false positive occurred because the configured base branch existed as a local ref (from another workspace's worktree in the shared git directory) and `detectBranchMerged` found it reachable from main — which is always true for worktree branches created from main.

## Options

### Exclude retarget-target-not-found from blockers + worktree heuristic
Repos where the target branch doesn't exist on their remote are non-participants, not blockers. For the "base merged" false positive, use `git for-each-ref --format='%(worktreepath)'` to detect whether a local branch is checked out in a worktree — if it is, it's an arb-managed workspace branch, not a leftover from a merged feature.
- **Pros:** Preserves "base merged" detection for legitimate merged-and-deleted bases. Minimal change to config model. Readonly repos are transparently handled.
- **Cons:** Edge case: if the base branch is also a workspace branch, detection is skipped. Adds one extra git call per repo during status when base fell back.

### Skip merge detection entirely when base fell back
When the configured base doesn't exist on the remote (`fellBack = true`), skip stacked merge detection regardless of local branch state.
- **Pros:** Simpler implementation, no worktree check needed.
- **Cons:** Loses "base merged" detection for all fell-back repos, including the legitimate case where a base was merged and deleted from the remote. Status shows "not found" instead of the more informative "base merged".

### Per-repo base overrides in workspace config
Extend `.arbws/config` to support per-repo base settings.
- **Pros:** Clean per-repo semantics, solves both issues completely.
- **Cons:** Significant scope — new config schema, touches config/status/sync/render layers. Over-engineered for this use case.

## Decision

Exclude `retarget-target-not-found` from blockers, with a worktree-based heuristic for merge detection. The workspace config remains workspace-level with no per-repo overrides.

## Reasoning

The all-or-nothing gate from decision 0017 was designed for the case where "if the base is gone for one repo, it's gone for all" — but explicit retarget (`--retarget <branch>`) targets a branch that may only exist in a subset of repos. Blocking the operation entirely for repos that don't have the target is unhelpful; these repos are shown as "skipped" in the plan and don't need to also produce an error.

The worktree heuristic reliably distinguishes the two cases because of arb's architecture: in the false-positive case, the local branch exists because a worktree is checked out on it (another workspace). In the legitimate merged-and-deleted case, the local branch is NOT in a worktree (canonical repos are detached, workspaces use feature branches, not base branches). This preserves the "detect, warn, and protect" principle from GUIDELINES.md while fixing the false positive.

A new check ensures that if the target branch doesn't exist on ANY repo's remote, the retarget still fails with a clear error — preventing silent no-ops.

## Consequences

Repos where the retarget target doesn't exist on their remote are non-participants: they are skipped without blocking. The workspace config is updated for the whole workspace; repos that can't use the configured base fall back to default. Status correctly shows "not found" for readonly repos and "base merged" for legitimately merged bases (unless the base branch is also a workspace branch, in which case it shows "not found" — an acceptable tradeoff since the rebase flow independently detects gone bases).
