# Cumulative Patch-ID Squash Detection

Date: 2026-03-12

## Context

When a user squashes N pushed commits into fewer local commits, `arb push` requires `--force` even though the remote commits are obsolete. The existing detection mechanisms both fail in certain cases:

1. **`detectRebasedCommits`** (patch-id 1:1 matching) cannot match a squashed commit against individual pre-squash commits because the diffs differ.
2. **`detectReplacedCommits`** (reflog hash lookup) usually catches squashes but fails on fresh clones or when reflog is unavailable (expired, or after `reflog expire`).

A third mechanism was needed that works purely from content comparison, without depending on reflog history.

## Options

### Cumulative patch-id comparison
Compare the combined diff of all remote-only commits against the combined diff of all local-only commits using `git diff mergeBase..ref | git patch-id --stable`. If the patch-ids match, the content is equivalent regardless of how many commits are on each side.
- **Pros:** No reflog dependency. Uses git's own content-addressing. Handles any squash/split scenario where the net changes are the same.
- **Cons:** Cannot detect squash + additional changes (cumulative diffs won't match). Two extra `git diff | git patch-id` calls when the first two mechanisms fail.

### Track pushed commits in arb state
Store commit hashes in `.arb/` after each push, then compare against remote-only commits.
- **Pros:** No git internals dependency.
- **Cons:** New persistent state to manage, stale data risk, doesn't work retroactively.

### Accept the limitation
Keep the current behavior — require `--force` when reflog is unavailable.
- **Pros:** No new code.
- **Cons:** Creates unnecessary friction for the common squash workflow, especially on fresh clones.

## Decision

Cumulative patch-id comparison, implemented as `detectSquashedCommits()` in `rebase-analysis.ts`. It runs as a third detection pass only when `detectRebasedCommits` and `detectReplacedCommits` leave unmatched remote commits.

## Reasoning

The three mechanisms are complementary and each handles a different rewrite scenario:
- **Patch-id** (1:1): catches rebases (same diff, hash changed)
- **Reflog**: catches amends and squashes when reflog is available (different diff, hash changed)
- **Cumulative patch-id**: catches squashes regardless of reflog (same net diff across all commits)

The detection pipeline is ordered from cheapest to most expensive, with each mechanism only running when prior ones leave unmatched commits. The cumulative check adds two `git diff | git patch-id` calls, which are cheap for typical feature branches.

## Consequences

- `arb push` after squash now succeeds without `--force` even on fresh clones or after reflog expiry.
- A new `squashed` field is added to `RepoStatus.share` (alongside `rebased` and `replaced`), requiring updates to the Zod JSON schema and all consumers that sum outdated counts.
- When cumulative diffs don't match (squash + new changes, or genuine divergence), the function returns `null` and the push falls back to requiring `--force` — the safe default.
