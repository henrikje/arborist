# Undo --force and --discard

Date: 2026-03-26

## Context

`arb undo` refuses to operate when any repo has "drifted" — its HEAD moved since the tracked operation. This all-or-nothing drift check is a safety invariant that prevents data loss. However, it blocks users who intentionally want to reset back to the pre-operation state despite having drifted (e.g., they made a post-rebase commit and regret it).

The existing `--force` flag on `arb undo` did not follow the CLI-wide convention. Across the CLI, `--force` means "override a safety guard":
- `arb push --force` → include diverged repos
- `arb delete --force` → include at-risk workspaces
- `arb detach --force` → include at-risk repos

But `arb undo --force` meant "delete a corrupted operation record without parsing it" — a recovery escape hatch, not a safety override.

## Options

### Keep `--force` as corruption escape hatch, add `--override` for drift
- **Pros:** No breaking change for the existing `--force` behavior.
- **Cons:** `--override` is not used anywhere else in the CLI. `--force` remains inconsistent with every other command.

### Repurpose `--force` for drift override, add `--discard` for corruption (chosen)
- **Pros:** `--force` gains consistent semantics across the CLI. `--discard` is descriptive and self-documenting for its narrow purpose. The corruption escape hatch is rare — users encounter it only when `operation.json` is corrupted.
- **Cons:** Breaking change for users who relied on `arb undo --force` to clear records. Error messages that reference `arb undo --force` must be updated.

## Decision

Repurpose `--force` to mean "override the drift check and force-reset drifted repos to their pre-operation state." Move the corrupted-record escape hatch to a new `--discard` flag (long-only, no short flag).

## Reasoning

**Consistency wins.** The CLI-wide contract is that `--force` overrides safety guards. A user who types `arb undo --force` because undo refused should get what they expect — not an unrelated file deletion. The pre-release compatibility policy (GUIDELINES.md § Prefer correctness over backwards compatibility) permits this change.

**`--discard` is self-documenting.** "Discard the operation record" describes what happens. The flag is long-only because it is an escape hatch invoked only when the record is corrupted — a situation most users never encounter.

**Structural blockers remain blocked.** `--force` overrides drift (HEAD moved, wrong branch) but not structural impossibilities (target branch already exists for branch rename). These cannot be safely overridden with a `git reset`.

**Assessment stays pure.** The force override is a post-assessment reclassification in `runUndoFlow`, not in the assessment functions. Assessment reports what it sees; force is a policy decision in the orchestration layer.

**`--force` is `arb undo` only.** The `--abort` paths (`arb rebase --abort`, etc.) call `runUndoFlow` but do not expose `--force`. Abort is for canceling in-progress operations; force-overriding drift is an undo concern.

## Consequences

- `arb undo --force` now overrides drift instead of deleting the record. Users must use `arb undo --discard` for corrupted records.
- Error messages in `operation.ts` reference `arb undo --discard` instead of `arb undo --force`.
- The plan display shows forced repos with warning-level coloring to make the risk visible.
- Shell completions updated for both bash and zsh.
- The `--force` flag follows the same show-plan-then-confirm pattern as every other command — `--yes` is still needed to skip the prompt.
