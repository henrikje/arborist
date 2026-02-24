# Clean command for non-workspace directories and stale git state

Date: 2026-02-24

## Context

When `arb delete` removes a workspace, tools like IntelliJ that have the directory open may recreate it by writing config files (e.g. `.idea/`) on close. These "shell" directories lack `.arbws/`, so they don't appear in `arb list` or `arb delete` and accumulate over time. Similarly, if someone manually removes a workspace directory (or `arb delete` partially fails), canonical repos may retain stale worktree metadata and orphaned local branches.

## Options

### Option A: Standalone `arb clean` command

A dedicated command that scans for non-workspace directories and removes them. No changes to `arb delete`.

- **Pros:** Single responsibility, clear purpose.
- **Cons:** Users must discover the command on their own; no connection to the deletion workflow that creates the problem.

### Option B: `--clean` flag on `arb delete`

Extend `arb delete` to also remove non-workspace directories when a flag is passed.

- **Pros:** Keeps cleanup close to the deletion workflow.
- **Cons:** Expands `arb delete` beyond its core purpose (deleting workspaces with git state). Violates "do one thing and do it well".

### Option C: Standalone command with detection hint in `arb delete`

A dedicated `arb clean` command for all housekeeping (non-workspace directories, stale worktree refs, orphaned branches), plus a post-deletion hint in `arb delete` when non-workspace directories are detected.

- **Pros:** Keeps `arb delete` focused. Follows "detect, warn, and protect" by surfacing the problem at the moment it's most likely to occur. Provides a dedicated place for all arb root housekeeping.
- **Cons:** Two touch points instead of one.

## Decision

Option C: a standalone `arb clean` command with a detection hint in `arb delete`.

## Reasoning

`arb delete` is responsible for workspaces — directories with git worktrees and `.arbws/` config. Non-workspace shell directories are a fundamentally different kind of artifact: they have no git state, no branch, no repos. Mixing the two in one command would blur the boundary and make `arb delete`'s behavior harder to predict. The "do one thing and do it well" principle points toward a separate command.

The detection hint bridges the discoverability gap. After a successful deletion, `arb delete` checks for non-workspace directories and suggests `arb clean` — following the "detect, warn, and protect" principle. This makes the cleanup path visible without polluting the delete command's scope.

Grouping stale worktree pruning, orphaned branch deletion, and non-workspace directory removal under one `arb clean` command creates a natural housekeeping tool that can grow over time without expanding the scope of other commands.

## Consequences

- `arb clean` becomes the single entry point for all arb root housekeeping.
- `.arbignore` provides a simple escape hatch for directories that should be preserved (e.g. documentation, scripts).
- Users who run `arb delete` will see non-workspace directories flagged automatically, reducing the chance of unnoticed accumulation.
- Future housekeeping concerns (e.g. orphaned template directories) have a natural home in `arb clean`.
