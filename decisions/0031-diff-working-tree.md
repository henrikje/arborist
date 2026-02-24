# Diff merge-base against working tree

Date: 2026-02-24

## Context

`arb diff` used the three-dot range `base...HEAD` to show what a feature branch introduced. This compares committed changes only — the merge-base to the HEAD commit. Meanwhile, `arb status` runs `git status --porcelain`, which detects all working tree changes (staged, unstaged, untracked). When a developer modifies files without committing, status reports "3 modified" but diff reports "0 files changed" — contradictory and confusing for an overview command whose purpose is showing "the total change set."

## Options

### A: Diff merge-base against working tree

Replace `base...HEAD` with an explicit `git merge-base` computation, then run `git diff <merge-base-sha>` (single ref, no second ref). Git compares that commit to the working tree — including committed, staged, and unstaged changes to tracked files.

- **Pros:** Simple mechanical change. Shows the complete change set. Status and diff become consistent. Matches `git diff <ref>` semantics developers already know.
- **Cons:** No longer matches "what a PR reviewer would see."

### B: Show uncommitted changes as a separate visual section

Keep `base...HEAD` for committed changes, add a second section showing `git diff HEAD` for uncommitted changes.

- **Pros:** Separates committed vs uncommitted visually. Preserves existing semantics.
- **Cons:** More complex. Changes may overlap between sections. Harder to compute aggregate stats. Adds cognitive overhead.

### C: Add a warning note when dirty repos show empty diff

Keep existing behavior, add a yellow note like "3 files modified locally (not yet committed)."

- **Pros:** Smallest code change.
- **Cons:** Doesn't solve the problem — the developer still can't see the actual changes.

## Decision

Option A: diff from merge-base to working tree.

## Reasoning

The command's stated purpose is showing "the total change set" of the feature branch. A developer's in-progress work — staged and unstaged modifications — is part of that change set. The GUIDELINES principle "Visibility and control are everything" supports showing the complete picture. Since Arborist is pre-release, "Prefer correctness over backwards compatibility" applies.

The refactoring also eliminated ~30 lines of duplicated range-building logic in `outputPipe` by storing the computed `diffRef` on `RepoDiffResult` and reusing it.

## Consequences

- `arb diff` now shows the complete working tree state relative to the merge-base, not just committed changes. The help text was updated to reflect this.
- Untracked files (never `git add`ed) still don't appear in diff output — this is inherent to `git diff` semantics and consistent with developer expectations.
- The `resolveDiffTarget` helper centralizes merge-base resolution, making all three output paths (TTY, pipe, JSON) consistent by construction.
- If a future need arises to show only committed changes (e.g., a `--committed` flag), the helper can be extended to return a range instead of a single ref.
