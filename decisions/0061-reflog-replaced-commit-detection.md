# Reflog-Based Replaced Commit Detection

Date: 2026-03-06

## Context

When a user amends a commit and force-pushes, the status display shows "1 new → 1 new". The pull-side "1 new" is misleading — it's the old commit being replaced, not genuinely new content from a colleague. The existing `detectRebasedCommits()` uses `git patch-id --stable` to match commits with identical diffs on both sides, which correctly detects rebases (same diff, different hash) but cannot detect amends (different diff, different hash). A complementary detection mechanism was needed for rewritten commits whose content changed.

## Options

### Reflog hash membership
Check if remote-only commit hashes appear in the local branch's reflog. Git records every commit that was ever the branch tip, including the original before an amend.
- **Pros:** Cheap (single `git log -g` call), handles all rewrite scenarios (amend, interactive rebase), already a pattern in the codebase (`pull.ts` uses `@{1}`).
- **Cons:** Depends on reflog availability (won't work on fresh clones or after 90-day expiry).

### Extended patch-id with fuzzy matching
Compare commit metadata (author, timestamp, subject) alongside patch-ids to detect "similar" commits.
- **Pros:** No reflog dependency.
- **Cons:** Fragile heuristic, false positives likely, complex to tune.

### Track pushed commits in arb state
Store commit hashes in `.arb/` after each push, then compare against remote-only commits.
- **Pros:** No git dependency beyond hash comparison.
- **Cons:** New persistent state to manage, stale data risk, doesn't work retroactively.

## Decision

Use reflog hash membership, keeping the existing patch-id detection as the primary mechanism. Reflog detection runs only when there are unmatched pull-side commits after patch-id analysis.

## Reasoning

Reflog is the natural source of truth for "what was previously on this branch." It requires no new state management and handles all rewrite scenarios. The 90-day expiry limitation is irrelevant for the typical push-amend-push cycle (minutes to hours). Keeping patch-id detection as the primary mechanism ensures coverage for edge cases where reflog is unavailable (fresh clones). The two mechanisms are complementary: patch-id catches same-diff rewrites, reflog catches changed-diff rewrites.

## Consequences

- The display changes from "1 new → 1 new" to "1 new → 1 outdated" for the common amend-then-push flow. "Outdated" is used for both rebased and replaced commits, keeping the display simple.
- The `needsPull` flag now only triggers for genuinely new remote commits, reducing false yellow "behind share" warnings.
- A new `replaced` field is added to `RepoStatus.share`, requiring updates to the Zod JSON schema.
- Fresh clones without reflog history will still show "new" for replaced commits — this is acceptable as the scenario is rare in practice.
