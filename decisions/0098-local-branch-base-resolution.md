# Local branch base resolution for workspace stacking

Date: 2026-03-27

Revisits: 0089-branch-model-flexibility-analysis.md (local-only base branch option)

## Context

When workspace Y stacks on workspace X, Y's configured base branch is X's branch name. DR-0089 decided that base branches should resolve against remote refs only, citing the visibility principle: local refs change implicitly when other worktrees commit. The recommended workflow was to push the base workspace first.

In practice, this creates friction. The base workspace must be pushed before the stacked workspace can see correct ahead/behind counts — and once pushed, the stacked workspace only sees updates after fetching. When both workspaces are yours and you're actively working across them, staleness is the surprise, not liveness.

The question: can base branches resolve against local refs for workspace branches, without violating the principles that DR-0089 was protecting?

## Options

### Remote-only (status quo)
Keep DR-0089's decision. Base branches always resolve against remote refs.

- **Pros:** Simple. Fetch-gated visibility is predictable.
- **Cons:** Wrong ahead/behind counts for unpushed stacked bases. Counts stale even after push (until fetch). The "push first" requirement is friction.

### Local fallback
Use the local ref only when the remote ref doesn't exist. Once the base workspace pushes, resolution switches back to remote.

- **Pros:** Fixes the unpushed case. Minimal change.
- **Cons:** Live-update behavior disappears on push — exactly when the user starts actively working across both workspaces.

### Local-primary for workspace branches
When the configured base branch is checked out in a linked worktree (a workspace exists for it), use the local ref as primary for ahead/behind. Remote ref still used for merge detection.

- **Pros:** Live accuracy persists after push. Predictable: base state changes only when the user takes action in the base workspace. No heuristics.
- **Cons:** Ahead/behind change without fetch (when the base workspace commits). One additional `git worktree list` call per repo (cacheable).

## Decision

Local-primary for workspace branches, using `branchIsInWorktree` as the distinguishing check.

## Reasoning

The visibility principle from DR-0089 assumed that implicit ref changes are always undesirable. But for workspace branches, the user owns both sides. The base workspace's state IS the base — not an approximation that should be frozen until fetch. The user commits in the base workspace; the stacked workspace reflects that. This is analogous to how git itself treats worktrees: they share the ref store because they are views of the same repository.

The `branchIsInWorktree` check correctly distinguishes workspace branches (actively maintained, local ref moves on commit) from stale local branches (leftover from deleted workspaces, or `main` from the clone). A dormant `main` workspace is still a workspace — its local state is what the user has, and they can pull to update it.

Remote refs are still used for merge detection because squash merges happen on GitHub — the squash commit exists on the remote ref, not the local ref until the base workspace pulls.

## Consequences

Base resolution order changes from "remote → default fallback" to "local+worktree → remote → default fallback." The `resolvedVia` field on the base status model indicates which ref was used. A `sourceWorkspace` field identifies which workspace has the base branch. The `baseRef()` helper respects `resolvedVia` so consumers get the correct ref for git commands.

The GUIDELINES.md "One workspace, one branch" principle is updated to reflect that base branches resolve against local refs when a workspace exists for the branch.

The `baseMergedIntoDefault` detection has a new code path for locally-resolved bases whose remote branch was deleted (squash-merge-and-delete scenario).

Follow-up opportunity: `arb retarget` can follow the stack chain via `sourceWorkspace` to find the correct ancestor base when an intermediate base is merged.
