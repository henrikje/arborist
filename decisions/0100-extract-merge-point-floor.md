# Extract: enforce merge-point floor and remove --after-merge

Date: 2026-03-28

## Context

`arb extract` splits a branch at a boundary commit, creating a new stacked workspace. The command validates that split points are above the merge-base (the point where the branch diverged from its base). However, when a branch has been merged into its base (e.g., via squash-merge on the remote) and the user continued committing, the pre-merge commits are already represented on the base. The merge-base floor check does not catch this — it only checks against the diverge point, not the merge point.

Meanwhile, the integrate/rebase path (`classify-integrate.ts`) correctly limits replay to only `newCommitsAfter` commits, effectively using the merge point as its floor. This created an asymmetry: extract allowed grabbing commits that rebase would never replay.

Separately, `--after-merge` auto-detected the merge boundary and extracted post-merge commits. Since the merge point is the natural lower bound for valid extraction, `--after-merge` was equivalent to "start at the lowest valid split point" — a convenience, but not a primitive. Users can look up the first post-merge commit from `arb status -v` or `arb log` and use `--starting-with` explicitly, which is clearer about what gets extracted.

## Options

### Tighten bounds only (keep --after-merge)
Fix the validation gap by rejecting split points below the merge point. Keep `--after-merge` as a convenience for auto-detecting the boundary.
- **Pros:** Fixes the bug. Non-breaking.
- **Cons:** `--after-merge` is now just "use the lowest valid split point" — a thin convenience over `--starting-with`.

### Tighten bounds and remove --after-merge
Fix the validation and remove the `--after-merge` flag. Users specify split points explicitly.
- **Pros:** Simpler command surface. Extract requires users to be explicit about what they're splitting. No implicit-and-possible-to-misinterpret behavior.
- **Cons:** Slightly more steps for the post-merge extraction workflow.

## Decision

Tighten the merge-point floor validation and remove `--after-merge`. The flag was a convenience for a specific scenario, and the explicit `--starting-with` workflow is more transparent. Pre-release status makes this a clean time to simplify the command surface.

## Reasoning

The whole point of extract is to choose where to split a branch — making the user specify the split point explicitly is consistent with this intent. `--after-merge` obscured which commits were being moved. With tighter bound validation, invalid split points produce clear errors explaining why, guiding users toward valid choices.

The integrate/rebase path already enforced the merge-point floor implicitly by limiting replay. Making extract consistent with this boundary closes the asymmetry.

## Consequences

- Users who relied on `--after-merge` must now identify the first post-merge commit SHA manually. `arb status -v` and `arb log` both surface this information.
- The `arb push` hint for merged-new-work repos now suggests `arb extract <workspace> --starting-with <sha>` instead of `--after-merge`.
- Shell completions and help topics are updated to remove the flag.
- New `below-merge-point` skip flag blocks extraction when a split point falls before the merge point.
