# Merge-Tree Conflict Prediction

Date: 2026-02-18

## Context

When `arb rebase`, `arb merge`, or `arb pull` displayed their plan, the user saw ahead/behind counts but had no indication whether the operation would produce merge conflicts. A repo "3 behind, 2 ahead" could be a trivial non-overlapping rebase or a conflict minefield — the numbers alone couldn't distinguish. Separately, the status model treated all repos with `base.behind > 0` identically via `needsRebase`, whether the repo was merely behind (trivial fast-forward) or truly diverged (both ahead and behind, with conflict potential).

## Options

### Use `git merge-tree --write-tree` for in-memory prediction
Git 2.38+ provides `git merge-tree --write-tree` which performs a three-way merge entirely in memory — no working tree or index modification. Exit 0 means clean merge, exit 1 means conflicts. Supports `--name-only` for conflict file lists and `--quiet` for early exit on first conflict.
- **Pros:** Same merge logic as `git merge`, just without side effects. Runs in ~20-80ms per repo (object store only). Only needed for diverged repos — fast-forward cases are guaranteed clean. The assessment phase already runs 4+ git commands per repo, so one more is marginal.
- **Cons:** Approximate for rebase (rebase replays commits individually, so per-commit conflicts can differ from the combined prediction). Requires Git 2.38+ (Oct 2022). Exact for merge and `pull --merge`.

### Use file-level diff overlap as a heuristic
Compare changed file lists between the two sides to estimate conflict likelihood.
- **Pros:** Simpler, works with any git version.
- **Cons:** High false positive rate — two changes to the same file often don't conflict (different functions, different sections). Misses rename-based conflicts entirely. Less accurate than merge-tree in every dimension.

### Don't predict, just show ahead/behind numbers
Keep the current behavior.
- **Pros:** No complexity added.
- **Cons:** Users can't distinguish trivial rebases from risky ones without manually investigating. The whole point of the plan display is informed decision-making.

## Decision

Use `git merge-tree --write-tree` for in-memory conflict prediction. Show "(conflict unlikely)" in default color for reassurance and "(conflict likely)" in yellow as a warning in plan displays. Add an `isDiverged` flag to the status model to distinguish repos that are both ahead and behind from those merely behind.

## Reasoning

Merge-tree provides the most accurate prediction available without side effects. The accuracy distinction matters: for `arb merge` and `arb pull --merge`, the prediction is exact (same operation). For `arb rebase` and `arb pull --rebase`, it's approximate but still a strong heuristic — false positives are harmless (user proceeds cautiously) and false negatives are rare.

The `isDiverged` flag addresses a related gap: being both ahead and behind is qualitatively different from being only behind (trivial fast-forward). The flag is free to compute (data already exists), follows the existing "flag + label + filter" pattern, and drives both the conflict prediction (only run merge-tree for diverged repos) and yellow coloring of the base diff column. It was deliberately named `isDiverged` (not overloading "at-risk") for precision, added to `needsAttention()` but NOT to `wouldLoseWork()` since divergence alone doesn't risk data loss.

The decision to show conflict prediction only in plan displays (not in `arb status`) was later formalized in decision 0012 — conflict prediction is a rendering concern for integration commands, not part of the canonical status model.

## Consequences

Plan displays for rebase, merge, and pull include conflict predictions. The `isDiverged` status flag enables `--where diverged` filtering and yellow coloring of the base diff column for diverged repos. Graceful degradation: when merge-tree is unavailable (git < 2.38), the prediction parenthetical is simply omitted. Fast-forward cases show "(conflict unlikely)" without running merge-tree at all.
