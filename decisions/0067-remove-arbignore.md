# Remove arb clean and .arbignore

Date: 2026-03-09

## Context

`arb clean` was introduced (decision 0030) as a dedicated housekeeping command for the arb root. It removed non-workspace directories (shell directories left behind by IDEs after `arb delete`), pruned stale worktree refs, and deleted orphaned local branches. `.arbignore` was an escape hatch that let users protect specific directories from cleanup.

In practice, `arb clean` saw little use. Non-workspace directories are harmless and easy to remove manually. Stale worktree refs are handled by `git gc`. Orphaned branches can be deleted with standard git commands. Meanwhile, per-workspace repair in `requireWorkspace()` already handles the critical recovery scenarios (project moves, workspace renames, shared worktree entry collisions) automatically on every workspace access.

## Options

### Option A: Keep arb clean and .arbignore

Retain the command and its supporting infrastructure.

- **Pros:** Provides a single entry point for all housekeeping.
- **Cons:** The command solves problems that rarely matter or are handled elsewhere. Adds surface area, tests, and docs for marginal value.

### Option B: Remove arb clean but keep .arbignore and the non-workspace hint

Remove the command while preserving the post-delete hint ("N non-workspace directories found") and the ignore file.

- **Pros:** Users still get visibility into leftover directories.
- **Cons:** The hint points to a manual cleanup step with no tooling. `.arbignore` has no consumer. Dead code remains.

### Option C: Remove arb clean, .arbignore, and the non-workspace hint entirely

Remove the command, the ignore file support, `listNonWorkspaces()`, and the post-delete hint.

- **Pros:** Eliminates all dead code. Reduces surface area. Avoids user confusion about an unsupported config file and an actionless hint.
- **Cons:** If a housekeeping feature is needed later, code must be rewritten — but the implementation was small.

## Decision

Option C: remove `arb clean`, `.arbignore` support, and the non-workspace directory hint.

## Reasoning

The critical workspace integrity scenarios are already covered by automatic repair in `requireWorkspace()`. The remaining housekeeping tasks (removing leftover directories, pruning worktree refs, deleting branches) are infrequent, low-stakes, and well served by standard tools. A dedicated command added complexity without meaningful benefit. `.arbignore` and the non-workspace hint existed only to support `arb clean` and became dead weight once it was removed.

## Consequences

- Users who relied on `arb clean` must handle housekeeping with standard tools (`rm`, `git branch -d`, `git worktree prune`).
- Users with an existing `.arbignore` file will see no effect — the file is simply ignored. No migration or error is needed since it was always optional.
- The `arb delete` command no longer prints a "non-workspace directories found" hint after deletion.
- If a future housekeeping feature is needed, it can be designed from scratch without legacy constraints.
