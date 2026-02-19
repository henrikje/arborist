# Managing workspaces

## List workspaces

```bash
arb list
```

Shows all workspaces with their branch, repo count, last commit date, and aggregate status:

```
  WORKSPACE    BRANCH          REPOS    LAST COMMIT    STATUS
* ws-one       my-feature      2         3 days        no issues
  ws-two       feat/payments   1         2 months      dirty, unpushed
```

The active workspace (the one you're currently inside) is marked with `*`. The LAST COMMIT column shows when work last happened (the most recent commit author date across all repos), helping you gauge workspace staleness.

## Navigate

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

## Add and drop repos

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

## Remove workspaces

When a feature is done:

```bash
arb remove fix-login
```

This shows the status of each worktree and walks you through removal. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force`. When workspace templates are in use, arb also lists any template-sourced files that were modified — giving you a chance to update the templates before removing the workspace. Use `--yes` (`-y`) to skip the confirmation prompt, `--delete-remote` to also clean up the remote branches, and `--all-safe` to batch-remove every workspace with safe status. Combine `--all-safe -w gone` to target merged-and-safe workspaces specifically. See `arb remove --help` for all options.
