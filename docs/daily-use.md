# Day-to-day usage

Once you have a workspace, most of your time is spent creating branches, checking status, running commands, and committing — the same things you do in any Git project, just coordinated across repos. This page covers the commands you'll use most. For synchronization (rebase, push, pull), see [Staying in sync](sync.md).

## Create a workspace

You will create a new workspace for each feature or issue you work on. A workspace ties together one or more repos under a shared feature branch:

```bash
arb create fix-login frontend backend
```

This creates a `fix-login` workspace with only `frontend` and `backend` — not every feature touches every repo, and picking just the ones you need keeps the workspace focused and makes status, push, and rebase faster to scan. The branches are created if they do not exist. With the shell integration installed, your shell automatically `cd`s into the new workspace.

Use `--branch` (`-b`) when the branch name differs from the workspace name, `--base` when you want to target a specific base branch (instead of each repo's default), `--all-repos` (`-a`) to include every cloned repo, and `--yes` (`-y`) to skip the interactive repo picker and use your configured defaults (see `arb repo default`):

```bash
arb create dark-mode --branch "feat/dark-mode" --base develop --all-repos
```

`arb create` adapts to how much you already specified:

- `arb create` (no args) runs a guided flow (name, repos, branch).
- `arb create <name>` prompts for repos only and uses `<name>` as the branch by default.
- `arb create --branch <branch>` derives the workspace name from the branch tail (text after the last `/`).

If you've configured default repos with `arb repo default`, they are pre-selected in the interactive picker and used as the fallback when no repos are specified in non-interactive mode. See [Managing workspaces - Default repos](workspaces.md#default-repos) for details.

See `arb create --help` for all options.

## Work in your repos

Each directory in a workspace is a standard Git working copy. You edit files, run builds, and use Git exactly as you normally would — there is no `arb commit`. Use `-C` to target a workspace from anywhere, just like `git -C`:

```bash
arb -C ~/my-project/fix-login status
```

## Check status

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

When a branch has been merged, the detected PR number from the merge commit, squash commit, or branch tip commit subject appears in `arb status` (e.g. `merged (#123), gone`). Detected values are heuristic — they come from local git data, not API calls.

## Run commands across repos

```bash
arb exec git log --oneline -5
arb exec npm install
arb exec --repo api --repo web -- npm test   # only in specific repos
arb exec --dirty git diff -d                 # --dirty is arb's, -d goes to git diff
arb exec --where behind-base git status      # check working trees before rebase
```

Runs the given command in each repo sequentially. It supports running interactive commands. Each execution of the command uses the corresponding repo directory as working directory. Use `--dirty` (`-d`) to limit to repos with uncommitted changes, or `--where` (`-w`) for any status filter. Arb flags come before the command — everything after the command name passes through verbatim.

Use `--parallel` (`-p`) to run concurrently across all repos — useful for non-interactive commands like installs or builds:

```bash
arb exec -p npm install
arb exec -p --dirty npm test
```

Output is buffered per repo and printed in alphabetical order. Stdin is disabled in parallel mode. See `arb exec --help` for all options.

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
