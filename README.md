# Arborist (`arb`)

Working on a feature that spans multiple repositories means juggling branches across all of them — and switching to a different task while one repo has uncommitted changes is a recipe for lost work.

**Arborist** fixes this by creating workspaces backed by [Git worktrees](https://git-scm.com/docs/git-worktree). Each workspace groups several repos on the same feature branch, so you can work on multiple features in parallel without conflicts.

> **arborist** (noun) _ˈär-bə-rist_ — a specialist in the care and maintenance of trees

## Mental model

Git worktrees make it possible to check out multiple branches of the same repository at the same time, each in its own directory. Arborist builds on this by keeping a stable canonical clone of each repository and creating temporary workspaces for actual development. Each workspace represents one feature or issue. It contains a separate worktree for each selected repository, with the feature branch checked out. Workspaces can exist side by side and are removed when the task is complete.

Here's what that looks like on disk:

```
~/my-project/
├── .arb/repos/
│   ├── frontend/           ← canonical clones, managed by arb
│   ├── backend/
│   └── shared/
│
├── fix-login/              ← workspace on branch "fix-login"
│   ├── frontend/
│   └── backend/
│
└── dark-mode/              ← workspace on branch "feat/dark-mode"
    ├── frontend/
    └── shared/
```

You work in the workspaces. The canonical clones under `.arb/` are managed by arb — you never touch them directly.

## Getting started

### Install

Clone the repo and run the installer:

```bash
git clone https://github.com/henrikje/arborist
cd arborist
./install.sh
source ~/.zshrc # assuming you're running zsh
```

This puts `arb` on your PATH and sets up zsh tab completion. If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed, the installer also adds an `arb` skill so Claude can manage workspaces on your behalf. (Just run the installer again to upgrade.)

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

## Quick walkthrough

Here's the full lifecycle of a workspace — from creation to cleanup:

```bash
# Create a workspace for your feature
arb create fix-login frontend backend

# Work in individual repos as usual
arb cd fix-login/frontend
# hack hack hack
git add -p && git commit -m "Fix the login page"

arb cd fix-login/backend
# hack hack hack
git add -p && git commit -m "Fix the login endpoint"

# Check status across all repos in the workspace
arb status

# Push all repos
arb push

# Rebase both repos onto the latest base branch, then force push
arb rebase
arb push --force

# Done with the feature — clean up
arb remove fix-login
```

Every command that changes state shows a plan and asks for confirmation before proceeding.

## Day-to-day usage

The sections below go deeper on the commands you use when working in a workspace. See `arb help <command>` for all options.

### Create a workspace

You will create a new workspace for each feature or issue you work on. A workspace ties together one or more repos under a shared feature branch:

```bash
arb create fix-login frontend backend
```

This creates a `fix-login` workspace, checks out a `fix-login` branch in `frontend` and `backend`, and creates separate working directories for each under `fix-login/`. The branches are created if they do not exist.

Use `--branch` (`-b`) when the branch name differs from the workspace name, `--base` when you want to target a specific base branch (instead of each repo's default), and `--all-repos` (`-a`) to include every cloned repo:

```bash
arb create dark-mode --branch "feat/dark-mode" --base develop --all-repos
```

Running `arb create` without arguments walks you through it interactively. See `arb create --help` for all options.

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
  REPO         BRANCH        BASE                     REMOTE                          LOCAL
  repo-a       my-feature    main  aligned            origin/my-feature  aligned      clean
  repo-b       my-feature    main  2 ahead            origin/my-feature  2 to push    1 staged, 1 modified
  repo-c       experiment    main  2 ahead, 1 behind  origin/experiment  1 to pull    clean
  local-lib    my-feature    main  aligned            local                           clean
```

This view is designed to give you the full picture in one glance — repo name, current branch, how far you've drifted from the base branch, whether the remote is ahead or behind, and what's uncommitted locally. Yellow highlights things that need attention: unpushed commits, local changes, repos on an unexpected branch (like `repo-c` above).

See `arb status --help` for all options.

### Stay in sync

**See what changed** — fetch the remote for every repo without merging. Arborist fetches all repos in parallel:

```bash
arb fetch
```

**Pull teammate changes** — pull the feature branch from the remote for all repos:

```bash
arb pull
```

**Integrate base branch updates** — when the base branch has moved forward (e.g. teammates merged PRs to `main`), rebase your feature branches onto it:

```bash
arb rebase
```

Arb automatically fetches all repos before rebasing, so you always rebase onto the latest remote state. If a rebase hits conflicts, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. This way you see the complete state of all repos in one pass instead of re-running for each conflict. If you re-run while a repo is still mid-rebase, it is automatically skipped. Prefer merge commits? Use `arb merge` instead — same workflow, uses `git merge`.

Arb auto-detects each repo's default branch, so repos using `main`, `master`, or `develop` coexist without extra configuration.

**Push your work** — push the feature branch to the remote for all repos. After rebasing, use `--force` to force push with lease:

```bash
arb push
arb push --force
```

All state-changing commands (`rebase`, `merge`, `push`, `pull`) automatically fetch before operating, ensuring they work with the latest remote state. Use `--no-fetch` to skip when refs are known to be fresh. Read-only commands (`status`, `list`) do not fetch by default — use `--fetch` to opt in. If fetching fails (e.g. offline), the command warns and continues with stale data.

All commands show a plan before proceeding. See `arb help <command>` for options.

### Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
arb exec --dirty git diff -d   # --dirty is arb's, -d goes to git diff
```

Runs the given command in each worktree sequentially. It supports running interactive commands. Each execution of the command uses the corresponding worktree as working directory. Arb flags (like `--dirty`) come before the command — everything after the command name passes through verbatim. See `arb exec --help` for all options.

### Open in your editor

```bash
arb open code
# expands to:
# code /home/you/my-project/fix-login/frontend /home/you/my-project/fix-login/backend
arb open code -n --add    # -n and --add are passed to code
```

Runs the given command with all worktree directories as arguments — useful for opening them in an editor like VS Code. All directories are specified as absolute paths. Arb flags come before the command — everything after the command name passes through verbatim. See `arb open --help` for all options.

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

`arb cd` changes into a workspace or worktree directory. It requires the shell integration installed by `install.sh`:

```bash
arb cd fix-login              # cd into workspace
arb cd fix-login/frontend     # cd into a specific worktree
arb cd                        # interactive workspace picker
```

`arb path` prints the absolute path to the arb root, a workspace, or a worktree — useful in scripts and shell pipelines:

```bash
arb path                       # /home/you/my-project (the arb root)
arb path fix-login             # /home/you/my-project/fix-login
arb path fix-login/frontend    # /home/you/my-project/fix-login/frontend
```

### Add and drop repos

You can add more repos to an existing workspace at any time:

```bash
arb add shared
arb add --all-repos
```

If the workspace has a configured base branch, new worktrees branch from it. Running without arguments opens an interactive repo picker.

To remove a repo from a workspace without deleting the workspace itself:

```bash
arb drop shared
```

Arb refuses to drop repos with uncommitted changes unless you pass `--force`. See `arb drop --help` for all options.

### Remove workspaces

When a feature is done:

```bash
arb remove fix-login
```

This shows the status of each worktree and walks you through removal. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force`. When workspace templates are in use, arb also lists any template-sourced files that were modified — giving you a chance to update the templates before removing the workspace. Use `--delete-remote` to also clean up the remote branches, and `--all-ok` to batch-remove every workspace with ok status. See `arb remove --help` for all options.

## Workspace templates

Arborist can automatically seed files into new workspaces — `.env` files, Claude Code settings, IDE config, anything you want pre-provisioned. Put your templates in `.arb/templates/` and they are copied into every new workspace.

### Template directory structure

```
.arb/
  templates/
    workspace/         # overlaid onto workspace root
      .claude/
        settings.local.json
    repos/
      api/             # overlaid onto api/ worktree
        .env
      web/             # overlaid onto web/ worktree
        .env
```

The template tree mirrors the workspace structure. `workspace/` files land at the workspace root, `repos/<name>/` files land inside the corresponding worktree.

### Copy-if-missing semantics

Template files are only copied when the target doesn't already exist. Existing files are never overwritten — your customizations are always preserved. This makes templates safe to evolve over time: update the template and new workspaces get the latest version, while existing workspaces keep their current files.

### When templates are applied

- **`arb create`** — seeds workspace templates + repo templates for all created repos
- **`arb add`** — seeds repo templates for newly added repos only (workspace already set up)
- **`arb remove`** — lists any template files that differ from their originals, so you can update templates before the workspace is gone
- **No templates dir?** — silently skipped, zero noise

### Version-controlling templates

`arb init` creates `.arb/.gitignore` with a `repos/` entry, which means everything else in `.arb/` — including `templates/` — is version-controllable. You can commit your templates to a dotfiles repo, a team bootstrap repo, or just keep them local.

### Example: setting up `.env` templates

```bash
# Create template directories
mkdir -p .arb/templates/repos/api
mkdir -p .arb/templates/repos/web

# Add your .env templates
cp api/.env.example .arb/templates/repos/api/.env
cp web/.env.example .arb/templates/repos/web/.env

# Every new workspace gets these automatically
arb create my-feature --all-repos
# → Seeded 2 template file(s)
```

## Fork workflows

Arborist has built-in support for fork-based development, where you push feature branches to your fork and rebase onto the canonical (upstream) repository.

### Remote roles

Arborist thinks in terms of two remote roles:

- **upstream** — the source of base branches and the target for rebase/merge operations
- **publish** — where feature branches are pushed and pulled

For single-remote repos, both roles typically resolve to `origin`. For fork setups, the upstream role maps to the canonical repository (often a remote named `upstream`), and the publish role maps to your fork (often `origin`).

### Setting up a fork

Use `arb clone` with `--upstream` to clone a fork and register the canonical repo in one step:

```bash
arb clone https://github.com/you/api.git --upstream https://github.com/org/api.git
```

This clones your fork as `origin`, adds the canonical repo as `upstream`, sets `remote.pushDefault = origin`, and fetches both remotes.

### Auto-detection

Arborist reads `remote.pushDefault` and remote names from git config to determine roles automatically. No arborist-specific configuration is needed. Detection follows these rules:

1. Single remote — used for both roles
2. `remote.pushDefault` set — that remote is `publish`, the other is `upstream`
3. Remotes named `upstream` and `origin` — conventional fork layout
4. Ambiguous — arb reports an error with guidance on how to configure `remote.pushDefault`

### Per-repo flexibility

Different repos in a workspace can have different remote layouts. Some repos might be forked while others use a single origin. Arborist resolves remotes independently per repo.

### Status display

In fork setups, `arb status` shows the upstream remote prefix in the BASE column so you can see where each repo's base branch lives:

```
  REPO      BRANCH        BASE                          REMOTE                          LOCAL
  api       my-feature    upstream/main  2 ahead        origin/my-feature  2 to push    clean
  web       my-feature    main           aligned        origin/my-feature  aligned      clean
```

Here `api` is a fork (base is `upstream/main`) while `web` uses a single origin (base is just `main`).

## Scripting & automation

### Non-interactive mode

Pass `--yes` (`-y`) to skip confirmation prompts on `push`, `pull`, `rebase`, and `merge`. Without it, non-TTY environments (pipes, CI) exit with an error instead of hanging on a prompt:

```bash
arb rebase --yes && arb push --force --yes
```

### Machine-readable output

`arb list --json` writes a JSON array of workspace objects to stdout with aggregate status (dirty, unpushed, behind, drifted counts). Combine with `--quick` to skip status gathering:

```bash
arb list --json | jq '[.[] | select(.active)]'
arb list --json --quick | jq '.[].workspace'
```

`arb status --json` writes structured JSON to stdout. Each repo includes HEAD commit SHA, branch state, base drift, remote drift, local changes, and any in-progress operation:

```bash
arb status --json | jq '[.repos[] | select(.base.behind > 0) | .name]'
```

### Exit codes

`0` means success, `1` means failure or issues detected, `130` means the user aborted a confirmation prompt. `arb status` returns `1` when any repo has issues, making it useful as a health check:

```bash
if arb status --workspace my-feature > /dev/null; then
  echo "all clean"
fi
```

### Output separation

Human-facing output (progress, prompts, summaries) goes to stderr. Machine-parseable data (`--json`, `arb path`) goes to stdout. Colors are stripped automatically in non-TTY environments.

## Tips

### Browsing the default branch

To view the latest default-branch code across all repos:

```bash
arb create main --all-repos  # assuming main is the default branch
```

_Note_: Creating a workspace for the default branch works because Arborist keeps the canonical clones in detached HEAD state.

### Working with AI agents

When using Claude Code or other AI coding agents, start them from the workspace directory rather than an individual worktree. This gives the agent visibility across all repos in the workspace.

If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed, `install.sh` sets up an `arb` [skill](https://docs.anthropic.com/en/docs/claude-code/skills) that teaches Claude how to work with arb. Claude will automatically use the skill when it detects an arb workspace or when you mention arb-related tasks. It knows how to create and remove workspaces, check status, push, pull, rebase, and resolve conflicts — all using the correct flags for non-interactive mode. You can ask things like "create a workspace for the login feature across all repos" or "rebase and push everything" and Claude will handle the multi-repo coordination.

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

Arb auto-detects each repo's default branch by checking the upstream remote's HEAD ref (e.g. `refs/remotes/origin/HEAD` for single-remote repos, `refs/remotes/upstream/HEAD` for forks), falling back to the repo's local HEAD. Each repo resolves independently, so `main`, `master`, and `develop` can coexist across repos in the same workspace. To override a workspace's base branch explicitly, add it to the config:

```ini
branch = fix-login
base = develop
```

Arborist does not record which repos belong to a workspace — it simply looks at which worktree directories exist inside it. If you `rm -rf` a single repo's worktree, arb will stop tracking it for that workspace. Git's internal worktree metadata is cleaned up automatically by `arb remove` or `git worktree prune`.

## License

[MIT](LICENSE.md)
