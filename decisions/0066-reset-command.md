# Dedicated `arb reset` command

Date: 2026-03-09

## Context

Users want a way to discard local changes and start fresh from the base branch across all workspace repos. The naive approach `arb exec git reset --hard origin/main` breaks when the base branch is not `main` (e.g. `develop`, or a parent feature branch in stacked workspaces) or the base remote is not `origin` (e.g. `upstream` in fork workflows). Arb already resolves both of these correctly in `gatherRepoStatus()` and uses them in `rebase`/`merge`.

## Options

### Option A: New `arb reset` command

A dedicated command following the five-phase workflow (assess → plan → confirm → execute → summarize) used by all sync commands. Encapsulates base branch and remote resolution. Shows what will be lost before executing.

- **Pros:** Safe by default (confirmation prompt, shows uncommitted changes and unpushed commits at risk). Resolves base remote/ref per repo automatically. Clean UX.
- **Cons:** New command to maintain.

### Option B: Variable substitution in `arb exec`

Add template variables like `{base}` to `arb exec` so users can write `arb exec git reset --hard {base}`.

- **Pros:** More flexible — users can use variables in any command.
- **Cons:** No safety gates for destructive operations. Violates exec's "do one thing" design. Template syntax is surprising in a CLI argument context. Opens scope creep.

## Decision

Option A — a dedicated `arb reset` command.

## Reasoning

`arb reset` earns its place by encapsulating domain knowledge (base branch + remote resolution) and adding safety for a destructive operation. This follows the GUIDELINES.md principles of "detect & protect" and "visibility & safety" — the command shows what will be lost before executing and requires explicit confirmation. Option B would have turned `exec` into a template engine, violating its intentionally simple "escape hatch for raw commands" design.

## Consequences

- `arb reset` joins the synchronization command group alongside `pull`, `push`, `rebase`, and `merge`.
- The command preserves untracked files (no `git clean`) — users who want to also remove untracked files can still use `arb exec git clean -fd` separately.
- Future commands that need base resolution can reference this pattern.
