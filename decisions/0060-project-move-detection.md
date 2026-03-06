# Project Move Detection

Date: 2026-03-06

## Context

Decision 0055 introduced auto-repair for workspace renames: when a user runs `mv ws-old ws-new`, the forward worktree reference (`.git` file → canonical repo) survives, and arb detects the stale backward reference and repairs it via `git worktree repair`.

When the entire project directory is moved (e.g., `mv /old/project /new/project`), both directions break. The forward ref targets a path under the old root (which no longer exists), and the backward ref also points to the old root. The existing `repairWorktreeRefs()` cannot detect this because it reads the forward ref to reach the canonical repo — but after a project move, that path doesn't exist, so the function early-returns.

This is triggered by common operations: moving a project directory, restoring from backup, or cloning a machine image.

## Options

### Require manual repair
Document `git worktree repair` as a manual step after moving a project.
- **Pros:** Zero code changes
- **Cons:** Violates "detect, warn, protect" principle; users face opaque git errors; the error messages don't suggest a fix

### Auto-detect and repair silently
Extract the old project root from the `/.arb/repos/` marker embedded in stale forward refs. If the old root differs from the current root and doesn't exist on disk, rewrite references via `git worktree repair`.
- **Pros:** Extends the existing safety net; no new commands; deterministic detection with zero false positives
- **Cons:** Adds a pre-check to every workspace command (2 file reads to detect, no git processes)

### Detect and prompt
Same detection, but ask the user before repairing.
- **Pros:** User is aware of what happened
- **Cons:** Blocking prompt on every command until repaired; workspace-rename repair (decision 0055) is already silent; inconsistency

## Decision

Auto-detect and repair silently.

## Reasoning

The detection is deterministic: the `/.arb/repos/` marker in the gitdir path unambiguously identifies the old project root. The safety constraint (old root must not exist on disk) prevents false positives from symlink setups. This extends the "filesystem as database" principle — arb discovers truth from the filesystem rather than requiring users to update registries.

Silent repair is consistent with decision 0055's workspace-rename repair. The cost of detection (reading one `.git` file per workspace entry until a mismatch is found, then short-circuiting) is negligible. Repair runs `git worktree repair` per canonical repo entry, the same mechanism already used for workspace renames.

A prompt would be inconsistent with the existing silent-repair pattern and would block every command until the user confirms, which is especially frustrating when the project move was intentional.

## Consequences

Moving an entire project directory is a supported operation. Arb silently repairs all broken worktree references through two paths: `requireWorkspace()` (runs on any workspace command, detects from the current workspace) and `arb clean` (samples any workspace before stale detection).

The repair requires `git worktree repair` (Git 2.30+). On older git versions, the repair is skipped — the worktrees remain broken, matching the existing version gate.

Project move repair runs before workspace-rename repair in `requireWorkspace()`. After project-move repair fixes forward refs, the workspace-rename repair becomes a no-op. The two mechanisms are complementary: project-move handles broken forward refs (both directions stale), workspace-rename handles surviving forward refs (only backward ref stale).
