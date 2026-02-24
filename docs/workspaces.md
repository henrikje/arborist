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

Use `--fetch` (`-F`) to fetch all repos before listing, ensuring the status reflects the latest remote state. Use `--where` (`-w`) to filter workspaces by repo status — only workspaces containing at least one repo matching the filter are shown:

```bash
arb list --fetch                   # fetch first, then list
arb list --where at-risk           # workspaces with at-risk repos
arb list --where dirty+unpushed    # workspaces where a repo is both dirty AND unpushed
arb list --where stale             # workspaces that may need attention
```

Use `,` for OR and `+` for AND. See [Scripting & automation](scripting-automation.md#filtering) for the full list of filter terms and syntax details.

## Navigate

`arb cd` changes into a workspace or repo directory. It requires the shell integration installed by `install.sh`:

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

`arb path` prints the absolute path to the arb root, a workspace, or a repo — useful in scripts and shell pipelines. It follows the same scope-aware resolution as `arb cd`:

```bash
arb path                       # /home/you/my-project (the arb root)
arb path fix-login             # /home/you/my-project/fix-login
arb path fix-login/frontend    # /home/you/my-project/fix-login/frontend
arb path frontend              # /home/you/my-project/fix-login/frontend (when inside fix-login)
```

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

Arb refuses to detach repos with uncommitted changes unless you pass `--force`. Use `--delete-branch` when you want a clean teardown — without it, the branch lingers in the canonical repo's ref list. See `arb detach --help` for all options.

## Delete workspaces

When a feature is done:

```bash
arb delete fix-login
```

This shows the status of each repo and walks you through deletion. If there are uncommitted changes or unpushed commits, arb refuses to proceed unless you pass `--force`. When workspace templates are in use, arb also lists any template-sourced files that were modified — giving you a chance to update the templates before deleting the workspace. Use `--yes` (`-y`) to skip the confirmation prompt, `--delete-remote` to also clean up the remote branches, and `--all-safe` to batch-delete every workspace with safe status. Combine `--all-safe --where gone` to target merged-and-safe workspaces specifically. See `arb delete --help` for all options.

## List repos

To see which repositories have been cloned into the arb root:

```bash
arb repo list
```

This shows a table of repo names and their remote URLs. Useful when you've added repos over time and need a quick inventory of what's available for new workspaces.
