# Status Model Restructuring: Nested Sub-Objects

Date: 2026-03-13

## Context

The `RepoStatus` model is a 5-section structure (identity, local, base, share, operation) from which 13 boolean `RepoFlags` are derived. Over time, the `base` section accumulated 11 flat fields serving 4 unrelated concerns (core divergence, merge lifecycle, stacked workspace, fallback tracking). Merge lifecycle fields (`mergedIntoBase`, `newCommitsAfterMerge`, `mergeCommitHash`, `detectedPr`) were only meaningful when a merge was detected, but sat flat alongside always-present fields. Similarly, the `share` section had `rebased`, `replaced`, `squashed` as 3 separate nullable numbers that were summed at 4+ call sites.

## Options

### Keep flat fields
Leave the model unchanged.
- **Pros:** No migration effort.
- **Cons:** Continued null-checking noise, repeated summation logic, mix of conditional and always-present fields.

### Nest conditional fields into structured sub-objects
Group merge lifecycle fields under `base.merge?` and divergence detection fields under `share.outdated?`.
- **Pros:** Self-documenting (presence = detection ran), eliminates repeated summation, reduces null-checking noise, conditional fields are visually grouped.
- **Cons:** One-time migration across all consumers and tests.

## Decision

Nest conditional fields into structured sub-objects. Also remove the derivable `statusLabels` field from `WorkspaceSummary` and rename `rebasedOnlyCount` to `outdatedOnlyCount` for accuracy.

## Reasoning

The restructuring follows the principle that model structure should reflect semantic grouping. Merge lifecycle fields are only meaningful together when a merge is detected — nesting them under an optional `merge?` object makes this explicit. The `outdated?` object with a pre-computed `total` eliminates the 4 repeated `(rebased ?? 0) + (replaced ?? 0) + (squashed ?? 0)` patterns and makes the `needsPull` flag computation self-documenting: `toPull > (share.outdated?.total ?? 0)`.

The `statusLabels` removal follows from it being fully derivable from `statusCounts.map(c => c.label)`. The `rebasedOnlyCount` rename corrects an inaccuracy — the field counts repos where all share divergence is accounted for by any mechanism, not just rebasing.

## Consequences

- All consumers of `RepoStatus.base` merge fields must access them through `base.merge?.kind` instead of `base.mergedIntoBase`.
- All consumers of share divergence must use `share.outdated?.total` instead of manually summing three nullable fields.
- The `--json` output schema changes: `mergedIntoBase`, `detectedPr`, `rebased`, `replaced`, `squashed` are replaced by nested `merge` and `outdated` objects. `statusLabels` is removed. `rebasedOnlyCount` becomes `outdatedOnlyCount`.
- The `remoteDiffParts` function was split into 4 case-specific sub-functions for maintainability.
