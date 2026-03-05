# Shared Worktree Entry Repair

Date: 2026-03-05

## Context

When two workspaces reference the same git worktree entry (a "shared entry"), the worktree is corrupted — both see the same branch and changes bleed between them. This typically happens when an entry is pruned and git reuses its name for a new entry, while another workspace still holds a stale `.git` file referencing the old name. The previous behavior was to warn and tell users to `arb detach` then `arb attach`, but that cycle recreated the same corruption due to name reuse.

Two contributing factors: (1) the detach fallback ran a global `git worktree prune` that could destroy entries for temporarily-missing workspaces, creating the conditions for name reuse; (2) stale `.git` files in other workspaces were never cleaned up, so any entry name reuse recreated the collision.

## Options

### Reactive retry
Try `git worktree add` first, and if it fails due to a stale entry, find and remove the specific blocking entry and retry.
- **Pros:** Most conservative — only removes when actively blocked
- **Cons:** Adds retry complexity across three call sites; first attempt is a guaranteed waste when a stale entry exists at the target path

### Targeted pre-check
Before `git worktree add`, check if there's a stale entry at the exact target path. If found, remove only that one entry.
- **Pros:** Equally precise but simpler code (no retry logic); no wasted git process
- **Cons:** Preemptive, but the removal is provably necessary (target gone, same branch)

### Scoped preemptive prune (previous approach)
Scan all worktree entries targeting the workspace directory and remove stale ones before adding.
- **Pros:** Already implemented; cleans up everything in one pass
- **Cons:** Broadest scope — removes entries that aren't blocking anything yet

## Decision

Targeted pre-check for `addWorktrees`, scoped prune for detach fallback, and auto-repair of shared entries in `detectSharedWorktreeEntries`.

## Reasoning

The targeted pre-check is the best balance for `addWorktrees`: it only removes the single stale entry at the exact path about to be used, avoiding both the complexity of retry logic and the over-reach of workspace-wide pruning. For genuinely abandoned entries, git's built-in `gc.worktreePruneExpire` handles long-term cleanup.

The detach fallback uses scoped pruning (not global) because detach should always clean up its own workspace's records. Global prune was the root cause of the original corruption.

Auto-repair in `detectSharedWorktreeEntries` catches corruption that already exists: when the current workspace is the stale side of a shared entry, the stale directory is removed so the repo can be re-attached cleanly. Post-creation collision cleanup in `addWorktrees` prevents new shared entries from forming due to name reuse.

## Consequences

- Shared worktree entries are now auto-repaired instead of producing an unactionable warning. Users on the stale side see their directory removed with a message to re-attach.
- The detach+attach cycle now reliably fixes corruption because `cleanupWorktreeCollisions` removes stale `.git` files in other workspaces after entry creation.
- Global `git worktree prune` is no longer called by detach, reducing the risk of collateral entry destruction.
- Genuinely abandoned worktree entries (from deleted workspaces that won't return) are no longer eagerly pruned by `addWorktrees` — they expire via git's built-in mechanism instead.
