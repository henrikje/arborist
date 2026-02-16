---
name: arb
description: Manages Arborist (arb) multi-repo workspaces built on Git worktrees.
  Use when user wants to start a new feature across repos, check workspace status,
  sync branches, push or pull changes, rebase or merge, create or remove workspaces,
  or work with multiple repositories as a coordinated unit. Activates when user
  mentions "arb", "worktree", "workspace" in a multi-repo context, or when the
  current directory contains .arb/ or .arbws/ markers.
allowed-tools: Bash
---

# Arborist (arb) — Multi-Repo Workspace Manager

## Mental Model

Arborist manages parallel multi-repo development using Git worktrees. The key concepts:

- **Arb root** — A directory containing `.arb/` with `repos/` inside it. This is where canonical repo clones live and workspaces are created.
- **Canonical repos** (`.arb/repos/<name>`) — Bare-ish clones in detached HEAD. Never work in these directly.
- **Workspace** — A directory at the arb root level containing `.arbws/` marker. Each workspace holds worktrees for one or more repos, all on the same feature branch.
- **Worktree** — A Git worktree inside a workspace, linked back to the canonical repo. This is where actual development happens.

Directory layout:
```
my-project/              # arb root (.arb/ here)
├── .arb/repos/          # canonical clones
│   ├── frontend/
│   └── backend/
├── feature-login/       # workspace (.arbws/ here)
│   ├── frontend/        # worktree on branch feature-login
│   └── backend/         # worktree on branch feature-login
└── fix-auth/            # another workspace
    └── frontend/
```

All worktrees in a workspace share the same branch name. Workspaces are isolated — changes in one never affect another.

## Context Detection

Before acting on any arb-related request, determine where you are:

1. **Inside a workspace** — `.arbws/` exists in the current directory or a parent. Run `arb status --json` for structured per-repo state.
2. **At arb root** — `.arb/` exists but no `.arbws/`. Run `arb list` to show all workspaces.
3. **Outside arb** — Neither marker found. Inform the user they're not in an arb project. Offer `arb init` if they want to set one up.

To detect context programmatically, check for `.arb/` or `.arbws/` in the current directory and parents. When inside a workspace, `arb status --json` is the primary interface for understanding workspace state.

## Core Workflows

### Starting a New Feature

1. Run `arb list -q` to see existing workspaces (quick mode, skips status)
2. Derive a kebab-case workspace name from the feature description
3. Create: `arb create <name> -a -y`
   - `-a` includes all repos (omit to select specific repos)
   - `-y` skips confirmation (required — Claude has no TTY)
   - `-b <branch>` for a custom branch name (defaults to workspace name)
   - `--base <branch>` to branch from something other than the default branch
4. Navigate into the created workspace to begin work

### Checking Status

- `arb status` — Human-readable overview of all repos in the workspace
- `arb status --json` — Machine-readable output for parsing
- `arb status --fetch` — Fetch remotes first for up-to-date info
- `arb status -d` — Only show repos with uncommitted changes
- `arb status -r` — Only show repos that need attention (unpushed, drifted, dirty)

Key signals in status output:
- **dirty** — Staged, modified, or untracked files exist
- **unpushed** — Local commits not yet on the remote
- **behind base** — Base branch (e.g., main) has moved ahead; consider rebasing
- **behind remote** — Remote feature branch has commits you don't have; consider pulling
- **drifted** — Worktree is on the wrong branch (rare, usually manual intervention)

### Syncing with Upstream (Rebase or Merge)

1. Prefer `arb rebase -y` (cleaner history) unless user explicitly requests merge
2. `arb merge -y` for merge-based workflows
3. Both commands fetch first, then show a plan before proceeding
4. On conflict, arb reports which repos have conflicts and continues with the rest
5. To resolve conflicts in a specific repo:
   - `cd` into that repo's worktree directory
   - Fix the conflicting files
   - `git add .`
   - `git rebase --continue` (or `git merge --continue`)
   - Return to workspace root
6. After resolving all conflicts, `arb push -f -y` to force-push the rebased branches

### Publishing Changes

1. Run `arb status` first to understand what will be pushed
2. `arb push -y` — Push all repos with unpushed commits
3. `arb push -f -y` — Force push with lease (required after rebase)
4. `arb push repo1 repo2 -y` — Push only specific repos

### Pulling Remote Changes

1. `arb pull -y` — Pull the feature branch from the remote for all repos
2. `arb pull --rebase -y` — Pull with rebase instead of merge

### Cleaning Up

1. Always confirm with the user before removing a workspace — this is destructive
2. `arb remove <workspace>` — Remove workspace and its worktrees
3. `-d` flag also deletes remote branches
4. `-y` flag skips the confirmation prompt
5. `-f` flag overrides at-risk safety checks (implies `-y`)
6. `--all-ok` removes all workspaces that have clean status

## Working with Code Across Repos

- Work from the **workspace root** for full visibility across all repos
- Navigate into individual worktrees to edit files, then return to workspace root
- `arb exec <command>` runs a command in each worktree sequentially (e.g., `arb exec npm install`)
- `arb exec --dirty git diff` runs only in repos with local changes
- `arb open code` opens all worktrees in VS Code
- After making changes across repos, `arb push -y` publishes everything at once
- Use `arb add <repo>` to add more repos to an existing workspace
- Use `arb drop <repo>` to remove repos you no longer need in the workspace

## Working Directory

CRITICAL: Arb commands detect the workspace from the current working directory. You MUST `cd` into the workspace directory before running workspace-scoped commands (`status`, `push`, `pull`, `rebase`, `merge`, `remove`, etc.). Running from the wrong directory will silently operate on the wrong workspace — or fail with a confusing error.

The global `-w, --workspace` option exists but it is a **global option** that must come **before** the subcommand name (e.g., `arb -w my-ws push --dry-run`, NOT `arb push -w my-ws`). Due to this ordering restriction, `cd`-ing into the workspace is the safer and recommended approach.

## Non-Interactive Mode

CRITICAL: Claude runs without a TTY. Always follow these rules:

- **Preview before executing** — Use `--dry-run` (`-n`) on `push`, `pull`, `rebase`, `merge`, and `remove` to see what would happen before committing. Then execute with `--yes`:
  ```
  arb push --dry-run        # preview the plan
  arb push --yes            # execute it
  ```
- **Always pass `-y` / `--yes`** to `create`, `remove`, `push`, `pull`, `rebase`, and `merge` when you are ready to execute. Without `-y`, these commands will hang waiting for input.
- Use `--json` on `arb status` or `arb list` when you need to parse the output programmatically.
- `arb list -q` for fast workspace listing without status computation.
- Exit codes: 0 = success, 1 = expected failure (conflicts, nothing to do), 2 = unexpected error.

Commands that do NOT need `-y`: `init`, `clone`, `repos`, `list`, `path`, `cd`, `add`, `drop`, `status`, `fetch`, `exec`, `open`.

## Safety Rules

1. **Preview before executing** — Use `--dry-run` on `push`, `pull`, `rebase`, `merge`, and `remove` to see what would happen before committing with `--yes`.
2. **Always use `arb` commands instead of raw `git` when inside a workspace** — Use `arb push` instead of `git push`, `arb pull` instead of `git pull`, `arb rebase` instead of `git rebase`, etc. Arb commands handle worktree-specific concerns (tracking, remote resolution, multi-repo coordination) that raw git does not. Only fall back to raw git for operations arb doesn't cover (e.g., `git add`, `git commit`, `git diff`).
3. **Never `arb remove` without user confirmation** — This deletes worktrees and cannot be undone. Always ask first.
4. **Never use `--force` on remove** without user consent — Bypasses dirty/unpushed safety checks.
5. **Prefer rebase over merge** unless the user explicitly asks for merge.
6. **Run `arb status` before sync operations** to understand current state before rebasing, merging, pushing, or pulling.
7. **Guide through conflicts** — When conflicts occur, walk the user through resolution repo by repo. Do NOT force-skip or abort without asking.
8. **Force push only after rebase** — `arb push -f -y` uses `--force-with-lease` internally, but only use it when branches have been rebased.

## Command Quick Reference

| Command | Description |
|---------|-------------|
| `arb init [path]` | Initialize a new arb root |
| `arb clone <url> [name]` | Clone a repo into `.arb/repos/` |
| `arb repos` | List all cloned repos |
| `arb create [name] [repos...]` | Create a new workspace |
| `arb remove [names...]` | Remove workspaces |
| `arb list` | List all workspaces |
| `arb path [name]` | Print path to arb root, workspace, or worktree |
| `arb cd [name]` | Navigate to a workspace |
| `arb add [repos...]` | Add worktrees to current workspace |
| `arb drop [repos...]` | Remove worktrees from current workspace |
| `arb status` | Show workspace status |
| `arb fetch` | Fetch all repos from remotes |
| `arb pull [repos...]` | Pull feature branch from remote |
| `arb push [repos...]` | Push feature branch to remote |
| `arb rebase [repos...]` | Rebase onto base branch |
| `arb merge [repos...]` | Merge base branch into feature |
| `arb exec <cmd>` | Run command in each worktree |
| `arb open <cmd>` | Open worktrees in an application |

For complete flag details, see `references/commands.md`.
