# Reflog Ancestry Walk for Fast-Forward Intermediates

Date: 2026-03-14

## Context

The `detectReplacedCommits()` function uses `git log -g --format=%H` to collect commit hashes that were previously the tip of the local branch. When a remote-only commit (from `HEAD..trackingRef`) appears in this set, it is classified as "replaced" — meaning it was once on the branch and has since been rewritten.

After a fast-forward pull (A to A-B-C-D), git only records the new tip D in the branch reflog. Intermediate commits B and C are never tips, so they are absent from the reflog. If the developer subsequently rewrites the branch with content changes (e.g., squashing B+C into a single commit with different content), all three detection phases fail for the intermediates:

1. **Patch-id** fails because the diffs changed.
2. **Reflog** fails because B and C were never reflog tips.
3. **Cumulative patch-id** fails because the net diff also changed.

The consequence is that `arb push` requires `--force` even though B and C are genuinely replaced. This is safe but unnecessarily inconvenient.

## Options

### Ancestry walk from older reflog tips

After collecting reflog tips, run an additional `git log --format=%H --max-count=1000 <older-tips> --not HEAD` to extend the set with ancestors of each previous branch state. This captures intermediates that were "on the branch" when a given reflog tip was current, even if they were never the tip themselves.

- **Pros:** Single additional git command. Captures all fast-forward intermediates. No new state to manage. Cannot introduce false positives — every commit in the extended set was genuinely on the branch at some point.
- **Cons:** One extra `git log` call per status check. The `--max-count=1000` limit could theoretically miss very long ancestor chains, though this is unlikely for typical feature branches.

### Accept the limitation

Keep the current tip-only behavior. The false negative causes `arb push` to require `--force`, which is the safe default.

- **Pros:** No new code or performance cost.
- **Cons:** Friction for users who pull collaborator commits and then rewrite them — a reasonable workflow.

## Decision

Ancestry walk from older reflog tips. The additional `git log` call extends the reflog hash set to include fast-forward intermediates.

## Reasoning

The reflog tip-only approach was originally correct for the common case (amend/rebase of locally authored commits), but missed the collaborative fast-forward-then-rewrite workflow. The ancestry walk fills this gap without introducing false positives: every commit reachable from an old reflog tip but not from HEAD was genuinely on the branch and has since been displaced. The `--not HEAD` stop condition ensures we only collect displaced commits, and the intersection with `HEAD..trackingRef` further limits matches to commits that are actually on the remote.

## Consequences

- `arb push` after a fast-forward pull + content-changing rewrite now auto-force-pushes without requiring `--force`, matching the behavior for locally-authored rewrites.
- One additional `git log` call per `detectReplacedCommits()` invocation. The `--max-count=1000` cap and git's internal deduplication across multiple starting points keep this cheap.
- The `--max-count=1000` limit means extremely long ancestor chains (>1000 displaced commits) could still miss some intermediates. This is acceptable — such branches would have other problems.
