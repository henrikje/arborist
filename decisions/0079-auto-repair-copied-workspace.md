# Auto-Repair Copied Workspaces

Date: 2026-03-15

## Context

When a user copies a workspace directory (`cp -r ws-a ws-b`), all `.git` worktree reference files in the copy point to the same canonical worktree entries as the original. `detectSharedWorktreeEntries` (DR-0058) already detects this and removes the stale `.git` files, but the user must then manually run `arb attach <repo>` for each repo. Since copy-and-rename is a natural operation (especially for creating similar workspaces), this manual step is friction that arborist can eliminate.

The challenge: the copied workspace's `.arbws/config.json` still references the original branch, which is already checked out in the original workspace. Git forbids two worktrees on the same branch. A new branch is needed.

## Options

### Manual attach (status quo)

Remove stale `.git` files and tell the user to run `arb attach`.

- **Pros:** Simple, no assumptions about user intent.
- **Cons:** Extra manual step every time. User must also update the config branch.

### Auto-repair with branch derived from workspace name

After removing stale `.git` files, if the workspace directory name differs from the configured branch (indicating a copy-and-rename), automatically create worktrees on a new branch matching the workspace name.

- **Pros:** Zero-friction. Consistent with arborist's convention that workspace name = branch name. Files preserved as uncommitted changes via the temp-worktree transplant pattern (DR-0062).
- **Cons:** Assumes the user wants a branch named after the workspace directory. Only works when workspace name != config branch.

### Auto-repair with interactive branch prompt

Prompt the user for a new branch name when a copy is detected.

- **Pros:** User controls the branch name.
- **Cons:** Repair runs in `requireWorkspace()` which gates every command. Interactive prompts in a guard function break non-TTY contexts and violate the principle that guards validate quickly.

## Decision

Auto-repair with branch derived from workspace name. When ALL repos in a workspace have stale shared-entry references and the workspace directory name differs from the configured branch, automatically create new worktrees on a branch matching the workspace name (forked from the original branch) and update the config.

## Reasoning

The workspace name = branch name convention is strong in arborist (it's the default for `arb create`). When someone copies `feature-a/` to `feature-b/`, the intent to work on branch `feature-b` is clear. The "detect, warn, and protect" principle (GUIDELINES.md) calls for proactive recovery when the intent is unambiguous. The repair is safe: files are preserved via the same temp-worktree transplant that DR-0062 established, and if any repo fails, the entire repair is rolled back to maintain consistency.

The guard for wsName == oldBranch (copy without rename) ensures we only act when the intent is clear. In that ambiguous case, the user gets the existing manual-attach message.

## Consequences

- `cp -r ws-a ws-b` followed by any arb command in `ws-b` now works automatically.
- The repair runs synchronously using `Bun.spawnSync` (matching `repairWorktreeRefs` and `repairProjectMove`).
- If the derived branch already exists locally (from a previous partial repair), the repair attaches to it instead of creating a new one.
- When workspace name == config branch, no auto-repair is attempted and the existing manual-attach message is shown.
- All-or-nothing: if any repo fails, all repairs are rolled back so the user gets consistent guidance.
