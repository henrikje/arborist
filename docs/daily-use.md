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

Each directory in a workspace is a working copy of a repository. You edit files, run builds, and use Git exactly as you normally would:

```bash
cd ~/my-project/fix-login/frontend
# hack hack hack
git add -p
git commit -m "Fix the bug on the login page"
```

There is no `arb commit` — you commit in each repo individually.

The commands below run from inside a workspace or repo. You can also target a workspace from anywhere using `-C`:

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

This shows the state of each repo in a compact table with labeled columns:

```
  REPO         BRANCH        LAST COMMIT    BASE                            SHARE                          LOCAL
  repo-a       my-feature     3 days        origin/main  equal              origin/my-feature  up to date   clean
  repo-b       my-feature     2 hours       origin/main  2 ahead            origin/my-feature  2 to push    1 staged, 1 modified
  repo-c       experiment     5 days        origin/main  2 ahead, 1 behind  origin/experiment  1 to pull    clean
  local-lib    my-feature     1 day         origin/main  equal              local                           clean
```

This view is designed to give you the full picture in one glance — repo name, current branch, when work last happened, how far you've drifted from the base branch, whether the share remote is ahead or behind, and what's uncommitted locally. Yellow highlights things that need attention: unpushed commits, local changes, repos on an unexpected branch (like `repo-c` above).

Use `--verbose` (`-v`) to see file-level detail — staged files, modified files, untracked files, and the actual commits that are ahead or behind:

```bash
arb status --verbose
```

Use `--where` (`-w`) to filter the table to repos matching a condition:

```bash
arb status --where dirty              # only repos with uncommitted changes
arb status --where unpushed           # only repos with commits to push
arb status --where behind-base        # only repos that need rebasing
arb status --where dirty+unpushed     # only repos that are both dirty AND unpushed
arb status --where dirty,gone         # dirty OR gone (comma = OR)
```

Use `,` for OR (match any term) and `+` for AND (match all terms). `+` binds tighter than `,`: `dirty+unpushed,gone` means (dirty AND unpushed) OR gone. See [Scripting & automation](scripting-automation.md#filtering) for the full list of filter terms and more examples.

See `arb status --help` for all options.

Arborist also detects ticket keys (like `PROJ-208` or `ACME-42`) from branch names and commit messages, showing them in `arb list` as a TICKET column. When a branch has been merged, the detected PR number from the merge commit, squash commit, or branch tip commit subject appears in `arb status` (e.g. `merged (#123), gone`). All detected values are heuristic — they come from local git data, not API calls.

## Stay in sync

Arborist's synchronization commands — `push`, `rebase`, and `merge` — keep your workspace current. They automatically fetch all repos before operating, so you always work against the latest remote state. Use `--no-fetch` to skip when refs are known to be fresh. `pull` always fetches (no `--no-fetch`). Overview commands (`status`, `log`, `diff`, `list`) accept `--fetch` to opt in to a pre-fetch.

**Integration axis** — when the base branch has moved forward (e.g. teammates merged PRs to `main`), rebase your feature branches onto it:

```bash
arb rebase
```

If a rebase hits conflicts, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. This way you see the complete state of all repos in one pass instead of re-running for each conflict. If you re-run while a repo is still mid-rebase, it is automatically skipped. Prefer merge commits? Use `arb merge` instead — same workflow, uses `git merge`.

Arb auto-detects each repo's default branch, so repos using `main`, `master`, or `develop` coexist without extra configuration.

**Sharing axis** — pull teammate changes to your feature branch, or push your local commits:

```bash
arb pull
arb pull --rebase     # pull with rebase instead of the default merge
arb pull --merge      # pull with merge commit
arb push
arb push --force      # after rebasing (prompts for confirmation)
```

If you add commits to a branch that was already merged (squash or regular), Arborist detects it and blocks `arb push` with a warning. Run `arb rebase` to replay only the new commits onto the updated base, then `arb push --force` and create a new PR.

Arb relies on tracking config to detect merged branches, so prefer `arb push` over `git push -u` unless you know what you're doing.

All sync commands support `--where` (`-w`) to filter which repos are included in the plan:

```bash
arb push --where ^behind-base         # only push repos that are already rebased
arb push --where ^behind-base+^diverged  # only push repos that are fully ready
arb rebase --where ^diverged          # skip diverged repos, rebase the easy ones
arb merge --where ^diverged           # same for merge — avoid likely conflicts
```

Positional repo names and `--where` compose with AND logic — `arb push repo-a --where ^behind-base` only pushes repo-a if it is also up to date with the base branch.

All commands show a plan before proceeding. Add `--verbose` (`-v`) to see the actual commits involved — useful when you want to know *what* you're rebasing onto, not just how many commits.

## Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
arb exec --repo api --repo web -- npm test   # only in specific repos
arb exec --dirty git diff -d                 # --dirty is arb's, -d goes to git diff
arb exec --where behind-base git status      # check working trees before rebase
```

Runs the given command in each repo sequentially. It supports running interactive commands. Each execution of the command uses the corresponding repo directory as working directory. Use `--dirty` (`-d`) to limit to repos with uncommitted changes, or `--where` (`-w`) for any status filter. Arb flags come before the command — everything after the command name passes through verbatim. See `arb exec --help` for all options.

## Open in your editor

```bash
arb open code
# expands to:
# code /home/you/my-project/fix-login/frontend /home/you/my-project/fix-login/backend
arb open --repo frontend code     # only open specific repos
arb open --dirty code             # only open repos with uncommitted changes
arb open --where unpushed code    # only open repos matching a status filter
arb open code -n --add            # -n and --add are passed to code
```

Runs the given command with all repo directories as arguments — useful for opening them in an editor like VS Code. All directories are specified as absolute paths. Use `--dirty` (`-d`) or `--where` (`-w`) to limit which repos are opened. Arb flags come before the command — everything after the command name passes through verbatim. See `arb open --help` for all options.
