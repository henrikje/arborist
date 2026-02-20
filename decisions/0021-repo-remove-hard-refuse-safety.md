# Repo Remove Hard-Refuse Safety

Date: 2026-02-20

## Context

There was no way to remove a canonical repo once cloned — the user had to manually `rm -rf .arb/repos/<name>` and remember to also clean up `.arb/templates/repos/<name>`. Adding `arb repo remove` required deciding what happens when workspaces still reference the repo. The constraint: both `arb drop` and `arb remove` call `git()` with `cwd` set to the canonical repo directory. If the canonical repo is deleted while workspaces still reference it, these commands crash with unhandled exceptions (`Bun.spawn` throws when `cwd` doesn't exist), leaving the system in a broken state where normal cleanup commands fail.

## Options

### Hard refuse when in use
If any workspace has a worktree linked to the repo, refuse removal with a clear error listing the affected workspaces and remediation steps. No `--force` escape. `--yes` only skips the confirmation prompt for repos that are safe to remove.
- **Pros:** Simple, predictable, impossible to create orphaned state. Clear error with actionable remediation ("run `arb drop <repo>` or `arb remove <workspace>` first"). Matches GUIDELINES.md "safety wins", "refuse destructive operations and explain why", "detect, warn, and protect".
- **Cons:** Multi-step workflow when workspaces reference the repo — user must drop or remove workspaces first, then remove the repo.

### Cascading drop + remove
When workspaces use the repo, automatically drop the worktrees from all affected workspaces before removing the canonical repo. Show a preview of all affected workspaces and worktrees before confirming.
- **Pros:** One-step workflow.
- **Cons:** Complex multi-phase operation with edge cases (what if a worktree has uncommitted changes?). Violates single-responsibility — one command mutates both `.arb/repos/` and workspace directories. Goes against "nothing mutates without explicit approval." Surprising scope. Harder to test.

## Decision

Hard refuse when in use. No `--force` override for the workspace-usage check.

## Reasoning

The broken-state scenario is the decisive factor: deleting a canonical repo while workspaces reference it makes `arb drop` and `arb remove` crash, leaving the user with no clean recovery path. A `--force` flag that bypasses the check would actively create this broken state. The multi-step workflow (drop then remove) is a feature, not a limitation — it forces the user to consciously handle each workspace's state before deleting the shared resource.

The cascading approach would need its own safety checks (uncommitted changes in worktrees, unpushed branches), turning a simple removal command into a complex orchestration. Every edge case in the cascade is already handled correctly by the existing `arb drop` and `arb remove` commands — reusing them sequentially is both simpler and safer.

## Consequences

`arb repo remove` refuses with a clear error listing affected workspaces when any workspace uses the repo. The error message provides exact remediation steps. Template files in `.arb/templates/repos/<name>` are cleaned up alongside the canonical repo directory. The command follows the membership-changing pattern (interactive picker, `--all-repos`, `--yes`).
