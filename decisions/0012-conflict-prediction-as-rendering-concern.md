# Conflict Prediction as Rendering Concern, Not Model Property

Date: 2026-02-19

## Context

Arborist added conflict prediction using `git merge-tree --write-tree` (Git 2.38+) to show "(conflict likely)" or "(conflict unlikely)" in integration plan displays (`arb rebase`, `arb merge`, `arb pull`). The prediction was also added to `arb status` to conditionally color the base diff column yellow only when an actual conflict is predicted, rather than for all diverged repos.

The question was whether to add a `--where conflicted` filter by extending the canonical status model (`RepoStatus`/`RepoFlags`) with a `conflictPrediction` field and an `isConflicted` flag.

## Options

### Add to the canonical model
Extend `RepoStatus` with `conflictPrediction`, add `isConflicted` to `RepoFlags`, wire through `computeFlags()`, `FLAG_LABELS`, `FILTER_TERMS`.
- **Pros:** Clean integration with the filter system. Consistent "extend, don't fork" architecture.
- **Cons:** `git merge-tree` is a simulation, not raw git state — it doesn't belong in the observation model. Every consumer pays the cost: `arb list` scanning 10 workspaces × 8 repos = up to 80 extra git subprocesses. The rebase/merge commands already run their own prediction, creating redundant work. Adding to `needsAttention()` would be wrong since diverged already flags attention.

### Keep as rendering-only concern
Keep conflict prediction as a command-local rendering enhancement in `arb status` and `integrate.ts`. No model extension, no filter.
- **Pros:** No performance impact on other consumers. Simple. `arb rebase --dry-run` already serves the "which repos will conflict?" filtering use case.
- **Cons:** No way to filter by conflict prediction in `arb status --where`.

## Decision

Keep conflict prediction as a rendering-only concern, not part of the canonical status model.

## Reasoning

The canonical model should contain observations from git, not simulations. `git merge-tree` performs a hypothetical merge — it's computed, not observed. Adding it to `gatherRepoStatus()` would violate the model's purpose and impose latency on every consumer, most of which don't need it. The performance cost is real: ~20-80ms per diverged repo, compounded across all workspaces in `arb list`.

More practically, `arb rebase --dry-run` already provides the "show me which repos will conflict" use case with better accuracy (it runs prediction against the actual integration target). A filter on `arb status` would be less useful and potentially confusing — in non-TTY contexts, conflicted and non-conflicted diverged repos produce identical text.

## Consequences

Conflict prediction remains in two places: `arb status` (coloring only) and `integrate.ts` (plan display for rebase/merge/pull). If a compelling use case for `--where conflicted` emerges, the model can be extended later — but the default is to keep simulations out of the observation model. This maintains the principle that `RepoStatus` captures what git tells us, not what we compute from it.
