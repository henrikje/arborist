# Autostash for rebase, merge, and pull

Date: 2026-02-22

## Context

Repos with uncommitted changes are unconditionally skipped during `arb rebase` and `arb merge`. `arb pull` had no dirty check at all — `git pull` would fail mid-operation if dirty files conflicted with incoming changes. This is safe but inconvenient: developers working on uncommitted changes across multiple repos had to manually stash before running multi-repo operations and pop after.

## Options

### Always autostash (implicit)
Silently stash before operating and pop after, matching `git rebase --autostash` behavior when enabled globally.
- **Pros:** Zero friction, no new flags needed.
- **Cons:** Violates Arborist's visibility principle — the developer doesn't see that stash/pop happened. Stash pop conflicts would appear unexpectedly. Changes the existing behavior of skipping dirty repos, which some users may rely on.

### Opt-in `--autostash` flag
Add a flag that must be explicitly passed. Without it, dirty repos are skipped with a hint to use `--autostash`.
- **Pros:** Explicit, visible, no surprise behavior changes. The plan display shows which repos will be stashed and predicts stash pop conflicts. Matches Arborist's preview-confirm-execute pattern.
- **Cons:** Extra flag to type.

### No autostash — leave as-is
Keep skipping dirty repos; developers use `arb exec git stash` manually.
- **Pros:** Simple, no new code.
- **Cons:** Painful for large workspaces with many dirty repos.

## Decision

Opt-in `--autostash` flag for `rebase`, `merge`, and `pull`.

## Reasoning

Arborist's core principle is "visibility and control are everything." Implicit autostash hides state changes. The opt-in flag makes the stash cycle visible in the plan and gives the developer a chance to review stash pop conflict predictions before proceeding. The skip reason now includes `(use --autostash)` as a hint, so discoverability is maintained.

For rebase mode, git's native `--autostash` flag handles the stash cycle atomically. For merge mode, Arborist manages a manual `stash push` / `stash pop` cycle because `git merge` has no `--autostash` flag. Stash pop failures after a successful merge are tracked separately from merge conflicts and reported with their own recovery instructions.

Untracked-only dirty repos proceed without stashing, since untracked files don't interfere with rebase or merge operations.

## Consequences

- Dirty repos now show `"uncommitted changes (use --autostash)"` instead of `"uncommitted changes"`, improving discoverability.
- `arb pull` gains a dirty check it previously lacked, preventing mid-operation failures.
- Stash pop failures are a new failure mode with dedicated reporting. They trigger exit 1 like conflicts.
- The stash pop conflict prediction uses file-level overlap between dirty files and incoming changes — it's a heuristic, not exact.
