# Canonical Status Model with Independent Flags

Date: 2026-02-17

## Context

Arborist needs to reliably detect and display git repository state across multi-repo workspaces. The initial implementation used a priority-based verdict enum (`ok | dirty | unpushed | at-risk | local`) that lost information — a repo that was dirty AND unpushed AND behind base only showed a single verdict. Display concerns, filtering logic, and safety checks were intertwined, making it hard to add new states or change how existing ones were presented.

The question was how to structure the status model so that all consumers (status display, list aggregation, remove safety checks, filtering, exit codes) could derive what they need from a single source of truth.

## Options

### Priority-based verdict enum (status quo)
A single enum per repo computed by checking conditions in priority order. First match wins.
- **Pros:** Simple to compute; single value to pass around.
- **Cons:** Loses information (dirty + unpushed + behind only shows "at-risk"). Adding a new state requires deciding where it fits in the priority order. Display, filtering, and safety checks all need different slices of the same data but can't get them from a single verdict.

### Independent boolean flags with named flag sets
A `RepoFlags` interface with independent booleans (`isDirty`, `isUnpushed`, `needsRebase`, `isDetached`, etc.) computed from a 5-section `RepoStatus` model (identity, local, base, share, operation). Named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) group flags by concern. Shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`, `flagLabels`) derive decisions and display text.
- **Pros:** No information loss. Each consumer takes what it needs. New flags are additive — existing consumers pick them up through shared functions. Named sets make the relationship between flags and concerns explicit. Follows "extend, don't fork" principle.
- **Cons:** More types and functions to maintain. Consumers must choose which flags/sets to use rather than comparing a single value.

## Decision

Independent boolean flags with named flag sets, derived from a 5-section `RepoStatus` model.

## Reasoning

The independent flag approach eliminates the information loss that made the verdict enum frustrating. A repo's full state is always available, and different consumers naturally take different slices: `remove` checks `LOSE_WORK_FLAGS`, `list` colors based on `AT_RISK_FLAGS`, `status` exits non-zero on `isAtRisk()`. The named flag sets make these relationships explicit and auditable — you can see at a glance which flags drive which behavior.

The 5-section model (identity, local, base, share, operation) mirrors git's own structure and creates a clean separation between raw observations and derived flags. This makes the model the single source of truth per GUIDELINES.md — all commands work from `RepoStatus` and `RepoFlags` rather than inventing local representations.

## Consequences

All new git state detection goes through the model: add the observation to `RepoStatus`, add a flag to `RepoFlags`, add it to `computeFlags()` and `FLAG_LABELS`, and all consumers automatically pick it up. This makes adding new states (like `isShallow`, `isBaseMerged`, `isDiverged`) mechanical rather than requiring changes across multiple files. The trade-off is that the model is more complex upfront, but the complexity pays for itself with each new consumer or state added.
