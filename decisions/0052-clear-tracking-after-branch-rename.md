# Clear Tracking Config After Branch Rename

Date: 2026-03-02

## Context

After `arb branch rename old new`, `git branch -m` preserves tracking config: `branch.<new>.merge` still points to `refs/heads/<old>`. This causes `@{upstream}` to resolve to `origin/<old>`, and since `origin/<old>` still exists, `arb status` and `arb push` compare against the stale ref and report "up to date" even though `origin/<new>` doesn't exist yet.

The user's expected workflow is: rename the branch, then `arb push` to publish the new name. But the stale tracking makes push think there's nothing to do.

## Options

### Clear tracking after rename
After `git branch -m`, unset `branch.<new>.remote` and `branch.<new>.merge`. Status falls through to `refMode: "noRef"`, and push treats the branch as new.
- **Pros:** Minimal change (two `git config --unset` calls). Follows existing design: rename is local, push is remote. No new flags or error recovery paths.
- **Cons:** Two-step workflow (rename + push). Old remote branch persists unless user adds `--delete-remote`.

### Auto-rename remote during rename
Push new name + delete old name during `arb branch rename`, either by default or via `--rename-remote`.
- **Pros:** One-step workflow for the common case.
- **Cons:** Violates "do one thing" — rename becomes a push + delete operation. Duplicates push's assessment logic. The `--abort` mechanism does not touch remotes (decision 0025). Error recovery for partial remote failures would be complex.

### Detect stale tracking in status
Teach status to compare `branch.<name>.merge` against the actual branch name and correct the comparison target.
- **Pros:** No changes to the rename command.
- **Cons:** Workaround that masks wrong state rather than fixing it. Every status consumer would need to handle this edge case.

## Decision

Clear tracking config after `git branch -m`. Two `git config --unset` calls after each successful rename. Also clear stale tracking for repos that are already on the new branch (the `--continue` path).

## Reasoning

The design intent (decision 0025) is that rename handles local state and push handles remote state. The bug was that stale tracking broke the handoff. Clearing tracking restores the intended separation: `arb push` sees `refMode: "noRef"`, treats the branch as new, pushes with `-u`, and sets correct tracking.

The plan display now shows `origin/<old> → run 'arb push' after rename` instead of the previous `--delete-remote` hint, guiding users toward the natural next step.

## Consequences

After `arb branch rename`, `arb status` shows the branch with "N to push" in the SHARE column. `arb push` pushes the new name and sets correct tracking. The `--delete-remote` flag remains for cleaning up the old remote branch during rename. The two-step workflow (rename + push) matches git's own model where branch rename is local and publishing is a separate operation.
