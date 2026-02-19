## Day-to-day usage

The sections below go deeper on the commands you use when working in a workspace. See `arb help <command>` for all options.

## Create a workspace

You will create a new workspace for each feature or issue you work on. A workspace ties together one or more repos under a shared feature branch:

```bash
arb create fix-login frontend backend
```

This creates a `fix-login` workspace with only `frontend` and `backend` — not every feature touches every repo, and picking just the ones you need keeps the workspace focused and makes status, push, and rebase faster to scan. The branches are created if they do not exist. With the shell integration installed, your shell automatically `cd`s into the new workspace.

Use `--branch` (`-b`) when the branch name differs from the workspace name, `--base` when you want to target a specific base branch (instead of each repo's default), and `--all-repos` (`-a`) to include every cloned repo:

```bash
arb create dark-mode --branch "feat/dark-mode" --base develop --all-repos
```

Running `arb create` without arguments walks you through it interactively. See `arb create --help` for all options.

## Work in your repos as usual

Each directory in a workspace is a regular Git worktree. You edit files, run builds, and use Git exactly as you normally would:

```bash
cd ~/my-project/fix-login/frontend
# hack hack hack
git add -p
git commit -m "Fix the bug on the login page"
```

There is no `arb commit` — you commit in each repo individually.

The commands below run from inside a workspace or worktree. You can also target a workspace from anywhere using `-C`:

```bash
arb -C ~/my-project status                    # run from the arb root
arb -C ~/my-project/fix-login status          # target a specific workspace
```

`-C` works like `git -C` — it changes the working directory before any command runs.

## Check status

Once you've made some changes, you can check the status of your workspace:

```bash
arb status
```

This shows the state of each worktree in a compact table with labeled columns:

```
  REPO         BRANCH        BASE                     SHARE                          LOCAL
  repo-a       my-feature    main  equal              origin/my-feature  up to date   clean
  repo-b       my-feature    main  2 ahead            origin/my-feature  2 to push    1 staged, 1 modified
  repo-c       experiment    main  2 ahead, 1 behind  origin/experiment  1 to pull    clean
  local-lib    my-feature    main  equal              local                           clean
```

This view is designed to give you the full picture in one glance — repo name, current branch, how far you've drifted from the base branch, whether the share remote is ahead or behind, and what's uncommitted locally. Yellow highlights things that need attention: unpushed commits, local changes, repos on an unexpected branch (like `repo-c` above).

See `arb status --help` for all options.

## Stay in sync

Arborist's synchronization commands — `push`, `pull`, `rebase`, and `merge` — keep your workspace current. They automatically fetch all repos before operating, so you always work against the latest remote state. Use `--no-fetch` to skip when refs are known to be fresh. To fetch manually without making changes, use `arb fetch`.

**Integration axis** — when the base branch has moved forward (e.g. teammates merged PRs to `main`), rebase your feature branches onto it:

```bash
arb rebase
```

If a rebase hits conflicts, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. This way you see the complete state of all repos in one pass instead of re-running for each conflict. If you re-run while a repo is still mid-rebase, it is automatically skipped. Prefer merge commits? Use `arb merge` instead — same workflow, uses `git merge`.

Arb auto-detects each repo's default branch, so repos using `main`, `master`, or `develop` coexist without extra configuration.

**Sharing axis** — pull teammate changes to your feature branch, or push your local commits:

```bash
arb pull
arb push
arb push --force    # after rebasing
```

Arb relies on tracking config to detect merged branches, so prefer `arb push` over `git push -u` unless you know what you're doing.

All state-changing commands (`rebase`, `merge`, `push`, `pull`) automatically fetch before operating, ensuring they work with the latest remote state. Use `--no-fetch` to skip when refs are known to be fresh. Read-only commands (`status`, `list`) do not fetch by default — use `--fetch` to opt in. If fetching fails (e.g. offline), the command warns and continues with stale data.

All commands show a plan before proceeding. See `arb help <command>` for options.

## Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
arb exec --repo api --repo web -- npm test   # only in specific repos
arb exec --dirty git diff -d   # --dirty is arb's, -d goes to git diff
```

Runs the given command in each worktree sequentially. It supports running interactive commands. Each execution of the command uses the corresponding worktree as working directory. Arb flags (like `--dirty`) come before the command — everything after the command name passes through verbatim. See `arb exec --help` for all options.

## Open in your editor

```bash
arb open code
# expands to:
# code /home/you/my-project/fix-login/frontend /home/you/my-project/fix-login/backend
arb open --repo frontend code   # only open specific repos
arb open code -n --add    # -n and --add are passed to code
```

Runs the given command with all worktree directories as arguments — useful for opening them in an editor like VS Code. All directories are specified as absolute paths. Arb flags come before the command — everything after the command name passes through verbatim. See `arb open --help` for all options.
