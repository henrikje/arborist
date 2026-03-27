# File-Level Conflict Predictions in Verbose Mode

Date: 2026-03-26

## Context

The conflict prediction layer (`predictMergeConflict`) already returns per-file conflict lists from `git merge-tree --write-tree --name-only`, but three call sites discarded the file list and reduced it to a boolean (`"conflict"` / `"clean"`). For rebase mode, a second prediction step (`predictRebaseConflictCommits`) gathered per-commit conflict files and displayed them in `--verbose` — but merge mode and retarget mode had no equivalent. This meant rebase users could see which files (and commits) would conflict, while merge and retarget users only saw "will conflict" / "conflict likely" with no file-level detail.

## Options

### Preserve file list, show in --verbose
Stop discarding `prediction.files`. Store on the assessment. In `--verbose` for merge mode, show a "Conflicting files:" section after the commit list. For retarget, also call `predictRebaseConflictCommits` (retarget is always a rebase) and pass per-commit data to the renderer.
- **Pros:** Closes all mode asymmetries. ~40 lines of production code. Uses infrastructure already in place. No change to default output.
- **Cons:** Retarget prediction gains one extra git call per conflicting repo. Merge-mode file list without per-commit context is less granular than rebase's.

### Show conflict files without --verbose
Put file paths directly in the action cell: `(will conflict: auth.ts, middleware.ts)`.
- **Pros:** Most discoverable.
- **Cons:** The action cell already packs mode, ref, diff counts, conflict label, stash hint, base fallback, warning, and HEAD sha. Variable-length file paths would overflow and degrade readability for all users.

### Do nothing
Leave the asymmetry in place.
- **Pros:** Zero change.
- **Cons:** The system computes data it then discards. Merge and retarget users get less useful conflict info than rebase users.

## Decision

Preserve the file list and show it in `--verbose`. For merge mode, render an overall "Conflicting files:" section. For retarget, add per-commit conflict detection (matching rebase behavior).

## Reasoning

The `--verbose` progressive disclosure pattern is well-established: default output stays clean, detail is opt-in. This matches how commit lists, diff stats, and stash predictions already work. The action cell is at capacity — adding variable-length content there would violate the GUIDELINES principle of keeping plan output scannable. The prediction layer already does the work, so the marginal cost is near zero.

## Consequences

- Merge and retarget `--verbose` output now shows file-level conflict detail, matching rebase.
- The `conflictFiles` field on assessment types is available for `--json` output in a future change.
- If merge-tree overhead becomes a concern for retarget (extra per-commit simulation), the per-commit step could be gated on `--verbose` — but the overhead is small (20-80ms per conflicting repo).
