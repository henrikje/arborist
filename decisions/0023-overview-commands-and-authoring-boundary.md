# Overview Commands and the Authoring Boundary

Date: 2026-02-21

## Context

After implementing `arb log`, the natural next question was: what other commands belong in the commit-to-PR workflow? The candidates included `arb diff` (feature branch change set), `arb commit` (multi-repo commits), and `arb pr` (pull request creation). This required establishing a clear boundary for what Arborist should and shouldn't do.

Analysis of each candidate against Arborist's purpose revealed two distinct categories: overview commands that provide workspace-level visibility (read-only, scoped to the feature branch), and authoring/platform operations that involve per-repo creative decisions or vendor-specific workflows.

## Options

### Add all commit-to-PR commands
Implement `arb diff`, `arb commit`, and `arb pr` to provide a complete workflow from coding to PR.
- **Pros:** Complete workflow without leaving arb.
- **Cons:** `commit` requires per-repo staging decisions that are inherently interactive and per-repo. `pr` involves vendor-specific APIs (GitHub, GitLab) and organization-specific workflows. Both expand Arborist's scope beyond coordination into authoring.

### Add only overview commands, draw the boundary explicitly
Implement `arb diff` as an overview command (same justification as `arb log`). Reject `arb commit` and `arb pr` as outside scope. Codify two new principles.
- **Pros:** Clear boundary, focused scope, `arb exec` covers the authoring gap.
- **Cons:** Users must use `arb exec git commit` and `arb exec gh pr create` for those operations.

### Add nothing, keep the status quo
Leave `arb log` as the only overview command beyond `arb status`.
- **Pros:** Minimal surface area.
- **Cons:** `arb diff` has the exact same justification as `arb log` — workspace-aware feature branch scoping — and its absence is a gap in the overview layer.

## Decision

Add `arb diff` as an overview command. Reject `arb commit` and `arb pr`. Codify two new guidelines: "Coordination and overview, not authoring" and "Do one thing and do it well." Remove `--all` from `arb log` to align with the "do one thing well" principle.

## Reasoning

`arb diff` answers the same question as `arb log` — "what has this feature branch done?" — from a different angle (change set vs. commits). It shares the same justification: workspace-aware scoping with base branch resolution, read-only, and valuable across multiple repos. The three overview commands (`status`, `log`, `diff`) form a coherent layer.

`arb commit` fails the test because committing is an authoring act. Staging decisions are per-repo and often require judgment about what belongs in each commit. Multi-repo atomic commits would create a false sense of atomicity. `arb exec --dirty git commit` is sufficient.

`arb pr` fails the test because PR creation is a platform operation. GitHub, GitLab, and other platforms have different APIs, different required fields, and organizations have different PR workflows. `arb exec gh pr create` is sufficient.

The `--all` flag on `arb log` was removed because it turns a focused feature-branch overview command into a general-purpose git log viewer — violating "do one thing well." `arb exec git log` covers the general case.

`arb diff` uses three-dot notation (`base...HEAD`) because `git diff A...B` computes the merge base and diffs from there to B, showing what the feature branch introduced. This matches what a PR reviewer sees. This differs from `arb log`'s two-dot (`base..HEAD`) because git's log and diff interpret the dot notation differently — both are correct for their purposes.

## Consequences

- `arb status`, `arb log`, and `arb diff` form the overview command category with shared conventions: read-only, no-fetch-by-default, workspace-scoped, skip detached/drifted with explanation, support `[repos...]` and `--json`.
- `arb commit` and `arb pr` are explicitly out of scope. The reasoning is preserved here for when the question resurfaces.
- `arb log --all` is removed. Users who want full git log use `arb exec git log`.
- Two new guidelines ("Coordination and overview, not authoring" and "Do one thing and do it well") are added to GUIDELINES.md, providing a framework for evaluating future command proposals.
