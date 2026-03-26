# Allow --force to override "behind remote" skip

Date: 2026-03-26

## Context

When a repo is strictly behind the remote (`toPush=0, toPull>0`), `arb push` skips it with "behind origin (pull first?)". This skip is unconditional — `arb push --force` has no effect because the `--force` flag only gates the "diverged" case (`will-force-push` outcome) via `applyForcePushPolicy()`, not the "behind remote" case which is classified as a hard skip in `assessPushRepo()`.

The command's own help text says "Use --force when the remote has genuinely new commits that you want to overwrite", which users naturally expect to cover the behind-remote case. The real-world scenario: a collaborator force-pushed to your branch, or commits were added to the remote that you want to discard — you want to restore the remote to your local state.

## Options

### Keep the hard skip, require `arb pull` first
Leave the behind-remote skip unconditional. Users must pull (incorporating the remote commits) before they can push.
- **Pros:** Prevents accidental loss of remote-only commits.
- **Cons:** Makes `--force` misleading — it promises to override but doesn't. Forces users to pull commits they intend to discard. No workaround within `arb push`.

### Allow `--force` to override the behind-remote skip
When `--force` is passed and the repo is behind remote, classify it as `will-force-push` with `ahead: 0` instead of skipping. The push uses `--force-with-lease` (same as other force pushes).
- **Pros:** Matches user expectations and the command's documented behavior. Consistent with how `--force` works for diverged branches. `--force-with-lease` still protects against concurrent pushes.
- **Cons:** The `ahead: 0` case is unusual — requires special plan display text ("force push (overwrite N on origin)") and result text ("force pushed (overwrote remote)") to avoid confusing "0 commits" messages.

## Decision

Allow `--force` to override the behind-remote skip. Handle it in `assessPushRepo()` at the skip point, matching the existing pattern used by `--include-wrong-branch` and `--include-merged`.

## Reasoning

The fix follows the established pattern: options that override skips are checked at the skip point in `assessPushRepo()`. The alternative — converting skips back to pushable assessments in `applyForcePushPolicy()` — conflates two responsibilities (gating vs. ungating) and would require reconstructing assessment data that the skip discards.

The `--force-with-lease` safety net applies here just as it does for diverged pushes. If someone else pushes between fetch and push, the lease check rejects it.

## Consequences

- `arb push --force` now works for repos that are behind remote, overwriting remote-only commits.
- The plan display shows "force push (overwrite N on origin)" for this case, clearly communicating the consequence.
- Without `--force`, the behavior is unchanged — behind-remote repos are still skipped with "pull first?".
- The `--force-with-lease` protection applies, preventing accidental overwrites if the remote changes between fetch and push.
