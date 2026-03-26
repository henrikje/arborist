# Arborist (`arb`)

**Arborist** lets you work on multiple features across several repositories at the same time, without juggling branches, breaking your flow, or losing changes.

Based on [Git worktrees](https://git-scm.com/docs/git-worktree), Arborist complements standard Git with structured workspaces and cross-repo coordination. If your project spans multiple repos — microservices, a frontend/backend split, shared libraries — Arborist keeps them in sync.

> **arborist** (noun) _ˈär-bə-rist_ — a specialist in the care and maintenance of trees

## Mental model

Git worktrees make it possible to check out multiple branches of the same repository at the same time, each in its own directory. Arborist builds on this by keeping a stable reference clone (a clean, unchanged copy of the repository that is never directly modified) of each repository and creating temporary workspaces for actual development.

Here's what that looks like on disk:

```
~/my-project/
├── .arb/repos/
│   ├── frontend/           ← reference clones, managed by Arborist
│   ├── backend/
│   └── shared/
│
├── add-dark-mode/          ← workspace on branch "add-dark-mode"
│   ├── frontend/
│   └── backend/
│
└── fix-login-crash/        ← workspace on branch "fix-login-crash"
    └── frontend/
```

You work in the workspaces. Each workspace is an isolated development environment, typically used to represent one feature or issue. It contains a working copy of each selected repository, with the feature branch checked out. Workspaces can exist side by side and are removed when the task is complete. The reference clones under `.arb/` are managed by Arborist — you never touch them directly.

Keeping your work in sync involves two axes:

| Axis            | Commands          | Purpose                                                      |
|-----------------|-------------------|--------------------------------------------------------------|
| **Integration** | `rebase`, `merge` | Keep your feature branch up to date with the base branch     |
| **Sharing**     | `push`, `pull`    | Share your feature branch with collaborators                 |

Arborist's synchronization commands handle this across all repos at once. Under the hood, Arborist tracks the identity and state of commits across both axes — detecting rebases, squash merges, and conflicts before they happen — so its commands can tell you what's safe before you act.

## Install

Arborist requires Git 2.17+ and works on macOS, Linux, or Windows using WSL. Git 2.38+ enables conflict prediction before rebase, merge, and pull operations.

**Quick install**:
```
curl -fsSL https://raw.githubusercontent.com/henrikje/arborist/main/install.sh | bash
```

**Homebrew**:
```
brew install henrikje/tap/arb
```
On Linux, install [Homebrew's requirements](https://docs.brew.sh/Homebrew-on-Linux#requirements) to avoid "cannot be installed" errors.

**From source** (requires [Bun](https://bun.sh)):
```
git clone https://github.com/henrikje/arborist
cd arborist
./install.sh
```

## A quick tour

### Setup

```bash
mkdir ~/my-project
cd ~/my-project
arb init
```

```
Initialized project
  ~/my-project

Next steps:
  arb repo clone <url>  Clone repos into the project
  arb create <name>     Create a workspace
```

`arb init` marks the current directory as an Arborist project to hold your workspaces.

Next, clone the repositories you want to work with. They are stored in `.arb/repos`.

```bash
arb repo clone https://github.com/example/frontend.git
arb repo clone https://github.com/example/backend.git
arb repo clone https://github.com/example/shared.git
```

### Start a feature

With the repos cloned, create a workspace. Let's say you're adding dark mode.

```bash
arb create add-dark-mode
```

```
› Workspace: add-dark-mode
› Branch: add-dark-mode (same as workspace, use --branch to override)
› Base: repo default (use --base to override)
```

Without repo arguments, Arborist prompts you to pick which repos to include. Not every feature touches every repo — picking just the ones you need keeps the workspace focused.

```
? Repos:
  ◉ backend
❯ ◉ frontend
  ◯ shared

↑↓ navigate • space select • a all • i invert • ⏎ submit
```

Both selected repos will be checked out on the `add-dark-mode` branch. With the optional [shell integration](docs/workspaces.md#navigate) installed, Arborist automatically moves you into the new workspace.

```bash
# You're in ~/my-project/add-dark-mode
cd frontend
# hack hack hack
git commit -am "Add dark mode toggle to navbar"
```

Frontend is done. On to the backend:

```bash
cd ../backend
# hack hack hack
```

### Handle an interrupt

Then a bug report comes in: logins are crashing! You need to fix it now, but your backend work is mid-flight. No time to commit. No problem, you create a second workspace:

```bash
arb create fix-login-crash frontend
```

```
› Workspace: fix-login-crash
› Branch: fix-login-crash (same as workspace, use --branch to override)
› Base: repo default (use --base to override)
› Repos: frontend
```

Passing repos inline skips the interactive prompt — useful when you know exactly what you need.

Both workspaces now exist side by side. `arb list` shows the full picture:

```
  WORKSPACE         BRANCH            REPOS    LAST COMMIT    STATUS
* fix-login-crash   fix-login-crash   1        1 day          no issues
  add-dark-mode     add-dark-mode     2        2 minutes      dirty, unpushed
```

Fix the bug, push, and clean up:

```bash
# You're in ~/my-project/fix-login-crash
cd frontend
# hack hack hack
git commit -am "Fix null pointer in login flow"
arb push
arb delete fix-login-crash
```

### Back to the feature

The hotfix is shipped. Pick up where you left off:

```bash
arb cd add-dark-mode/backend # arb cd works from anywhere inside the project
# finish backend work
git commit -am "Add dark mode API endpoint"
```

Let's run `arb status` to get an overview. The hotfix landed on `main` while you were away, so `frontend` is now one commit behind:

```
add-dark-mode (base origin/main, share origin/add-dark-mode)

  REPO        LAST COMMIT    BASE                 SHARE        LOCAL
* backend     just now       1 ahead              1 to push    clean
  frontend    5 minutes      1 ahead, 1 behind    1 to push    clean
```

Rebase to integrate the upstream changes (the **integration** axis from the mental model):

```bash
arb rebase
```

Arborist shows a plan, including a conflict prediction for each repo, and asks for confirmation before proceeding:

```
  backend    up to date
  frontend   rebase add-dark-mode onto origin/main — 1 behind, 1 ahead (conflict unlikely)  (HEAD a1b2c3d)

? Rebase 1 repo? (y/N)
```

Synchronization commands automatically fetch all repos in parallel before operating, so you can be sure that the plan is up to date.

### Wrap up

Before pushing, review what you've done across both repos:

```bash
arb log
```

```
==> backend <==
a1b2c3d Add dark mode API endpoint

==> frontend <==
e4f5g6h Add dark mode toggle to navbar

Logged 2 repos (2 commits)
```

Then push both repos (the **sharing** axis) and clean up:

```bash
arb push
arb delete add-dark-mode
```

Now you're ready to create new workspaces to tackle new tasks!

## What else can Arborist do?

The tour covered the essentials. Here are more capabilities worth knowing about.

### Conflict prediction

Before a rebase, merge, or pull runs, Arborist performs a trial three-way merge in memory (using the same algorithm Git uses) to predict file-level conflicts per repo. The plan shows "conflict unlikely" or "conflict likely" so you can decide before anything runs. For repos with uncommitted changes, Arborist suggests `--autostash` and predicts whether re-applying the stash will also conflict.

```
  api        rebase add-auth onto origin/main — 4 behind, 3 ahead (conflict unlikely) (autostash)
  payments   rebase fix-checkout onto origin/main — 6 behind, 2 ahead (conflict likely)
  shared     up to date
```

If a rebase or merge does hit a conflict, Arborist continues with the remaining repos and reports per-repo conflict details and resolution instructions in a single pass. One conflicting repo never blocks the others.

For `arb pull --merge`, if the remote was rewritten and you have no unique commits, Arborist resets to the rewritten tip instead of attempting a three-way merge.

### Undo

`arb undo` reverses the last operation across all repos — whether it's still in progress or already completed. Say a rebase lands in a messy conflict and you'd rather start fresh than untangle it:

```
  1 repo has conflicts:

      payments
          CONFLICT (content): src/checkout.ts
          CONFLICT (modify/delete): src/legacy-api.ts
          cd payments
          # fix conflicts, then: arb rebase --continue
          # or to undo: arb rebase --abort
          # or from workspace root: arb rebase --continue  /  arb rebase --abort
```

```bash
arb undo    # rolls back all repos — including those that completed — ready to try again
```

This works for any tracked operation: rebase, merge, retarget, pull, reset, rename. Undo aborts in-progress git operations, resets HEADs, restores uncommitted changes, and rolls back config. It detects if you have done other changes, so it never silently discards work. It is as close to a magic wand as you can get!

### Commit matching

When you rebase, squash-merge, or force-push, Git creates new commits that replace old ones. The old and new commits look different (different hashes), but represent the same work. Arborist matches them automatically — using patch identity and reflog history — so status and plans always show what's *genuinely new* versus what you've already seen.

`arb status` breaks push and pull counts down by identity — "outdated" for remote commits already reflected in your local history, "new" for genuinely new remote work:

```
my-feature (base origin/main, share origin/my-feature)

  REPO     LAST COMMIT    BASE                 SHARE                                    LOCAL
  api      1 hour         2 ahead              1 from main + 2 rebased → 2 outdated     clean
  shared   2 hours        2 ahead, 3 behind    2 new → 1 new                            1 change
```

When the "new" count is zero, every remote-only commit is already reflected in yours — a force push won't overwrite any collaborator work. `arb push` uses this to allow pushing after rebase, amend, or squash without requiring `--force`, and to block pushes of already-merged branches. `arb rebase` replays only the genuinely new work.

### Know when you're done

After your PR is merged, Arborist detects it — even for squash merges — and shows it clearly in `arb list`. PR numbers are detected automatically from merge and squash commit messages — no configuration needed:

```
  WORKSPACE         BRANCH            REPOS    LAST COMMIT    STATUS
  proj-208-login    proj-208-login    3        3 hours        merged (#42), gone
  proj-215-dark     proj-215-dark     2        1 day          merged, gone
  new-feature       new-feature       3        5 minutes      unpushed
```

No guessing which branches have landed. You see "merged" with the detected PR number from the merge/squash commit, and "gone" when the remote branch was deleted. Ready to `arb delete`.

### Live dashboard

```bash
arb watch
```

A live status dashboard that auto-refreshes on filesystem changes. Press `r` to rebase, `m` to merge, `l` to pull, `p` to push — each runs the full interactive flow (plan, confirm, execute) without leaving the dashboard. Press `f` to fetch, `v` to toggle verbose mode. Ideal for a split terminal while AI agents or tests work in the background.

```
  my-project • feature-branch • status

  REPO     LAST COMMIT    BASE                 SHARE        LOCAL
  api      1 minute       2 ahead              1 to push    clean
  shared   3 minutes      2 ahead, 3 behind    up to date   1 change

  f fetch • v verbose • r rebase • m merge • l pull • p push • q quit
```

### Seed files into new workspaces

```bash
cd my-feature/api
arb template add .env
# from now on, every new workspace gets api/.env automatically
```

Templates let you capture files and have them seeded into every new workspace. Common uses include `.env` files, IDE settings, and AI agent config. Templates live in `.arb/templates/` and are version-controllable. See [Template examples](docs/templates.md#examples) for ready-to-use starting points.

## Advanced use cases

### Branch from a feature branch

```bash
arb create auth-ui --base feat/auth --all-repos
```

The `--base` flag creates a workspace that branches from a specific base instead of the default, letting you stack feature branches. When the base branch is later merged into the default branch (e.g. via a PR), `arb status` detects this and shows "base merged" — preventing the common and painful mistake of rebasing onto a branch that's already been merged. Run `arb retarget` to cleanly rebase onto the default branch and update the workspace config. For deeper stacks (e.g. A → B → C), use `arb retarget feat/A` to retarget to a specific branch.

### Fork-based development

```bash
arb repo clone https://github.com/you/api.git --upstream https://github.com/org/api.git
```

One command clones your fork and registers the canonical repository. Arborist auto-detects remote roles from git config, so `rebase` targets the base while `push` goes to your fork — no additional configuration needed. Different repos in the same workspace can use different remote layouts — some forked, some single-origin — and Arborist resolves remote roles independently for each, so `rebase` targets the right base and `push` goes to the right fork without per-repo configuration.

### Script-friendly by design

```bash
arb push --dry-run            # preview without executing
arb rebase --yes              # skip confirmation
arb branch --quiet            # just the branch name
arb status --json | jq ...    # machine-readable output
arb list --quiet | xargs ...  # one workspace name per line
arb exec npm install          # run a command in every repo
arb status -w dirty,unpushed  # filter repos by status flags
```

All state-changing commands support `--dry-run` to preview the plan and `--yes` to skip confirmation prompts. `status`, `branch`, `list`, `log`, `diff`, and `repo list` support `--json` for structured output and `--quiet` for one name per line — useful for feeding into other commands. `arb exec` runs any command in each repo; `--where` (`-w`) filters repos by status flags like `dirty`, `behind-base`, or `ahead-share` and works across most commands. Exit codes are meaningful: 0 for success, 1 for issues, 130 for user abort. Human-facing output goes to stderr, machine-parsable data to stdout — so piping works naturally.

## Alternatives

There are several ways to approach multi-repo development:

- **Raw `git worktree` + scripts** — Flexible and lightweight, but you must build your own cross-repo status, safety checks, and coordination.
- **Multiple clones per feature** — Simple, but duplicates repos and makes it harder to see overall state.
- **Submodules / meta-repos** — Centralize checkouts, but add Git complexity and don’t inherently solve parallel feature isolation.
- **Repo orchestration tools (`repo`, `west`, etc.)** — Good for syncing large trees, less focused on feature-branch workflows.
- **Monorepo** — Removes the coordination problem entirely, but may mix projects with different lifecycles, and restructuring is not always an option.

Arborist is for teams that want to keep repositories independent while adding a thin, Git-native coordination layer for safe, parallel, multi-repo feature work.

## Further reading

To learn more about Arborist, check out the following resources:

- [Day-to-day usage](docs/daily-use.md), a deeper dive into creating workspaces, checking status, and running commands.
- [Staying in sync](docs/sync.md), how rebase, merge, push, pull, and reset work across repos.
- [Managing workspaces](docs/workspaces.md), how to list, navigate, rename, and remove workspaces.
- [Workspace templates](docs/templates.md), a way to seed files into new workspaces.
- [Fork workflows](docs/fork-workflows.md), how to use Arborist with fork-based development.
- [Stacked branches](docs/stacked-branches.md), branching from feature branches and retargeting when they merge.
- [Scripting and automation](docs/scripting-automation.md), using Arborist from scripts and pipelines.
- [Tips and tricks](docs/tips.md), small conveniences for day-to-day usage.
- [Under the hood](docs/under-the-hood.md), how commit matching, conflict prediction, and phased rendering work.

## License

[MIT](LICENSE.md)
