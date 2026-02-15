# Arborist (`arb`)

**Arborist** is a workspace manager that makes multi-repo development safe and simple. Built on [Git worktrees](https://git-scm.com/docs/git-worktree), it creates isolated workspaces so you can work on cross-repo features in parallel.

> **arborist** (noun) _ˈär-bə-rist_ — a specialist in the care and maintenance of trees

## Mental model

Git worktrees make it possible to check out multiple branches of the same repository at the same time, each in its own directory. Arborist builds on this by keeping a stable canonical clone of each repository and creating temporary workspaces for actual development. Each workspace represents one feature or issue. It contains a separate worktree for each selected repository, with the feature branch checked out. Workspaces can exist side by side and are removed when the task is complete.

## Getting started

### Install

Clone the repo and run the installer:

```bash
git clone <this-repo>
cd arb
./install.sh
source ~/.zshrc
```

This puts `arb` on your PATH and sets up zsh tab completion. (Just run the installer again to upgrade.)

### Set up an arb root

An arb root is the top-level directory that holds all your workspaces for a given project.

Pick a directory to serve as the root and initialize it:

```bash
mkdir ~/my-project && cd ~/my-project
arb init
```

This creates the `.arb/` marker directory. Repository clones go in `.arb/repos/` and your workspaces are created as top-level directories.

### Clone some repos

Now clone the repositories you work with in that project:

```bash
arb clone https://github.com/example/frontend.git
arb clone https://github.com/example/backend.git
arb clone https://github.com/example/shared.git
```

Each repository ends up in `.arb/repos/<name>`. These are canonical clones — you never work in them directly. Instead, arb creates worktrees that point back to them.

To see which repos have been cloned:

```bash
arb repos
```

## Day-to-day workflow

### Create a workspace for your task

You will create a new workspace for each feature or issue you work on. A workspace ties together one or more repos under a shared feature branch:

```bash
arb create fix-login frontend backend
```

This creates a `fix-login` workspace, checks out a `fix-login` branch in `frontend` and `backend`, and creates separate working directories for each under `fix-login/`. The branches are created if they do not exist and set up with upstream tracking.

_Tip_: using an issue number or feature name as a workspace name is a good starting point.

- `--all-repos` (`-a`): include every cloned repo — `arb create fix-login --all-repos`
- `--branch` (`-b`): use a different branch name — `arb create dark-mode --branch "feat/dark-mode" frontend shared`
- `--base`: stack on another branch — `arb create auth-ui --base feat/auth --all-repos`
- Running without arguments prompts interactively for name, branch, and repos.

### Work in your repos as usual

Each directory in a workspace is a regular Git worktree. You edit files, run builds, and use Git exactly as you normally would:

```bash
cd ~/my-project/fix-login/frontend
# hack hack hack
git add -p
git commit -m "Fix the bug on the login page"
```

There is no `arb commit` — you commit in each repo individually.

The commands below run from inside a workspace or worktree. You can also target a workspace from anywhere using `--workspace` (`-w`).

### Check status

Once you've made some changes, you can check the status of your workspace:

```bash
arb status
```

This shows the state of each worktree in a compact table with labeled columns:

```
  REPO         BRANCH        BASE                     ORIGIN                          LOCAL
  repo-a       my-feature    main  aligned            origin/my-feature  aligned      clean
  repo-b       my-feature    main  2 ahead            origin/my-feature  2 to push    1 staged, 1 modified
  repo-c       experiment    main  2 ahead, 1 behind  origin/experiment  1 to pull    clean
  local-lib    my-feature    main  aligned            local                           clean
```

The columns show: repo name, current branch, base branch with ahead/behind counts, remote tracking branch with push/pull counts, and local changes. The active worktree (if you're currently inside one) is marked with `*`.

Yellow highlights things that need attention: unpushed commits, local changes, unexpected branches.

- `--dirty` (`-d`): only repos with uncommitted changes
- `--at-risk` (`-r`): only repos that need attention (unpushed, drifted, dirty)
- `--fetch` (`-f`): fetch before showing status
- `--verbose`: file-level detail
- `--json`: machine-readable output

### Stay in sync

There are several commands to sync your workspace with origin:

```bash
arb fetch
```

Fetches origin for every repo without merging any changes. You can use it to see what's changed before deciding what to do. To speed things up, Arborist fetches all repositories in parallel.

```bash
arb pull
```

Pulls the feature branch from origin for all repos. Shows a plan of what will happen, then asks for confirmation. Pass repo names to pull specific repos. Use `--rebase` or `--merge` to override the pull strategy; by default, arb detects the strategy from your Git config. Use `--yes` (`-y`) to skip confirmation.

```bash
arb push
```

Pushes the feature branch to origin for all repos. Shows a plan of what will happen, then asks for confirmation. Pass repo names to push specific repos. Use `--force` (`-f`) to force push with lease — needed after rebasing or amending commits. Use `--yes` (`-y`) to skip confirmation.

### Integrate base branch changes

When the base branch has moved forward (e.g. teammates merged PRs to `main`),
bring those changes into your feature branches:

```bash
arb rebase
```

Rebases all repos by default, or pass repo names to target specific ones. Shows a plan of what will happen, then asks for confirmation. Repos with uncommitted changes or that are already up to date are skipped. Use `--fetch` to fetch before rebasing and `--yes` (`-y`) to skip confirmation.

If a rebase conflicts, arb stops and shows instructions. Resolve the conflict with git, then re-run `arb rebase` for the remaining repos.

Prefer merge commits? Use `arb merge` instead — same workflow, uses `git merge`.

After rebasing, your branches will have diverged from origin. Force push to update:

```bash
arb push --force
```

### Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
```

Runs the given command in each worktree sequentially. It supports running interactive commands. Each execution of the command uses the corresponding worktree as working directory. Use `--dirty` (`-d`) to run only in repos with uncommitted changes.

### Open in your editor

```bash
arb open code   
# expands to:
# code /home/you/my-project/fix-login/frontend /home/you/my-project/fix-login/backend
```

Runs the given command with all worktree directories as arguments — useful for opening them in an editor like VS Code. All directories are specified as absolute paths. Use `--dirty` (`-d`) to only include repos with uncommitted changes.

## Managing workspaces

### List workspaces

```bash
arb list
```

Shows all workspaces with their branch, repo count, and aggregate status:

```
  WORKSPACE    BRANCH         REPOS  STATUS
* ws-one       my-feature     2      ok
  ws-two       feat/payments  1      1 dirty, 1 unpushed
```

The active workspace (the one you're currently inside) is marked with `*`.

### Navigate

`arb path` prints the absolute path to the arb root, a workspace, or a worktree from anywhere below the arb root:

```bash
arb path                       # /home/you/my-project (the arb root)
arb path fix-login             # /home/you/my-project/fix-login
arb path fix-login/frontend    # /home/you/my-project/fix-login/frontend
```

### Add and drop repos

You can add more repos to an existing workspace at any time:

```bash
arb add shared
```

If the workspace has a configured base branch, new worktrees branch from it.

- `--all-repos` (`-a`): add all remaining repos — `arb add --all-repos`
- Running without arguments opens an interactive repo picker.

To remove a repo from a workspace without deleting the workspace itself:

```bash
arb drop shared
```

- `--all-repos` (`-a`): drop all repos — `arb drop --all-repos`
- `--force` (`-f`): drop even with uncommitted changes
- `--delete-branch`: also delete the local branch from the canonical repo
- Running without arguments opens an interactive repo picker.

### Remove workspaces

When a feature is done:

```bash
arb remove fix-login
```

This shows the status of each worktree and walks you through removal. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force` (`-f`).

- `--force` (`-f`): skip safety prompts — `arb remove fix-login --force`
- `--delete-remote` (`-d`): also delete remote branches
- Remove multiple: `arb remove fix-login dark-mode`
- Running without arguments opens a workspace picker.

## Tips

### Browsing the default branch

To view the latest default-branch code across all repos:

```bash
arb create main --all-repos  # assuming main is the default branch
```

_Note_: Creating a workspace for the default branch works because Arborist keeps the canonical clones in detached HEAD state. 

### Working with AI agents

When using Claude Code or other AI coding agents, start them from the workspace directory rather than an individual worktree. This gives the agent visibility across all repos in the workspace.

### Multiple arb roots

Each arb root is independent. Commands find the right one by walking up from the current directory looking for the `.arb/` marker. Feel free to create multiple roots for different projects:

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

## License

[MIT](LICENSE.md)
