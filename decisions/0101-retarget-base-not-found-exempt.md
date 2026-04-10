# Exempt retarget-base-not-found from blocking retarget

Date: 2026-04-10

## Context

`arb retarget` applies an all-or-nothing gate: if any skipped repo has a non-exempt skip flag, the entire operation is blocked. The `retarget-base-not-found` flag fires when the old base branch is missing (neither remote nor local) and `status.base.ahead > 0`. The original intent was to block retarget when a repo has stacked work whose rebase boundary cannot be determined.

However, `ahead` is measured against the fallback default branch (e.g., `main`), not the missing old base — because when the configured base is gone, base resolution falls back to the default branch. This means any feature branch with commits ahead of `main` triggers the flag, even when the old base branch was never present on that repo. In multi-repo workspaces where only some repos have the old base branch, this blocks the entire retarget unnecessarily.

## Options

### Exempt retarget-base-not-found
Add the flag to `RETARGET_EXEMPT_SKIPS` alongside `no-base-branch` and `retarget-target-not-found`.
- **Pros:** Simple one-line change. Follows the existing flat-set exemption pattern. Repos with this flag are already skipped (not operated on), so the exemption only controls whether they block other repos.
- **Cons:** Does not distinguish "old base was never here" from "old base existed but was deleted." Both cases become non-blocking.

### Split into two distinct flags
Introduce `retarget-base-never-present` (exempt) and `retarget-base-deleted` (blocking) to preserve the safety distinction.
- **Pros:** More precise safety model in theory.
- **Cons:** The distinction cannot be reliably determined — when a branch is gone from both remote and local, there is no evidence of whether it was ever present. The `ahead` count is unreliable for this purpose (measured against fallback, not the missing base). Disproportionate complexity for no practical safety gain.

## Decision

Exempt `retarget-base-not-found` by adding it to `RETARGET_EXEMPT_SKIPS`.

## Reasoning

The exemption is safe because repos with this flag are already being skipped — they will not be rebased. The change only determines whether the skip also prevents other repos from being retargeted. After the retarget completes, the workspace config is updated to the new base, and the next `arb rebase` evaluates each repo freshly against the new base.

The split-flag approach is not implementable without maintaining per-repo history of which branches have existed, and even if it were, the "deleted" case is equally safe to exempt for the same reason: the repo is skipped, not operated on.

## Consequences

- Multi-repo workspaces where only some repos have the old base branch can now be retargeted without manual intervention.
- The `retarget-base-not-found` skip is still surfaced in the plan table (with attention styling via `BENIGN_SKIPS`), so the user sees which repos were skipped and why.
- If a future scenario arises where a repo's stacked work truly depends on the deleted old base, the repo is still skipped — no data loss occurs. The user would need to manually resolve the branch state before rebasing that repo.
