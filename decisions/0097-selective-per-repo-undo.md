# Selective Per-Repo Undo

Date: 2026-03-26

## Context

`arb undo` reverses the last workspace operation across all repos atomically — read the operation record, show a plan, execute, finalize. There was no way to keep some repos' changes while rolling back others. A common scenario: the user rebases five repos, the rebase is correct in four but wrong in one. The only option was to undo everything and re-rebase.

The feature needed to support incremental undo: `arb undo repo-a`, then later `arb undo repo-b`, then `arb undo` for the rest. This raised three design questions: (1) how to track partially-undone state, (2) when to perform workspace-level finalization (config restore, directory rename, record finalization), and (3) how to scope the drift safety check.

## Options

### A: Add "undone" status to `RepoOperationState`
Extend the per-repo status enum (`completed | conflicting | skipped | pending`) with `"undone"`. After selective undo, mark repos as "undone" in the existing operation record. Finalize only when all repos are resolved.
- **Pros:** Minimal schema change (one enum value). Single file remains the source of truth. Existing assess/continue/abort flows need only trivial additions. Human-readable record shows exactly which repos are undone.
- **Cons:** Makes the operation record mutable after completion — though `finalizeOperationRecord` already does this.

### B: Separate undo tracking file (`.arbws/undo-state.json`)
Keep the operation record untouched. Add a companion file that tracks which repos have been undone.
- **Pros:** Operation record stays immutable during undo.
- **Cons:** Contradicts the single-file pattern. Creates a consistency hazard (one file deleted but not the other). All existing infrastructure (`assertNoInProgressOperation`, continue, abort) works with one file — splitting introduces coordination complexity.

### C: Reuse existing status values (mark undone repos as "skipped")
When a repo is undone, set its status back to "skipped". No schema change.
- **Pros:** No schema change needed.
- **Cons:** "Skipped" means "this repo was never part of the operation." The assess functions produce `action: "skip"` for skipped repos and filter them from the plan table — an undone repo would become invisible. Semantic confusion and lost audit trail.

## Decision

Option A — add `"undone"` to the `RepoOperationState` status enum. Workspace-level finalization (config restore, directory rename, record finalization) is deferred until all repos are resolved. The finalization check is outcome-based, not invocation-based: `arb undo repo-a repo-b repo-c` naming every actionable repo produces the same finalization as a bare `arb undo`.

## Reasoning

**Single-file state.** GUIDELINES §Filesystem as database: "state is inspectable, debuggable, and impossible to corrupt through arb bugs alone." Splitting state across two files (Option B) creates a consistency hazard and doubles schema maintenance. The operation record already tracks per-repo lifecycle — extending it is the natural path.

**Semantic clarity over convenience.** Option C would silently absorb undone repos into the "skipped" category, hiding them from the plan table and losing the distinction between "never participated" and "was reversed." Undone repos should be visible when the user runs `arb undo --dry-run` to inspect partial state.

**Outcome-based finalization.** The alternative — checking whether the user passed `[repos...]` — would mean `arb undo repo-a repo-b` (all repos) behaves differently from `arb undo` (no args), even though the outcome is identical. Outcome-based finalization is simpler to reason about and avoids a class of "did I finalize correctly?" edge cases.

**Scoped drift check.** Full undo keeps the existing behavior: any drifted repo blocks the entire undo. Selective undo checks only selected repos — consistent with how `arb rebase repo-a` only assesses repo-a. An unselected drifted repo is irrelevant to the user's intent and should not block progress.

**Deferred workspace-level operations.** Config restore and directory rename (for `arb rename` undo) are workspace-level: restoring the config branch name while some repos still use the new name creates an inconsistent state. Deferring these to final undo keeps the workspace coherent at every intermediate step.

## Consequences

- The `RepoOperationState.status` enum gains a fifth value. `classifyContinueRepo` and `assertNoInProgressOperation` treat "undone" as resolved, so `--continue` skips undone repos and the gate auto-completes when all remaining repos are undone/completed/skipped.
- After selective undo, the operation record persists with mixed statuses (some "completed", some "undone"). A subsequent `arb undo` or `arb undo <remaining-repos>` picks up where the last one left off.
- The `--abort` flag on sync commands does not support selective repos — abort means "cancel the entire operation." This is enforced at the command level (Commander `.conflicts()`), not in the undo flow.
- The hint `Use 'arb undo' to undo the remaining N repos` after partial undo is critical for discoverability — without it, users may not realize the record is still live.
- `arb undo` now performs a second assessment pass after execution to determine whether all repos are resolved. This adds per-repo git operations but is necessary for correctness — the first assessment ran before execution, and the post-execution state may differ.
