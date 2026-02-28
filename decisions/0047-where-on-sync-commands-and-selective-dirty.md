# Extend --where to sync commands, selective --dirty

Date: 2026-03-01

## Context

Seven commands supported `--where` (established in [0006](0006-where-filtering-paradigm.md), extended with positive terms and `^` negation in [0032](0032-positive-filter-terms.md), `-w` short flag reassigned in [0008](0008-remove-workspace-option-reassign-w.md)): `status`, `diff`, `log`, `exec`, `open`, `list`, `delete`. The four sync commands (`push`, `pull`, `rebase`, `merge`) accepted positional `[repos...]` and stdin (per [0028](0028-quiet-flag-and-stdin-piping.md)) for repo selection but had no status-based filtering. Users wanting to push only rebased repos or rebase only non-diverged repos had to pipe `arb status -q --where ...` into the sync command.

All four sync commands already gather `RepoStatus` (the canonical status model from [0004](0004-canonical-status-model.md)) during their assess phase, so `--where` can filter at zero additional I/O cost — non-matching repos simply don't appear in the plan.

Separately, `--dirty` existed on 7 commands including `delete`, where it's semantically misleading (you rarely want to delete dirty workspaces). Adding `--where` to 4 more commands raised the question of whether `--dirty` should also be added everywhere for consistency.

## Options

### A: Add `--where` to all 4 sync commands + `--dirty` everywhere for consistency
- **Pros:** Uniform option surface — every `--where` command also has `--dirty`.
- **Cons:** `--dirty` on `push`, `pull`, `rebase`, `merge` is misleading. Dirty repos can't be pushed. Dirty repos are skipped by rebase/merge. Users reaching for `--dirty` on sync commands have the wrong mental model.

### B: Add `--where` to all 4 sync commands, keep `--dirty` only where it makes sense
- **Pros:** `--where` is universal. `--dirty` is a shorthand only where "dirty" is a natural filter for the command. No misleading options.
- **Cons:** Slightly inconsistent — some `--where` commands have `-d`, others don't. But the inconsistency reflects genuine semantic differences.

### C: Drop `--dirty` from all commands, `--where` only
- **Pros:** One way to filter. No shorthands, no mutual-exclusion checks.
- **Cons:** Breaking change for `status -d`, `diff -d`, `exec -d` where `-d` is genuinely useful and likely in muscle memory. 2 chars → 8 chars for the most common filter.

## Decision

Option B. Add `--where` to `push`, `pull`, `rebase`, `merge`. Keep `--dirty` on `status`, `diff`, `log`, `exec`, `open`, `list`. Remove `--dirty` from `delete`.

## Reasoning

`--dirty` is a shorthand that should only exist where "dirty" is the natural primary filter for a command. On `status` and `diff`, "do I have uncommitted changes?" is the top use case. On `exec` and `open`, "act on repos I'm editing" is natural. On sync commands, the useful filters are `unpushed`, `behind-base`, `behind-share` — offering `--dirty` suggests the wrong mental model. On `delete`, `--where safe` or `--where gone` are the useful filters; `--dirty` actively misleads.

This follows the pattern of Git itself: shorthands serve the command's use case (`git log --oneline` exists but `git status --oneline` doesn't).

A `resolveWhereFilter()` helper was extracted to `status.ts` to DRY up the duplicated validation block (dirty/where mutual exclusion + `validateWhere()`) that was copied across all commands.

## Consequences

- `--where` is now supported on 11 commands. The guideline is: any command that gathers workspace status gets `--where`.
- `--dirty` exists on 6 commands. The guideline is: only where "dirty" is a natural primary filter.
- `resolveWhereFilter()` centralizes option validation. New commands adding `--where` use this helper.
- `arb delete --dirty` is removed. Users must use `arb delete --where dirty` (unlikely use case).
- Stdin piping into sync commands still works but is now redundant for status-based filtering: `arb push --where unpushed` replaces `arb status -q --where unpushed | arb push`.
