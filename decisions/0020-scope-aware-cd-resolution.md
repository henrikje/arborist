# Scope-Aware cd with Worktree-First Resolution

Date: 2026-02-20

## Context

`arb cd` always interpreted its argument as a workspace name resolved from the arb root. When working deep inside a workspace on `frontend`, switching to `backend` required `arb cd my-feature/backend` — the user had to remember and type the workspace name even though they were already in it. Most other commands (`status`, `push`, `rebase`) were already workspace-scoped when run from inside a workspace. `cd` and `path` were the notable exceptions.

## Options

### Worktree-first resolution with fallback to workspace
When `ctx.currentWorkspace` is set and the input has no `/`: check worktrees in the current workspace first, fall back to workspace resolution. Interactive picker shows worktrees when inside a workspace.
- **Pros:** Intuitive — mirrors how filesystem `cd` resolves local paths first. Non-breaking since `workspace/repo` explicit syntax remains. Consistent with how other arb commands scope to the current workspace.
- **Cons:** If a worktree name collides with a workspace name, worktree wins silently. In practice rare — workspaces are feature names, worktrees are repo names.

### Require a flag or prefix for scope-aware mode
E.g., `arb cd .backend` or `arb cd --local backend`.
- **Pros:** No ambiguity — intent is always explicit.
- **Cons:** Adds syntax nobody would discover naturally. Defeats the purpose of faster navigation. Violates "convention over configuration" — other commands are implicitly scoped without flags.

## Decision

Worktree-first resolution with fallback to workspace, applied to both `arb cd` and `arb path`.

## Reasoning

The worktree-first resolution follows the filesystem `cd` analogy — local scope resolves first, then broader scope. This is the natural behavior users expect, and it aligns with every other scope-aware command in arb. The worktree/workspace name collision is a non-issue in practice (feature names vs repo names rarely overlap) and is resolvable via `arb cd workspace/repo` if it ever occurs.

The interactive picker behavior also follows the same principle: when inside a workspace with no arguments, showing worktrees is more useful than showing workspaces, since the user is likely navigating between repos in their current context.

## Consequences

`arb cd backend` navigates to the `backend` worktree when inside a workspace, and to a workspace named `backend` when at the arb root. Shell completions offer both worktree names and workspace names when inside a workspace. The `workspace/repo` explicit syntax remains as an escape hatch for the rare ambiguous case.
