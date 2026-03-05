# Split `arb push` merged override from force-push

Date: 2026-03-05

## Context

`arb push --force` had two independent meanings: include diverged repos for force-push, and override merged-branch skips (including recreating deleted remote branches). This made `--force` an overloaded "override everything" flag in `push`, even though these are different operator intents.

The semantics mismatch became visible in mixed workspaces: users needed force-push for rebased repos, but also had merged repos they did not want to recreate. A single flag could not express that intent. The split needed a name for the merged-override flag that works for both merged+gone and merged+not-gone states.

## Options

### `--recreate`
Use `--recreate` as the merged-override flag.
- **Pros:** Very clear for merged+gone branch restoration.
- **Cons:** Misleading for merged+not-gone, where the branch is not being recreated.

### `--allow-merged`
Use `--allow-merged` as the merged-override flag.
- **Pros:** Covers both merged states.
- **Cons:** Sounds like a broad safety bypass rather than a plan inclusion modifier.

### `--include-merged`
Use `--include-merged` as the merged-override flag.
- **Pros:** Accurately covers both merged states and reads as a plan modifier ("include these repos in the push plan").
- **Cons:** Slightly less explicit than `--recreate` for the gone-branch subcase.

## Decision

Adopt `--include-merged` on `arb push` and keep `--force` only for force-push with lease.

## Reasoning

The core issue is semantic separation, not only flag count. `--force` maps naturally to Git's force-push behavior and should stay scoped to diverged history. Merged-branch override is a separate plan decision and must be explicit.

`--include-merged` best matches Arborist's plan-first workflow: assess, show, and then include otherwise-skipped repos intentionally. It also avoids naming the flag after one subcase (`recreate`) while still allowing action text to say "to recreate" when the remote branch is gone.

## Consequences

- `arb push --force` no longer overrides merged-branch skips.
- `arb push --include-merged` is required to push already-merged repos (including recreation when gone).
- Mixed intent is now expressible: `--force` without `--include-merged` force-pushes diverged repos while keeping merged repos skipped.
