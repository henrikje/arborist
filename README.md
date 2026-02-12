# Arborist (`arb`)

**Arborist** is a workspace manager for multi-repo projects built on [Git worktrees](https://git-scm.com/docs/git-worktree). It groups repositories into named workspaces, using the same branch name across repositories, and with isolated working directories. Work on multiple features across several repos in parallel — without disturbing your main checkouts or mixing changes across tasks.

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

This puts `arb` on your PATH, sets up tab completion, and wires up the `arb cd` shell function. The core script works in any shell, but zsh is needed for `arb cd` and tab completion.

### Set up an arb root

Pick a directory to serve as the root and initialize it:

```bash
mkdir ~/my-project && cd ~/my-project
arb init
```

This creates the scaffolding arb needs — the `.arb/` marker directory. Canonical clones go in `.arb/repos/`; workspaces are created as top-level directories in the arb root.

Now clone the repos you work with. `arb clone` puts them in the right place:

```bash
arb clone git@github.com:acme/frontend.git
arb clone git@github.com:acme/backend.git
arb clone git@github.com:acme/shared.git
```

Each ends up in `.arb/repos/frontend`, `.arb/repos/backend`, and `.arb/repos/shared` respectively. These are your one-time, permanent clones — you never work in them directly. Instead, you use `arb` to create worktrees that point back to them. Also, `arb clone` is just a convenience, `git clone <url> .arb/repos/<name>` works the same way.

To see which repos have been cloned:

```bash
arb repos
```

### Create your first workspace

You create a new workspace for each feature or issue you work on. Think of a workspace as a branch across multiple repositories — it ties together one or more repos under a shared feature branch. Workspaces are cheap and disposable; the canonical repos in `repos/` are permanent, but workspaces come and go as you start and finish work.

```bash
arb create fix-login frontend backend
```

This creates the branch `fix-login` in `frontend` and `backend` (branching off each repo's default branch), sets up worktrees under `fix-login/`, and configures push tracking. Jump in with:

```bash
arb cd fix-login
```

You'll land in `fix-login/`, where `frontend/` and `backend/` are fully independent working directories on the `fix-login` branch.

To include every repo in the root, use `-a` (`--all-repos`) instead of listing them:

```bash
arb create fix-login -a
```

If you need a branch name that differs from the workspace name, pass `-b` (`--branch`):

```bash
arb create dark-mode -b "feat/dark-mode" frontend shared
```

You can add more repos to an existing workspace at any time:

```bash
arb cd fix-login
arb add shared
```

To remove a repo from a workspace without deleting the whole workspace:

```bash
arb drop shared
```

To also delete the local branch from the canonical repo when dropping:

```bash
arb drop shared --delete-branch
```

## Working with workspaces

Time to write some code! Each repo in a workspace is a regular Git worktree. You edit files, run builds, and use Git exactly as you normally would:

```bash
arb cd fix-login/frontend
# hack hack hack
git add -p
git commit -m "Fix the bug on the login page"
git push
```

The only difference is that your working directory lives under `fix-login/` instead of `repos/`, and the branch was set up for you by `arb create`. There is no `arb commit` — you commit in each repo individually, with messages tailored to each.

The commands below help you manage workspaces. They run from inside a workspace/worktree, or from anywhere in the arb root with `-w` (`--workspace`).

### Check status

```bash
arb status
```

Shows each repo's position relative to the default branch, push status against origin, and local working-tree changes (staged, modified, untracked) — everything you need at a glance.

To show only repos with uncommitted changes:

```bash
arb status --dirty
```

### Stay up to date

**`arb fetch`** fetches origin for every repo in parallel. Nothing is merged — use it to see what's changed before deciding what to do.

**`arb pull`** pulls the feature branch from origin. Useful when a teammate has pushed to the same branch. Repos that haven't been pushed yet are skipped.

**`arb push`** pushes the feature branch to origin for every repo. Skips local repos and repos where the branch hasn't been set up for tracking yet.

### Run commands across worktrees

```bash
arb exec git log --oneline -5
arb exec npm install
```

Runs the given command in each worktree sequentially and reports which succeeded or failed. Use `--dirty` to run only in repos with uncommitted changes.

### Open in your editor

```bash
arb open code
```

Runs a command with all worktrees as arguments. It can for example be used to open worktrees in an editor, like VS Code in this example.

To open only repos with uncommitted changes:

```bash
arb open --dirty code
```

### Working with AI agents

When using Claude Code or other AI coding agents, start them from the workspace directory rather than an individual repo. This gives the agent visibility across all repos in the workspace, so it can trace dependencies, coordinate changes, and understand the full picture.

```bash
arb cd fix-login
claude
```

### Navigate

`arb cd` helps you move around quickly (this is a shell function provided by `arb.zsh`, not a built-in command):

```bash
arb cd                       # go to the arb root
arb cd fix-login             # go to a workspace
arb cd fix-login/frontend    # go straight into a repo
```

`arb path` prints the same paths without changing directories — useful in scripts:

```bash
arb path fix-login   # /Users/you/my-project/fix-login
```

### List workspaces

```bash
arb list
```

The active workspace (the one you're currently inside) is marked with `*`.

### Clean up

When a feature is done:

```bash
arb remove fix-login
```

This walks you through removing worktrees and local branches, with prompts for anything destructive. To skip prompts:

```bash
arb remove fix-login -f
```

To also delete the remote branches:

```bash
arb remove fix-login -f -d
```

## Browsing the default branch

If you want a workspace that simply reflects what's on `main` (or whatever your default branch is) across all repos — to browse the code, compare against a feature branch, or just have a clean reference checkout — create a worktree named after the default branch:

```bash
arb create main -a
```

This gives you a read-friendly view of the latest default-branch code without touching your other workspaces. You can `arb cd main` to jump into it at any time.

## Multiple arb roots

Each arb root is independent. Commands find the right one by walking up from your current directory looking for the `.arb/` marker, so multiple roots coexist without interference:

```bash
cd ~/project-a && arb init
cd ~/project-b && arb init

# These each operate on their own root
cd ~/project-a && arb create feature-x frontend backend
cd ~/project-b && arb create feature-y api
```

## How it works

Arb uses marker directories and Git worktrees — no database, no daemon, no config outside the arb root.

`arb init` creates an `.arb/` marker at the root. Every other command finds its context by walking up from the current directory looking for that marker.

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

The canonical repos in `.arb/repos/` are kept in detached HEAD state. This is normal — Git requires that no two worktrees share the same checked-out branch, so the canonical clone steps aside to let workspaces own the branches.

Each workspace has a `.arbws/config` file that records the branch name:

```ini
branch = fix-login
```

Arborist does not record which worktrees belong to a workspace, it simply looks at which worktree directories exist inside it. If you `rm -rf` a single repo's worktree, arb will stop tracking it for that workspace. Git's internal worktree metadata becomes stale but is cleaned up automatically by `arb remove` or `git worktree prune`.
