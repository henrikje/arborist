# Create aborts on worktree failure

Date: 2026-03-06

## Context

`arb create` creates a workspace directory and config before attempting to add worktrees for each selected repo. When a worktree fails — typically because the branch is already checked out in another workspace — the workspace was still created, potentially with zero repos. This left behind a broken workspace that `arb status` reported as empty. The raw git error ("fatal: 'branch' is already used by worktree at '/path'") also did not help the user understand which workspace held the branch.

## Options

### Abort on any failure and roll back

If any repo fails to attach during `arb create`, undo all successfully created worktrees and branches, remove the workspace directory, and exit with an error. The user gets no workspace rather than a partial one.

- **Pros:** No broken or confusing partial workspaces. Aligns with safety-first principle. Clear feedback — either the workspace was created or it wasn't.
- **Cons:** A single failing repo blocks creation even if the user only cares about the others. Rollback adds complexity.

### Partial success (previous behavior)

Create the workspace even when some repos fail. Report failures but proceed with whatever succeeded.

- **Pros:** The user gets something even if not everything worked. No rollback logic needed.
- **Cons:** Leaves workspaces in a confusing state — some repos on the branch, others not. A workspace with zero repos is broken. The user must manually clean up with `arb delete`.

### Abort only when all repos fail

Keep partial success but abort when no repos were attached at all.

- **Pros:** Avoids the worst case (empty workspace) while still allowing partial results.
- **Cons:** Still produces the confusing partial state. A workspace where repo-a is on branch X locally but another workspace holds branch X for repo-b is hard to reason about.

## Decision

Abort on any failure and roll back. The `attach` command retains its existing partial-failure tolerance for cases where the user wants to add repos individually to an existing workspace.

## Reasoning

A workspace is a coherent unit — all repos on the same feature branch. A partial workspace where the branch assignment is split across multiple workspaces undermines this coherence and confuses both the user and downstream commands like `arb status`, `arb push`, and `arb rebase`. The safety-first principle (GUIDELINES.md) favors refusing the operation and explaining why over silently producing a degraded result. The `attach` command provides an escape hatch for users who genuinely want partial attachment.

## Consequences

- `arb create` is now atomic: either all repos attach or none do.
- Users who hit a branch conflict get a clear error naming the conflicting workspace, rather than a broken workspace they must manually delete.
- Rollback must correctly undo worktrees and newly created branches without touching pre-existing branches. The `createdBranches` field in `AddWorktreesResult` tracks this distinction.
- If rollback itself fails (e.g. process killed), stale worktree entries may remain. `arb clean` already handles this case.
