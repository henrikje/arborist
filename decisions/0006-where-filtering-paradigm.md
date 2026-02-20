# --where Filtering Paradigm

Date: 2026-02-18

## Context

As the status model grew richer (dirty, unpushed, behind, drifted, diverged, detached, gone, etc.), users needed a way to filter repos by condition. The existing `--dirty` flag covered only one condition. A general-purpose filtering mechanism was needed that could express "show me repos matching any of these conditions" without inflating the option set.

No plan was preserved for this feature. This record documents the decision as implemented; the options that were considered at the time are not available.

## Decision

A single `--where` option accepting comma-separated term names with OR logic. Each term maps to a `RepoFlags` predicate. `--where dirty,unpushed` means "repos that are dirty OR unpushed." Terms are a flat list of human-readable names tied to the canonical flag model. Two aggregate terms (`at-risk` and `stale`) map to named flag sets rather than individual flags.

## Why This Is Noteworthy

The OR semantics match the exploratory use case: "show me what needs attention." AND logic is the rare case and achievable via `arb status --json | jq` for scripting.

Named terms tied to the canonical flag model keep filtering stable as features evolve. Adding a filter term for a new flag is a one-line change in `FILTER_TERMS`. The aggregate terms reuse the named flag sets from the status model, keeping the vocabulary consistent.

The `--dirty` shorthand is preserved as syntactic sugar for `--where dirty` on commands where it existed before `--where`. On `exec` and `open`, only `--dirty` is available (not `--where`) because those commands operate on working trees where "dirty" is the right scope.

## Consequences

Sixteen filter terms are available. `--where` is supported on `status`, `list`, and `remove`. `--dirty` remains on `status`, `exec`, and `open`. The comma-separated syntax enables zsh tab-completion that excludes already-typed terms. `validateWhere()` rejects unknown terms at parse time. `repoMatchesWhere()` uses `terms.some()` for OR semantics.
