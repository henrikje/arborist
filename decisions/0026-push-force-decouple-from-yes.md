# Decouple `--force` from `--yes` in `arb push`

Date: 2026-02-22

## Context

`arb push --force` served two roles: it included diverged repos in the push plan (a plan modifier) and it skipped the confirmation prompt (implying `--yes`). When a user rebases and is told "use --force", they add `--force` expecting to see the updated plan and confirm it — but the push executes immediately without prompting.

This conflated two concerns: plan modification and confirmation bypass. By contrast, `--retarget` on `arb rebase` modifies the plan without skipping confirmation. The GUIDELINES.md principle "visibility first, control always" and the five-phase workflow (assess → plan → confirm → execute → summarize) both treat confirmation as a separate concern from plan composition.

## Options

### Decouple `--force` from `--yes` everywhere
Make `--force` purely a plan modifier in all commands. `--yes` becomes the only way to skip confirmation.
- **Pros:** Simplest mental model. Consistent flag semantics across all commands.
- **Cons:** Breaks scripts using `arb delete --force` without `--yes`. Changes `delete` behavior where `--force` as "bypass everything" feels natural for destructive operations.

### Decouple only in `push`, keep `--force implies --yes` in `delete`
In `push`, `--force` includes diverged repos but still prompts. In `delete`, `--force` continues to override safety checks and skip confirmation.
- **Pros:** Fixes the surprising behavior exactly where it occurs. Smaller blast radius. `delete --force` retains its "I accept the risks" semantics.
- **Cons:** `--force` has different prompt behavior across commands.

### TTY-sensitive behavior
`--force` implies `--yes` only in non-TTY environments.
- **Pros:** Interactive users always see the prompt. Scripts keep working.
- **Cons:** Same flag behaves differently based on context. Harder to reason about.

### New flag for plan inclusion
Introduce `--include-diverged` as the plan modifier, keep `--force` as a full bypass.
- **Pros:** No ambiguity in flag semantics.
- **Cons:** Extra flag to learn. Loses the intuitive `git push --force` association.

## Decision

Decouple only in `push`. `arb push --force` now shows the plan and prompts for confirmation. `arb push --force --yes` skips the prompt. `arb delete --force` continues to imply `--yes`.

## Reasoning

`--force` means fundamentally different things in the two commands. In `push`, it's a plan modifier: "include repos that need force-pushing." In `delete`, it's a safety bypass: "override at-risk checks." The plan modifier role aligns with `--retarget` on `rebase`, which also modifies the plan without skipping confirmation. The safety bypass role on `delete` is consistent with destructive "I know what I'm doing" overrides.

The tool itself suggests `use --force` in skip reasons, setting the expectation that adding the flag will show the updated plan — not execute immediately. Keeping confirmation separate from plan modification follows the five-phase workflow where confirm is always its own step.

## Consequences

- Scripts using `arb push --force` without `--yes` will now get a non-TTY error. The fix is to add `--yes`: `arb push --force --yes`.
- `--force` now has per-command prompt semantics: `push` prompts, `delete` does not. This is acceptable because the flag's meaning is already per-command.
- `--yes` is the single consistent way to skip confirmation on `push`, matching `pull`, `rebase`, and `merge`.
