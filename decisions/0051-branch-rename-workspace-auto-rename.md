# Branch Rename with Workspace Auto-Rename

Date: 2026-03-02

## Context

`arb create my-feature` creates a workspace directory named `my-feature/` with worktrees on branch `my-feature`. After `arb rebranch short-name`, the branch is renamed across all repos but the workspace directory retains the old name. Users must manually `mv` the directory and run `git worktree repair` in each repo — the most common post-rebranch friction point.

Separately, `rebranch` was a standalone top-level command, but conceptually it operates on the workspace branch — the same domain as `arb branch`. With `arb branch` becoming a command group (decision 0050), `rename` fits naturally as a subcommand alongside `show`.

## Options

### Standalone `arb rename` command
A new top-level command for renaming workspaces (directory and optionally branch).
- **Pros:** Clear intent, separates workspace rename from branch rename
- **Cons:** Two commands that rename branches (`rename` and `rebranch`) would confuse users; workspace rename without branch rename is a rare edge case

### `arb branch rename` with workspace auto-rename
Move `rebranch` into the `branch` group as `rename` and auto-rename the workspace directory when it matches the old branch name.
- **Pros:** Single command for the common workflow, discoverable via `arb branch --help`, matches the existing `arb branch` domain
- **Cons:** Couples two concerns (branch rename + directory rename), but opt-out flags mitigate this

### Keep `rebranch` and add `--rename-workspace`
Add a flag to the existing command without restructuring.
- **Pros:** No breaking change to command name
- **Cons:** Misses the opportunity to organize under the `branch` group, `rebranch` is a non-standard verb that users find unintuitive

## Decision

Move `rebranch` to `arb branch rename` and auto-rename the workspace directory when the directory name matches the old branch name. Provide `--workspace-name <name>` for explicit naming and `--keep-workspace-name` to opt out.

## Reasoning

The workspace directory name matching the branch name is the default path — `arb create foo` produces directory `foo/` on branch `foo`. When a user renames the branch, they almost always want the directory to follow. Making this automatic removes the most common manual step after a branch rename.

Auto-derive is limited to the safe case: workspace name equals old branch name, and the new branch name is a valid workspace name (no slashes, dots, etc.). When the new name is unsuitable (e.g. `feat/new`), the command warns and hints about `--workspace-name`. This avoids surprising transformations like silently converting `feat/new` to `feat-new`.

The standalone workspace rename case (`arb branch rename <same-branch> --workspace-name <name>`) covers the edge case where a user wants to rename just the directory without changing the branch. This reuses the existing infrastructure without a separate command.

## Consequences

`arb rebranch` is removed. Existing scripts must update to `arb branch rename`. Commander's built-in suggestion ("Did you mean branch?") helps discoverability during the transition.

The `rebranch_from` config key in `.arbws/config` is preserved unchanged for backward compatibility with in-progress migration state from older versions.

Shell wrappers (`arb.bash`, `arb.zsh`) capture stdout from `arb branch rename` and `cd` into the new directory path, matching the existing pattern used by `arb create`.

The workspace rename uses `fs.renameSync` (atomic on POSIX) followed by `git worktree repair` on each canonical repo. If the rename succeeds but worktree repair fails, branches are already renamed — the command warns and prints manual recovery instructions rather than attempting rollback.
