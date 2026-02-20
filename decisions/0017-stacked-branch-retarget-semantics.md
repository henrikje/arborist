# Stacked Branch Retarget Semantics

Date: 2026-02-19

## Context

When stacked branches are squash-merged, the base branch is deleted on the remote. Arborist detects this ("gone" refMode) and needs to retarget the child branch onto a new base. The question had several dimensions: how to detect the condition, what to target, whether to do it automatically, and how to handle the configuration update.

A critical constraint: squash merges create new commits, so `git merge-base --is-ancestor` cannot reliably distinguish a normal two-level squash merge from a deep-stack mid-merge. No deterministic git-only check can solve this.

## Options

### Auto-retarget with --retarget flag
When a base branch is gone, `arb rebase` detects it and uses `--onto` behavior automatically, targeting the repo's default branch. An explicit `--retarget` flag allows specifying a different target. All-or-nothing semantics: if retarget applies to any repo, it applies to all.
- **Pros:** Explicit opt-in to retarget. Actionable skip messages guide the user. Detection + display + skip for safety.
- **Cons:** Auto-detection always targets the default branch, which may be wrong for deep stacks.

### Dedicated `arb retarget` command
A separate command for retargeting stacked branches.
- **Pros:** Clean separation of concerns.
- **Cons:** Adds a top-level command for a rare operation. Users must learn a new command. The detection logic still lives in `arb rebase` (which needs to skip gone-base repos), so the logic is split across two places.

### Auto-retarget silently in `arb rebase`
When base is gone, automatically retarget without any flag or confirmation.
- **Pros:** Zero friction for the common case.
- **Cons:** Violates "visibility and control" — the user doesn't explicitly choose to change their base. Could silently retarget to the wrong branch in deep stacks. No opportunity to review or override.

## Decision

Auto-detect with explicit `--retarget` flag. All-or-nothing semantics. Plan display shows "base will change" warning with guidance to use `--onto` for a different target.

## Reasoning

The detection-skip-guide pattern fits arborist's "detect, warn, and protect" principle: detect the gone base, skip the repo with a clear explanation, and tell the user what to do. The `--retarget` flag makes the recovery action explicit without requiring a separate command.

All-or-nothing semantics (all repos retarget together) avoids the complexity of per-repo retarget decisions and matches how stacked branches work in practice — if the base is gone for one repo, it's gone for all repos in the workspace since they share the same branch.

Config update behavior: when retargeting to the default branch, the `base` line is removed from `.arbws/config` (dissolving the stack). When retargeting to a non-default branch, the new base is written. This reflects the reality that after a squash merge, the stack is typically dissolved.

## Consequences

The common case (two-level stack, squash merge, retarget to main) works with `arb rebase --retarget`. Deep stacks or non-default targets use `arb rebase --onto <branch>`. The plan display's "base will change" warning ensures no silent base changes. The auto-detection is conservative — it skips and guides rather than acting silently.
