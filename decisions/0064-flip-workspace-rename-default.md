# Flip Workspace Rename Default in Branch Rename

Date: 2026-03-08

## Context

Decision 0051 made `arb branch rename` auto-rename the workspace directory when the workspace name matches the old branch name. The opt-out was `--keep-workspace-name`. This was motivated by the friction of manually running `mv` + `git worktree repair` in each repo after a branch rename.

Decision 0055 later added an auto-repair safety net: arb silently detects and repairs renamed workspace directories via `requireWorkspace()` and `arb clean`. This made `mv` a supported operation, significantly reducing the cost of not auto-renaming.

In practice, the auto-rename was surprising — `arb branch rename` is a branch-level subcommand, but it silently changed the workspace's filesystem identity, moved the CWD, and ran `git worktree repair` as a side effect. The behavior was disclosed in the plan output, but the scope mismatch between the command name and its effect violated the principle of least surprise.

## Options

### Keep current behavior (auto-rename by default)
The most common path (`arb create foo` then `arb branch rename bar`) does the right thing without extra flags. The plan display is transparent.
- **Pros:** Zero-flag workflow for the common case
- **Cons:** A branch subcommand changes workspace identity as a side effect; surprising even with disclosure

### Flip the default (opt-in via `--rename-workspace`)
Don't auto-rename by default. Add `--rename-workspace` flag to opt in. Remove `--keep-workspace-name` (no longer needed).
- **Pros:** Command scope matches its name; workspace rename is still one flag away; `mv` + auto-repair covers users who forget
- **Cons:** Common workflow requires one extra flag or a manual `mv`

### Separate `arb rename` command
Strip workspace rename from `arb branch rename` entirely and create a standalone command.
- **Pros:** Clean separation of concerns
- **Cons:** Rejected by decision 0055 — wraps `mv` + one git command, doesn't earn its place; name is ambiguous

## Decision

Flip the default: `arb branch rename` no longer renames the workspace directory unless `--rename-workspace` is passed. Remove `--keep-workspace-name` and `--workspace-name <name>`, replacing all three with a single `--rename-workspace [name]` option that accepts an optional explicit name.

## Reasoning

Decision 0055's auto-repair safety net changed the cost-benefit analysis. When 0051 was written, forgetting to rename the workspace meant manual `mv` + per-repo `git worktree repair`. Now that arb detects and repairs renamed workspaces automatically, the cost of not auto-renaming is near zero — users can simply `mv` the directory.

The "do one thing" principle from GUIDELINES.md applies directly: a branch rename command should rename branches. The workspace directory is a separate concern. Making the rename opt-in via `--rename-workspace` keeps the capability accessible while matching the command's scope to its name.

A discoverability hint ("add --rename-workspace to rename it") is shown in the plan when the workspace name matches the old branch, ensuring users know the option exists.

## Consequences

`--keep-workspace-name` and `--workspace-name <name>` are removed. A single `--rename-workspace [name]` option replaces all workspace rename controls: without an argument it auto-derives the name from the new branch, with an argument it uses the explicit name.

The plan output shows a hint when workspace rename is available but not requested, preserving discoverability. Users who rely on the old auto-rename behavior must add `--rename-workspace` to their workflow.

This decision supersedes the default behavior from decision 0051 but preserves its infrastructure. Decision 0051's implementation (workspace rename logic, `git worktree repair`, migration state) remains intact — only the default trigger changes.
