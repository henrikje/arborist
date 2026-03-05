# 0058 — Conservative safe reset for rebased `arb pull --merge`

Date: 2026-03-05

## Context

`arb pull` in merge mode previously delegated diverged branches to `git pull --no-rebase`, which triggers a three-way merge. When collaborators force-pushed a rebased branch, this often produced conflicts between old remote commits and rewritten remote commits even when the local branch had no unique work to preserve.

From the user's perspective, this was a safety and usability mismatch: the plan said pull/merge, but the practical intent was "replace my old remote-tracking history with the new rewritten tip." The result was unnecessary conflict recovery work for cases that should be mechanically safe.

The challenge is proving safety. A single signal (for example `origin/branch@{1}`) is not strong enough by itself to guarantee no local committed work would be lost.

## Options

### A. Keep merge fallback for all diverged pull cases

Always use `git pull --no-rebase` when both ahead and behind.

- **Pros:** Minimal complexity, no behavioral surprise.
- **Cons:** Continues generating unnecessary conflicts after remote rebases, despite no local work to preserve.

### B. Always hard reset when remote rewrite is detected

If remote appears rewritten, replace local with remote tip unconditionally.

- **Pros:** Eliminates most rebase-related merge conflicts.
- **Cons:** Risk of deleting local committed work when detection is wrong or incomplete.

### C. Use a conservative, proof-based safe reset path

Allow hard reset only when multiple independent guards prove there is no local committed work to preserve; otherwise keep merge behavior.

- **Pros:** Avoids unnecessary conflicts while preserving Arborist's safety-first posture.
- **Cons:** More implementation complexity and some cases still fall back to merge when evidence is incomplete.

## Decision

**Option C — adopt a conservative safe-reset path for `arb pull --merge`.**

Arborist now resets to the rewritten remote tip only when all safety guards pass; otherwise it uses the existing merge path.

## Reasoning

This decision applies the core guideline "when a choice exists between power and safety, safety wins" while still fixing a real workflow pain point. Rebased remote pulls with no local unique commits are not semantically "merge my local and remote work"; they are "replace obsolete remote lineage with the updated one." A safe reset expresses that intent directly and avoids false conflicts.

The chosen design avoids trust in any single heuristic. It combines independent checks (previous remote tip resolution, rewrite detection, ancestry, no-unique-commit range, and patch-id corroboration) and treats missing evidence as unsafe. This aligns with Arborist's proactive detection model: detect risk conditions early and only automate destructive operations when confidence is high.

The plan output explicitly states "safe reset" and why it is safe ("no local commits to preserve"), preserving visibility and informed consent before mutation. This keeps Arborist's assess → plan → confirm workflow intact and understandable.

## Consequences

- `arb pull --merge` may show and execute a safe reset action for rebased remote branches with no local committed work to preserve.
- Cases with ambiguous evidence continue to use three-way merge fallback, prioritizing safety over maximal optimization.
- Pull now distinguishes conflict failures from non-conflict command failures in reporting, so recovery instructions remain accurate.
- Documentation and command help now describe the safe-reset behavior to avoid user surprise.
