# Arborist (`arb`)

**Arborist** is a workspace manager for multi-repo projects built on [Git worktrees](https://git-scm.com/docs/git-worktree). It groups repositories into named workspaces, using the same branch name across repositories, with isolated working directories. Work on multiple features across several repos in parallel — without disturbing your main checkouts or mixing changes across tasks.

> **arborist** (noun) _ˈär-bə-rist_ — a specialist in the care and maintenance of trees

## Getting started

### Install

Clone the repo and run the installer:

```bash
git clone <this-repo>
cd arb
./install.sh
source ~/.zshrc
```

This puts `arb` on your PATH and sets up zsh tab completion.

### Set up an arb root

Pick a directory to serve as the root and initialize it:

```bash
mkdir ~/my-project && cd ~/my-project
arb init
```

This creates the `.arb/` marker directory. Canonical clones go in `.arb/repos/`; workspaces are created as top-level directories.

Now clone the repos you work with:

```bash
arb clone git@github.com:acme/frontend.git
arb clone git@github.com:acme/backend.git
arb clone git@github.com:acme/shared.git
```

Each ends up in `.arb/repos/<name>`. These are permanent clones — you never work in them directly. Instead, arb creates worktrees that point back to them.

To see which repos have been cloned:

```bash
arb repos
```

### Create your first workspace

Create a new workspace for each feature or issue you work on. A workspace ties together one or more repos under a shared feature branch:

```bash
arb create fix-login frontend backend
```

This creates the branch `fix-login` in `frontend` and `backend`, sets up worktrees under `fix-login/`, and configures push tracking.

To include every cloned repo, use `--all-repos` (`-a`):

```bash
arb create fix-login --all-repos
```

If you need a branch name that differs from the workspace name, pass `--branch` (`-b`):

```bash
arb create dark-mode --branch "feat/dark-mode" frontend shared
```

Running `arb create` without arguments prompts interactively for a name, branch, and repos.

## Day-to-day workflow

Each repo in a workspace is a regular Git worktree. You edit files, run builds, and use Git exactly as you normally would:

```bash
cd ~/my-project/fix-login/frontend
# hack hack hack
git add -p
git commit -m "Fix the bug on the login page"
```

There is no `arb commit` — you commit in each repo individually.

The commands below run from inside a workspace or worktree. You can also target a workspace from anywhere using `--workspace` (`-w`).

### Check status

```bash
arb status
```

Shows each repo's position relative to the default branch, push status against origin, and local changes (staged, modified, untracked). Use `--dirty` (`-d`) to show only repos with uncommitted changes:

```bash
arb status --dirty
```

### Sync with origin

**`arb fetch`** fetches origin for every repo in parallel. Nothing is merged — use it to see what's changed before deciding what to do.

**`arb pull`** pulls the feature branch from origin. Useful when a teammate has pushed to the same branch. Repos that haven't been pushed yet are skipped.

**`arb push`** pushes the feature branch to origin for every repo. Skips local repos and repos without upstream tracking.

### Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
```

Runs the given command in each worktree sequentially. Use `--dirty` (`-d`) to run only in repos with uncommitted changes.

### Open in your editor

```bash
arb open code   # VS Code
arb open idea   # IntelliJ IDEA
```

Runs the given command with all worktree directories as arguments — useful for opening them in an editor like VS Code. Use `--dirty` (`-d`) to only include repos with uncommitted changes.

## Managing workspaces

### List workspaces

```bash
arb list
```

The active workspace (the one you're currently inside) is marked with `*`.

### Navigate

`arb path` prints the absolute path to the arb root, a workspace, or a worktree within a workspace:

```bash
arb path fix-login             # /home/you/my-project/fix-login
arb path fix-login/frontend    # /home/you/my-project/fix-login/frontend
arb path                       # /home/you/my-project (the arb root)
```

### Add and drop repos

You can add more repos to an existing workspace at any time:

```bash
arb add shared
```

To add all remaining repos at once, use `--all-repos` (`-a`):

```bash
arb add --all-repos
```

To remove a repo from a workspace without deleting the workspace itself:

```bash
arb drop shared
```

To drop all repos, use `--all-repos` (`-a`):

```bash
arb drop --all-repos
```

`drop` skips repos with uncommitted changes unless `--force` (`-f`) is used. Use `--delete-branch` to also delete the local branch from the canonical repo.

Running `arb add` or `arb drop` without arguments opens an interactive repo picker.

### Remove workspaces

When a feature is done:

```bash
arb remove fix-login
```

This shows the status of each worktree and walks you through removal. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force` (`-f`):

```bash
arb remove fix-login --force
```

To also delete the remote branches, add `--delete-remote` (`-d`):

```bash
arb remove fix-login --force --delete-remote
```

You can remove multiple workspaces at once:

```bash
arb remove fix-login dark-mode
```

Running `arb remove` without arguments opens an interactive workspace picker.

### Stacked branches

To create a workspace that branches from a feature branch instead of the default branch, use `--base`:

```bash
arb create auth-ui --base feat/auth --branch feat/auth-ui --all-repos
```

The base branch is recorded in the workspace config (`.arbws/config`). When you later `arb add` repos, they also branch from the base. `arb status` compares against the base branch instead of the default.

## Tips

### Browsing the default branch

To get a read-only view of the latest default-branch code across all repos:

```bash
arb create main --all-repos
```

### Working with AI agents

When using Claude Code or other AI coding agents, start them from the workspace directory rather than an individual repo. This gives the agent visibility across all repos in the workspace.

### Multiple arb roots

Each arb root is independent. Commands find the right one by walking up from the current directory looking for the `.arb/` marker:

```bash
cd ~/project-a && arb init
cd ~/project-b && arb init
```

## How it works

Arb uses marker directories and Git worktrees — no database, no daemon, no config outside the arb root.

`arb init` creates an `.arb/` marker at the root. Every other command finds its context by walking up from the current directory.

```
~/my-project/
├── .arb/
│   └── repos/
│       ├── frontend/            # canonical clone
│       ├── backend/
│       └── shared/
├── fix-login/
│   ├── .arbws/
│   │   └── config               # branch = fix-login
│   ├── frontend/                # git worktree → .arb/repos/frontend
│   └── backend/
└── dark-mode/
    ├── .arbws/
    │   └── config               # branch = feat/dark-mode
    ├── frontend/
    └── shared/
```

The canonical repos in `.arb/repos/` are kept in detached HEAD state. Git requires that no two worktrees share the same checked-out branch, so the canonical clone steps aside to let workspaces own the branches.

Each workspace has a `.arbws/config` file that records the branch name (and optionally a base branch):

```ini
branch = fix-login
```

Arborist does not record which repos belong to a workspace — it simply looks at which worktree directories exist inside it. If you `rm -rf` a single repo's worktree, arb will stop tracking it for that workspace. Git's internal worktree metadata is cleaned up automatically by `arb remove` or `git worktree prune`.
