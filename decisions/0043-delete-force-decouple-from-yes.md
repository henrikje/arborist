# Decouple `--force` from `--yes` in `arb delete`

Date: 2026-02-27

Supersedes: [0029 — Decouple `--force` from `--yes` in `arb push`](0029-push-force-decouple-from-yes.md) (which kept the coupling in `delete`)

## Context

Decision 0029 decoupled `--force` from `--yes` in `arb push` but explicitly kept the coupling in `arb delete`, reasoning that `--force` on delete is a safety bypass where "I accept the risks" semantics justify skipping confirmation. In practice, this made `delete` the only command where `--force` implies `--yes`, creating an inconsistency: every other command that has both flags treats them as independent concerns.

The GUIDELINES.md safety gates section already describes the intended separation: "Use `--yes` to skip the confirmation prompt without overriding safety checks." The delete command's own long description says the same: "Use --yes to skip confirmation, --force to override at-risk safety checks." But the implementation contradicted both by having `--force` also skip confirmation.

## Options

### Keep the status quo (from decision 0029)
`--force` continues to imply `--yes` on `delete`.
- **Pros:** No migration for scripts. Feels natural for a "blow it away" workflow.
- **Cons:** `--force` means different things on different commands. Users must memorize per-command prompt semantics.

### Decouple `--force` from `--yes` on `delete`
`--force` overrides at-risk safety checks only. `--yes` is required to skip confirmation.
- **Pros:** Consistent flag semantics across all commands. Matches what GUIDELINES.md and the command's own description already say. Eliminates a class of "I didn't mean to skip the prompt" mistakes.
- **Cons:** Scripts using `arb delete --force` without `--yes` will now get a non-TTY error.

## Decision

Decouple `--force` from `--yes` on `delete`. `--force` now only overrides at-risk safety checks. `--yes` is the single, consistent way to skip confirmation on every command.

## Reasoning

The original reasoning in decision 0029 — that `--force` on delete is a safety bypass, not a plan modifier — is still correct. But safety bypass and prompt suppression are still two separate concerns. A user who passes `--force` is saying "I accept that at-risk repos will be deleted," not necessarily "don't ask me to confirm." Keeping confirmation as a separate step follows the five-phase workflow and the "visibility first, control always" principle.

Pre-release is the right time to fix this (per the "prefer correctness over backwards compatibility" principle). The migration cost is minimal: add `--yes` alongside `--force` in scripts and CI.

## Consequences

- Scripts using `arb delete --force` without `--yes` will now get a non-TTY error. The fix is to add `--yes`: `arb delete --force --yes`.
- `--yes` is now the single consistent way to skip confirmation on every command. No per-command prompt semantics to memorize.
- `--force` is now consistently "override a safety guard" across all commands, never touching confirmation flow.
