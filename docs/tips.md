# Tips

## Browsing the default branch

To view the latest default-branch code across all repos:

```bash
arb create main --all-repos  # assuming main is the default branch
```

_Note_: Creating a workspace for the default branch works because Arborist keeps the canonical clones in detached HEAD state.

## Multiple projects

Each project is independent. Commands find the right one by walking up from the current directory looking for the `.arb/` marker. Feel free to create multiple projects:

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
arb exec --where unpushed git log --oneline @{u}..HEAD  # review outgoing commits
arb open --where dirty code           # open only dirty repos in your editor
arb push --where ^behind-base         # only push repos that are already rebased
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

Use `arb list` with `--where` to triage across all workspaces:

```bash
arb list --where at-risk              # which workspaces might lose work?
arb list --where stale                # which workspaces haven't been touched lately?
```

## Recovering commits accidentally added to a merged branch

After a PR is merged and the remote branch is deleted, `arb status` marks the workspace as `gone`. If you accidentally commit new work to that merged branch instead of starting fresh, `arb rebase` detects the situation automatically and replays only the new commits onto the base.

Run `arb rebase` — it identifies which commits were part of the merged PR and which are genuinely new, and shows you a plan:

```
  REPO   ACTION
  api    rebase onto origin/main (merged) — rebase 2 new commits
  web    rebase onto origin/main (merged) — rebase 1 new commit
```

The `(merged)` marker means Arborist detected that the branch was already merged and will use `rebase --onto` to graft only the new commits onto `origin/main`, discarding everything that was already merged. Confirm to proceed.

If you have uncommitted changes in any repo, pass `--autostash` to stash them before the rebase and restore them after:

```
  REPO   ACTION
  api    rebase onto origin/main (merged) — rebase 2 new commits (autostash)
  web    rebase onto origin/main (merged) — rebase 1 new commit (autostash)
```

`arb rebase` handles both the committed and uncommitted work in a single step.

Once the commits are in the right place, rename the workspace branch and push:

```bash
arb branch rename feat/PROJ-456      # give the new work its own branch name
arb push                             # push the new branch to the remote
```
