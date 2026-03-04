# Workspace Rename Safety Net

Date: 2026-03-04

## Context

`arb create my-feature` creates a workspace directory `my-feature/` with git worktrees on branch `my-feature`. Git worktrees use bidirectional absolute paths internally: each worktree's `.git` file points forward to the canonical repo's worktree entry, and the canonical repo's `gitdir` file points back to the worktree. A manual `mv` of a workspace directory preserves the forward reference but breaks the backward reference.

This broken state is invisible — git commands from inside the renamed workspace work fine (they use the forward reference). But `arb clean` calls `findStaleWorktrees()` which reads from the canonical side: the old paths don't exist, so the worktrees appear "stale" and get pruned. Pruning removes the canonical worktree metadata, permanently breaking the forward reference too. This is silent data loss.

Decision 0051 added workspace renaming to `arb branch rename`, but users who manually `mv` a workspace directory still hit this safety gap.

## Options

### Standalone `arb rename` command
A new top-level command that wraps `mv` + `git worktree repair`.
- **Pros:** Clear separation of concerns, simple mental model
- **Cons:** Wraps `mv` + one git command — doesn't earn its place per "minimal, semantic CLI"; name is ambiguous (rename workspace? branch? repo?); adds CLI surface area for a rare edge case; rejected in decision 0051

### Auto-repair safety net
Detect renamed workspaces by cross-referencing stale backward references with surviving forward references. Repair silently — treat `mv` as a supported operation.
- **Pros:** Users can simply `mv` and arb catches up; no new command to learn; eliminates the pruning safety gap; works retroactively
- **Cons:** Does not provide managed-rename ergonomics (name validation, dry-run preview)

### Combined: auto-repair + improved `arb branch rename --workspace-name` UX
Auto-repair as safety net, plus allow `arb branch rename --workspace-name <name>` without a positional argument for workspace-only rename.
- **Pros:** Covers both paths (managed rename and manual `mv`)
- **Cons:** The workspace-only rename via `arb branch rename` is largely redundant if `mv` is a supported operation

## Decision

Auto-repair safety net only. No standalone `arb rename` command. No changes to `arb branch rename`.

## Reasoning

If `mv` is a supported operation and arb silently repairs, the need for a managed workspace-only rename command disappears. Users who want to rename just the directory can `mv` it. Users who want to rename both the branch and directory use `arb branch rename` (which already handles workspace renaming per decision 0051).

The detection is deterministic with zero false positives: the forward reference (worktree `.git` → canonical) always survives a rename, so cross-referencing it against stale backward references produces an unambiguous match. No user input is ever required.

The per-workspace check (2 file reads per repo, no git processes) is cheap enough to run on every workspace command via `requireWorkspace()`. A global scan in `arb clean` catches renamed workspaces the user hasn't `cd`'d into yet, preventing the pruning safety gap.

This aligns with "filesystem as database" (discover truth from the filesystem, don't require users to update registries) and "detect, warn, protect" (arb tolerates user mistakes rather than punishing them).

## Consequences

Manual `mv` of workspace directories is a supported operation. Arb silently repairs broken backward references via two paths: `requireWorkspace()` (per-workspace, runs on any workspace command) and `repairAllWorktreeRefs()` (global, runs in `arb clean` before stale detection).

The repair requires `git worktree repair` (Git 2.30+). On older git versions, the repair is skipped — the forward reference still works, so commands run from inside the workspace are unaffected. Only `arb clean` pruning remains a risk on pre-2.30 git, which matches the existing version gate in `arb branch rename`.

A standalone `arb rename` command is explicitly not added. If this decision is revisited, it should be a new decision record referencing this one and decision 0051.
