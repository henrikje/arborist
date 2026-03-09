# Rename as Workspace Lifecycle Command

Date: 2026-03-09

## Context

`arb branch rename` renames branches across repos but does not rename the workspace directory by default. The `--rename-workspace` flag (decision 0064) added opt-in workspace directory renaming, but the mental model remained awkward: users who want to "repurpose a workspace" — new name, new branch, new base — must think in terms of "renaming the branch" even though their intent is workspace-level.

The `create`/`delete` triad in the "Workspace Commands" group was missing its natural third member: `rename`. The zero-repos case reinforced this: `arb branch rename` in a workspace with no attached repos feels like a category error (you're "renaming the branch" when there are no branches), while `arb rename` is perfectly coherent (you're renaming the workspace identity).

Decisions 0051 and 0064 rejected a standalone rename command because the earlier proposals evaluated a *directory-only* rename (wrapping `mv`). The new proposal is a *workspace identity* rename — different in kind, encapsulating multi-repo branch coordination, config management, worktree repair, validation, and safety gates.

## Options

### Add `arb rename` as a workspace lifecycle command
A top-level command completing the `create`/`delete`/`rename` triad. `arb rename` renames the workspace (directory + branch); `arb branch rename` renames just the branch.
- **Pros:** Natural mental model for "repurpose workspace." Handles zero-repos case cleanly. Symmetric with `create`/`delete`. Removes the scope mismatch from decision 0064.
- **Cons:** Two commands that can rename branches. Adds CLI surface area.

### Keep `arb branch rename --rename-workspace` only
The status quo from decision 0064. No new surface.
- **Pros:** Zero CLI bloat. Coherent with existing decision trail.
- **Cons:** Mental model mismatch for the "repurpose" workflow. Awkward zero-repos case. `rename` missing from the triad.

## Decision

Add `arb rename` as a workspace lifecycle command and remove `--rename-workspace` from `arb branch rename`. The two commands have a clean split: `arb rename` renames workspace identity (directory + branch); `arb branch rename` renames branches only.

## Reasoning

The `create`/`delete`/`rename` symmetry and zero-repos argument are compelling. `arb rename` is not a wrapper around `mv` — it coordinates multi-repo branch renames, config updates, worktree repair, base branch changes, and migration state. This is genuine domain knowledge that earns its place as a command.

The shared migration state (`branch_rename_from` in `.arbws/config`) enables cross-command recovery: either command can resume or abort work started by the other. This preserves the safety guarantees from the existing branch rename infrastructure while adding workspace-level semantics on top.

The `--branch` flag mirrors `arb create --branch`, and `--base` completes the "repurpose" workflow in a single command. `arb branch rename` retains `--include-in-progress` for lower-level branch control.

## Consequences

`--rename-workspace` is removed from `arb branch rename`. The hint text now references `arb rename` instead. `arb branch rename` becomes purely a branch-level operation.

`arb rename` is placed in the "Workspace Commands" group after `delete`, completing the lifecycle triad. Shell wrappers capture stdout for auto-cd, matching `create` and `delete`.

This decision supersedes the workspace rename aspects of decisions 0051 and 0064. The branch rename infrastructure (migration state, assessment, abort/continue) from 0051 is preserved and shared between both commands.
