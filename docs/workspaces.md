# Managing workspaces

Workspaces are the main unit of work in Arborist — each one represents a feature or task across one or more repos. This page covers how to list, navigate, modify, and clean up workspaces. For creating workspaces, see [Day-to-day usage](daily-use.md#create-a-workspace).

## List workspaces

```bash
arb list
```

Shows all workspaces with their branch, repo count, last commit date, and aggregate status:

```
  WORKSPACE    BRANCH          REPOS    LAST COMMIT    STATUS
* ws-one       my-feature      2         3 days        no issues
  ws-two       feat/payments   1         2 months      dirty, ahead share
```

The active workspace (the one you're currently inside) is marked with `*`. The LAST COMMIT column shows when work last happened (the most recent commit author date across all repos), helping you gauge workspace staleness.

Fetches all repos by default for fresh remote data (skip with `-N`/`--no-fetch`, or set `ARB_NO_FETCH` globally). Use `--where` (`-w`) to filter workspaces by repo status — only workspaces containing at least one repo matching the filter are shown:

```bash
arb list --where at-risk           # workspaces with at-risk repos
arb list --where dirty+ahead-share    # workspaces where a repo is both dirty AND ahead-share
arb list --where stale             # workspaces that may need attention
```

Use `,` for OR and `+` for AND. See [Scripting & automation](scripting-automation.md#filtering) for the full list of filter terms and syntax details.

Use `--older-than` and `--newer-than` to filter by workspace age — how recently files were touched (commits, uncommitted edits, and workspace-level items like `.claude/` are all considered):

```bash
arb list --older-than 30d    # workspaces with no activity in the last 30 days
arb list --newer-than 7d     # workspaces active in the last week
arb list --older-than 2w --where ahead-share   # old workspaces that still have unpushed commits
```

Durations use `d` (days), `w` (weeks), `m` (months), or `y` (years). `--older-than` and `--newer-than` compose with `--where` as AND.

## Navigate

`arb cd` changes into a workspace or repo directory. It requires the shell integration — a small shell function that wraps `arb` so it can change your working directory.

`install.sh` sets this up automatically. If you installed via Homebrew, add the appropriate line to your shell profile:

```bash
# zsh (~/.zshrc)
source "$(brew --prefix)/share/arb/arb.zsh"

# bash (~/.bashrc)
source "$(brew --prefix)/share/arb/arb.bash"
```

With the shell integration in place:

```bash
arb cd fix-login              # cd into workspace
arb cd fix-login/frontend     # cd into a specific repo
arb cd                        # interactive workspace picker
```

When run from inside a workspace, names are resolved as repos first — so you can switch between repos without typing the workspace name:

```bash
arb cd frontend               # cd into the frontend repo (when inside a workspace)
arb cd                        # interactive repo picker (when inside a workspace)
```

If the name doesn't match a repo, it falls back to workspace resolution. You can always use the explicit `workspace/repo` syntax to be unambiguous.

`arb path` prints the absolute path to the project root, a workspace, or a repo — useful in scripts and shell pipelines. It follows the same scope-aware resolution as `arb cd`:

```bash
arb path                       # /home/you/my-project (the project root)
arb path fix-login             # /home/you/my-project/fix-login
arb path fix-login/frontend    # /home/you/my-project/fix-login/frontend
arb path frontend              # /home/you/my-project/fix-login/frontend (when inside fix-login)
```

## Check out an existing branch

`arb create` works with both new and existing branches. If the branch already exists locally or on the share remote, arb checks it out instead of creating a new one:

```bash
arb create collab-work -b feat/payments repo-a repo-b
```

```
Creating worktrees...
  [repo-a] branch feat/payments checked out from origin/feat/payments
  [repo-b] branch feat/payments created from origin/main
Created workspace collab-work (2 repos) on branch feat/payments
```

When run as bare `arb create` (no args or flags), arb fetches the selected repos and presents a branch selector that lists all remote branches across the selected repos. This makes it easy to discover and check out existing branches without having to remember exact names. The selector labels the default suggestion as "(new branch)" or "(existing branch)" and offers an "Enter a different name..." option for custom input.

This is useful when you want to resume work on an existing feature, collaborate on a branch someone else started, or set up a local workspace after switching machines. The per-repo output tells you exactly what happened — whether each branch was created fresh, checked out from a remote, or attached from a local copy.

## Attach and detach repos

You can attach more repos to an existing workspace at any time:

```bash
arb attach shared
arb attach --all-repos
```

If the workspace has a configured base branch, new branches are created from it. Running without arguments opens an interactive repo picker.

To detach a repo from a workspace without deleting the workspace itself:

```bash
arb detach shared
arb detach shared --delete-branch    # also delete the local branch from the canonical repo
```

Arb refuses to detach repos with at-risk state (uncommitted changes, unpushed commits, operation in progress, detached HEAD, wrong branch) unless you pass `--force`. Use `--delete-branch` when you want a clean teardown — without it, the branch lingers in the canonical repo's ref list. See `arb detach --help` for all options.

## Rename workspaces

When a temporary workspace proves viable and you want to repurpose it:

```bash
arb rename PROJ-208
```

This renames the workspace directory and branch across all repos in a single operation. Use `--branch` to set the branch name independently from the workspace name, and `--base` to change the base branch:

```bash
arb rename PROJ-208 --branch feat/PROJ-208                 # different branch name
arb rename --branch feat/PROJ-208                           # workspace name derived from branch
arb rename PROJ-208 --branch feat/PROJ-208 --base develop   # full repurpose
```

Repos with an in-progress git operation (rebase, merge, cherry-pick) are skipped by default — use `--include-in-progress` to override. If the rename fails partway through (non-atomic across repos), use `--continue` to resume or `--abort` to roll back. Migration state is shared with `arb branch rename` — either command can recover from the other's partial rename.

To rename just the branch without renaming the workspace directory, use `arb branch rename`:

```bash
arb branch rename feat/new-name
```

## Delete workspaces

When a feature is done:

```bash
arb delete fix-login
```

This shows the status of each repo and walks you through deletion. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force`. When workspace templates are in use, arb also lists any template-sourced files that were modified — giving you a chance to update the templates before deleting the workspace. Use `--yes` (`-y`) to skip the confirmation prompt, `--delete-remote` to also clean up the remote branches, and `--all-safe` to batch-delete every workspace with safe status. Combine `--all-safe --where gone` to target merged-and-safe workspaces specifically.

To clean up workspaces by age regardless of status, use `--older-than` or `--newer-than`:

```bash
arb delete --older-than 90d --dry-run    # preview workspaces with no activity for 90+ days
arb delete --older-than 90d --yes        # delete them
arb delete --older-than 30d --where gone --yes   # only if also merged/gone
arb delete --newer-than 7d --dry-run     # preview recently active workspaces
```

Activity is measured the same way as `arb list --older-than` / `--newer-than`: most recent file mtime across commits, uncommitted edits, and workspace-level items. See `arb delete --help` for all options.

## Default repos

If you always include the same repos when creating workspaces, mark them as defaults:

```bash
arb repo default frontend backend shared
```

Default repos are pre-selected in the interactive repo picker when running `arb create` or `arb attach`. You can still uncheck them — defaults are suggestions, not mandates.

Use `--yes` (`-y`) to skip the interactive repo picker and use defaults directly. In non-interactive mode (CI, scripts), defaults are used automatically as the fallback repo set when no repos are specified via arguments, stdin, or `--all-repos`:

```bash
arb create my-feature --yes              # skip prompt, use default repos
arb create my-feature                    # uses default repos (non-interactive)
arb create my-feature api shared         # explicit repos override defaults
arb create my-feature --all-repos        # --all-repos overrides defaults
```

Manage defaults with `arb repo default`:

```bash
arb repo default                         # list current defaults
arb repo default api                     # add api to defaults
arb repo default --remove api            # remove api from defaults
```

Defaults are stored in `.arb/config.json` and can be committed to version control so the team shares the same project-level configuration. Removing a repo with `arb repo remove` automatically cleans up its default entry.

## List repos

To see which repositories have been cloned into the project:

```bash
arb repo list
```

This shows a table of repo names, their remote URLs, and remote roles (base and share). Useful when you've added repos over time and need a quick inventory of what's available for new workspaces. Use `--verbose` (`-v`) to see both base and share remote details, or `--json` for structured output.
