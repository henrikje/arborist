# Named Flag Sets as Source of Truth

Date: 2026-02-20

## Context

Three overlapping concepts in `status.ts` — `needsAttention()`, `YELLOW_FLAGS`, and `wouldLoseWork()` — used different representations (functions vs sets) and had drifted out of alignment. Four flags were in at-risk but not yellow-colored; one flag was yellow but not at-risk. The `arb list -w at-risk` filter showed workspaces whose labels had no yellow coloring, and `arb remove` displayed flags that weren't relevant to its actual safety logic.

The root cause: three independent definitions of "which flags matter" existed without a shared foundation, and there was no explicit categorization of flags by user concern (data safety, staleness, infrastructure, lifecycle).

## Options

### Keep existing representations, fix the drift
Manually sync `needsAttention()`, `YELLOW_FLAGS`, and `wouldLoseWork()` to agree, keeping their separate representation forms.
- **Pros:** Minimal code change.
- **Cons:** Same drift will recur. Three separate definitions of overlapping concepts remain hard to audit. No clear categorization of what each flag means.

### Unify around named flag sets
Define three explicit flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) and derive all functions and coloring from them. Eliminate `YELLOW_FLAGS` and `needsAttention()`, replacing them with `isAtRisk()` derived from `AT_RISK_FLAGS`.
- **Pros:** Single source of truth for each concern. Functions are trivially derived from sets. Coloring is parameterized — `list` uses `AT_RISK_FLAGS`, `remove` uses `LOSE_WORK_FLAGS`. Adding or recategorizing a flag is a one-line change.
- **Cons:** Behavioral changes: staleness flags (`needsPull`, `needsRebase`, `isDiverged`) are no longer at-risk, so `arb status` exits 0 for merely stale workspaces.

## Decision

Unify around named flag sets as the single source of truth for flag categorization.

## Reasoning

The key insight is that flags fall into distinct user concerns: data safety (will I lose work?), staleness (am I out of date?), and infrastructure anomalies (is something unusual about this repo?). Encoding these categories as named sets makes the system self-documenting and audit-friendly. When someone asks "why is this yellow?", the answer is in the set definition, not scattered across three different representations.

Dropping staleness from at-risk is intentionally correct: being behind base is routine for active feature branches, not a condition requiring attention. The previous behavior treated "needs rebase" as at-risk, which was too noisy for daily use.

## Consequences

Adding a new flag requires deciding which set(s) it belongs to — the categorization is explicit. The `--where stale` filter becomes available for users who want to find out-of-date workspaces without conflating staleness with risk. Coloring is now context-dependent: `list` colors `AT_RISK_FLAGS` yellow, `remove` colors only `LOSE_WORK_FLAGS` yellow, so each view emphasizes what matters for its use case. Future flag additions are mechanical: add to the relevant set(s) and all consumers update automatically.
