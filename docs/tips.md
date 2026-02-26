# Tips

## Browsing the default branch

To view the latest default-branch code across all repos:

```bash
arb create main --all-repos  # assuming main is the default branch
```

_Note_: Creating a workspace for the default branch works because Arborist keeps the canonical clones in detached HEAD state.

## Multiple arb roots

Each arb root is independent. Commands find the right one by walking up from the current directory looking for the `.arb/` marker. Feel free to create multiple roots for different projects:

```bash
cd ~/project-a && arb init
cd ~/project-b && arb init
```

## Preview before committing

Use `--dry-run` to see what a command would do, then `--yes` to execute without a second confirmation prompt:

```bash
arb push --dry-run        # inspect the plan
arb push --yes            # looks good — go ahead
```

This pattern is especially useful in scripted or AI-driven workflows.

## Target specific repos with `--where`

Most commands accept `--where` to filter by repo status. This is handy for surgical operations across a workspace:

```bash
arb status --where dirty              # which repos have uncommitted changes?
arb exec --where unpushed git stash   # stash only in repos with unpushed work
arb open --where dirty code           # open only dirty repos in your editor
arb exec --where dirty+unpushed git stash  # only repos that are both dirty AND unpushed
```

Use `,` for OR and `+` for AND — `+` binds tighter, so `dirty+unpushed,gone` means (dirty AND unpushed) OR gone. See [Scripting & automation](scripting-automation.md#filtering) for the full term list.

## Batch cleanup of merged workspaces

After PRs are merged, clean up in one pass:

```bash
arb delete --all-safe --where gone    # delete workspaces whose branches are gone from the remote
```

Add `--delete-remote` to also delete the remote branches if they haven't been cleaned up by the merge.

## Run the same command everywhere

`arb exec` runs a command in every repo. Combine with `--dirty` to scope it:

```bash
arb exec npm install                  # install deps in every repo
arb exec --dirty git commit -m "wip"  # quick WIP commit only where you have changes
arb exec git checkout -- .            # discard all unstaged changes across repos
```

## Quick workspace triage

Use `arb list` with `--fetch` and `--where` to triage across all workspaces:

```bash
arb list --fetch --where at-risk      # which workspaces might lose work?
arb list --where stale                # which workspaces haven't been touched lately?
```
