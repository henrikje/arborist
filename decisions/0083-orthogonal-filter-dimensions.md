# Orthogonal Filter Dimensions and Filter Rename

Date: 2026-03-18

## Context

The `--where` filter system had grown to 23 terms but suffered from naming inconsistencies and dimension mixing. The trigger was a bug where `arb status -w pushed` returned repos displaying "not pushed" — a symptom of the deeper issue that `isUnpushed` conflated share lifecycle state (does the remote branch exist?) with share position (are there commits to push?).

Analysis revealed that repo state decomposes into 7 orthogonal dimensions: local, branch, base position, base lifecycle, share lifecycle, share position, and infrastructure. The existing filter names mixed dimensions (e.g., `unpushed` mixed share lifecycle with share position) and used inconsistent naming patterns across axes (e.g., `behind-share` vs `unpushed` for the two directions of the share axis).

## Options

### A: Fix only the `pushed`/`unpushed` bug

Add `isNeverPushed` flag, fix `pushed` filter to exclude never-pushed repos, add `not-pushed` filter term.

- **Pros:** Minimal change, fixes the immediate bug.
- **Cons:** Leaves the naming inconsistency and dimension mixing in place. `unpushed` and `not-pushed` are confusingly similar names with different meanings. The share axis naming remains asymmetric with the base axis.

### B: Full restructuring around orthogonal dimensions

Rename filters and flags to consistently reflect the dimensional model. Name positional filters with the `<position>-<axis>` pattern (`ahead-share`, `behind-share`, `ahead-base`, `behind-base`). Name lifecycle filters descriptively (`no-share`, `gone`, `merged`). Align internal flag names with filter names. Drop trivially-derivable positive terms (`synced-base`, `synced-share`, `synced`) in favor of `^` negation.

- **Pros:** Consistent naming. Clear separation of dimensions. Filter names describe state, not action. Names parallel across axes.
- **Cons:** Larger refactor. Breaking change for users of the old filter names.

## Decision

Option B — full restructuring. Pre-release phase; getting the design right outweighs compatibility.

## Reasoning

The dimensional model makes the filter set self-documenting: `ahead-share` / `behind-share` immediately communicate they're about the share axis in opposite directions, paralleling `ahead-base` / `behind-base`. The old names (`unpushed`, `needsPull`, `needsRebase`) described suggested actions rather than state, violating the principle that filters should be neutral descriptions — whether a repo "needs rebase" depends on the user's intent.

Dropping `synced-*` terms follows from `^` negation being available (DR-0032). These terms were trivially equivalent (`synced-base` = `^behind-base`, `synced-share` = `^behind-share`, `synced` = `^stale`) and the name "synced" was imprecise — it sounds like a completed action rather than a state description. Named positive terms are kept only where they provide non-trivial composition (`pushed` = `^ahead-share+^no-share`) or are natural vocabulary (`clean`, `safe`).

Internal flag names were aligned with filter names (`needsPull` → `isBehindShare`, `isUnpushed` → `isAheadOfShare`, etc.) so developers reading the code can immediately connect flags to the user-facing filters they power.

## Consequences

- **22 filter terms** (was 23): 19 problem/status + 3 positive. Two new filters (`ahead-base`, `conflict`), two renames, three removals.
- **Flag names aligned**: every flag maps obviously to its filter term.
- **Future enum restructuring enabled**: the 7 dimensions map cleanly to union types (`basePosition: "equal" | "ahead" | "behind" | "diverged"`, etc.) — deferred to a separate PR but the boolean flag names now match the enum values they'll become.
- **Display label "no branch"** in the SHARE column does not match the filter name `no-share`. This is intentional — display labels serve readability in context ("no branch" under the SHARE column header), while filter names serve discoverability and consistency (`no-share` parallels `gone` as a share lifecycle term).
