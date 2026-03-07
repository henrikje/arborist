# Auto-push when all remote commits are outdated

Date: 2026-03-07

## Context

When a user squashes commits or rebases a branch that has already been pushed, `arb push` reports "diverged from origin (use --force)" and refuses to push without `--force`. Git sees divergence because local and remote histories have diverged — but from the user's perspective, the remote commits are obsolete versions of their own work, not genuinely conflicting changes from someone else.

Arborist already gathers the data needed to distinguish these cases: `detectRebasedCommits()` finds commits with matching patch-ids (same diff, different hash — typical after rebase), and `detectReplacedCommits()` finds remote commits in the local reflog (typical after squash or amend). However, `assessPushRepo()` ignored this data and always required `--force` when `toPush > 0 && toPull > 0`.

## Options

### Always require --force for any divergence
Keep the existing behavior. Users must always pass `--force` when the branch has diverged, regardless of whether the remote commits are their own outdated work.
- **Pros:** Simple, safe, no risk of accidental data loss.
- **Cons:** Creates unnecessary friction for the most common divergence scenario (rebase/squash). Users learn to always pass `--force`, which defeats the purpose of the safety check.

### Auto-push when all remote commits are accounted for
When `rebased + replaced >= toPull`, treat the push as safe (all remote commits are known outdated versions). Use `--force-with-lease` for safety but don't require the `--force` flag. Still require `--force` for genuine divergence (remote has commits not accounted for).
- **Pros:** Eliminates friction for the common case. Preserves safety for the dangerous case (someone else pushed to your branch). `--force-with-lease` provides a final safety net.
- **Cons:** Relies on reflog for squash detection (unavailable on fresh clones or after reflog expiry). In those edge cases, falls back to requiring `--force`, which is the safe default.

## Decision

Auto-push when all remote commits are accounted for, using a new `"will-force-push-outdated"` outcome that proceeds without `--force` and uses `--force-with-lease`.

## Reasoning

The `--force` gate exists to protect against accidentally overwriting someone else's work on a shared branch. When all remote commits are confirmed to be the user's own outdated work (via patch-id matching or reflog), requiring `--force` adds friction without adding safety. The fallback behavior when detection fails (null rebased/replaced) is to require `--force` as before, so the change is strictly additive.

Using `--force-with-lease` (already used for explicit `--force` pushes) provides an additional safety net: if someone else pushes to the branch between fetch and push, the push will be rejected by the server.

## Consequences

- `arb push` after rebase or squash now succeeds without `--force` in most cases, matching user expectations.
- Genuinely diverged branches (someone else pushed new commits) still require `--force`, preserving the safety check where it matters.
- On fresh clones without reflog history, squash detection via `detectReplacedCommits()` won't find matches, so those cases still require `--force`. Rebase detection via patch-id matching is unaffected (works without reflog).
- The `--force` flag remains functional and can still be used explicitly for any diverged push.
