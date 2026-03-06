# Conflict Predictions in Status JSON Output

Date: 2026-03-06

## Context

The status command recently gained conflict prediction — using `git merge-tree` to predict whether rebasing onto base or pulling from the share remote would produce conflicts. This data drives TUI highlighting (red attention color on diverged cells) but was absent from the `--json` output path, creating a gap between the machine-readable and human-readable representations.

The question: should predictions be included in JSON, and if so, how?

## Options

### Always include predictions in JSON

Run the same `predictConflicts()` logic for both TUI and JSON paths. Add per-repo `predictions: { baseConflict, pullConflict }` (optional) and workspace-level `baseConflictCount`/`pullConflictCount` (required) to the schema.

- **Pros:** JSON becomes a complete representation of what the TUI shows. Consumers (CI dashboards, scripts) get conflict awareness without reimplementing git merge-tree logic. Predictions are genuinely new information — unlike flags, they cannot be derived from existing JSON fields.
- **Cons:** Adds latency (~50-100ms per diverged repo). Predictions are ephemeral and may be stale by the time a consumer acts on them.

### Keep predictions out of JSON

Leave JSON as raw gathered data. Predictions remain a TUI-only rendering concern.

- **Pros:** Simpler contract, no latency cost, no schema change.
- **Cons:** JSON consumers lose information the TUI has. Unlike derived flags (which consumers can recompute from existing fields), predictions require git access to reproduce.

### Opt-in via a flag

Add `--predict` to control whether predictions run.

- **Pros:** Consumer controls latency trade-off.
- **Cons:** Extra flag complexity. Predictions already only run for diverged repos (bounded cost). TUI always runs them without opt-in.

## Decision

Always include predictions in JSON output, with no opt-in flag.

## Reasoning

The key insight is that predictions are *not derivable* from the JSON data already present. Flags like `isDirty` or `isUnpushed` are deterministic functions of `RepoStatus` fields — a consumer can recompute them. But predictions require running `git merge-tree` against the local repo, which a JSON consumer may not have access to. This makes predictions genuinely new information that belongs in the output.

The latency cost is bounded: predictions only run for diverged repos (base ahead+behind > 0, or share push+pull > 0), and they run in parallel. An opt-in flag would add complexity without meaningful benefit — the TUI already runs predictions unconditionally.

Per-repo flags were explicitly *not* added because they are fully derivable from existing fields. Adding them would introduce redundant data and maintenance burden.

## Consequences

- The `StatusJsonOutputSchema` now requires `baseConflictCount` and `pullConflictCount` at the workspace level, making this a breaking schema change for consumers that validate strictly.
- Per-repo `predictions` is optional — only present when at least one conflict is predicted — so existing consumers that ignore unknown fields are unaffected.
- The `predictConflicts()` helper is now shared between the table and JSON code paths, reducing duplication.
- `WorkspaceSummary` intentionally does not include prediction counts (they're computed at command level, not during gathering), so the internal type and JSON type have diverged slightly.
