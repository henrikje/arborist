# Staying in sync

Arborist's synchronization commands keep your workspace current across all repos at once. They handle the two axes from the [mental model](../README.md#mental-model): integration (keeping up with the base branch) and sharing (collaborating on the feature branch).

All sync commands automatically fetch remotes before operating, so plans always reflect the latest remote state. Use `--no-fetch` (`-N`) to skip when refs are known to be fresh. `pull` always fetches.

## Integration: rebase and merge

When the base branch has moved forward — teammates merged PRs to `main` — rebase your feature branches onto it:

```bash
arb rebase
```

Arborist shows a plan with a conflict prediction for each repo and asks for confirmation before proceeding. If a rebase hits conflicts, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. You see the complete state in one pass instead of re-running for each conflict. If you re-run while a repo is still mid-rebase, it is automatically skipped.

Arb auto-detects each repo's default branch, so repos using `main`, `master`, or `develop` coexist without extra configuration.

Prefer merge commits? Use `arb merge` instead — same workflow, uses `git merge`.

## Sharing: push and pull

Pull teammate changes to your feature branch, or push your local commits:

```bash
arb pull
arb pull --rebase     # pull with rebase instead of the default merge
arb pull --merge      # pull with merge commit
arb push
```

After a rebase, amend, or squash, `arb push` detects that all remote commits are outdated (already reflected in your local history) and pushes automatically with `--force-with-lease` — no `--force` flag needed. Use `--force` only when the remote has genuinely new commits from someone else.

When a collaborator force-pushes a rebased branch and you have no unique local commits to preserve, `arb pull --merge` shows a **safe reset** action in the plan and resets to the rewritten remote tip instead of attempting a three-way merge.

### Pushing already-merged branches

If you add commits to a branch that was already merged (squash or regular), Arborist detects it and blocks `arb push` with a warning. Run `arb rebase` to replay only the new commits onto the updated base, then `arb push` and create a new PR.

To intentionally push an already-merged branch (for example to restore a deleted remote branch), use `arb push --include-merged`.

### Wrong-branch repos

If a repo is on a different branch than the workspace expects (shown as "wrong branch" in status), sync commands skip it by default. Use `--include-wrong-branch` on `arb push`, `arb pull`, `arb rebase`, or `arb merge` to include it. The repo is pushed to / pulled from its actual branch, and the plan output annotates it for visibility.

Arb relies on tracking config to detect merged branches, so prefer `arb push` over `git push -u` unless you know what you're doing.

## Starting fresh: reset

Discard all local changes and reset every repo to the remote share branch (or the base branch if never pushed):

```bash
arb reset
```

This resolves the correct remote and branch per repo automatically. When a remote share branch exists (the feature branch has been pushed), it resets to that. When no remote branch exists, it falls back to the base branch. Untracked files are preserved. The plan shows what will be lost (dirty files, unpushed commits) and warns prominently when unpushed commits are at risk.

To always reset to the base branch (e.g. `origin/main`), even when a remote share branch exists:

```bash
arb reset --base
```

## Changing the base branch

Switch the workspace to track a different base branch:

```bash
arb branch base develop        # set base to develop
arb branch base --unset        # remove base (track repo default)
arb branch base                # show current base
```

This only changes the config — it does not rebase or reset. To start fresh from the new base, follow up with `arb reset`. To replay your commits onto the new base, use `arb retarget` instead.

## Filtering sync commands

All sync commands support `--where` (`-w`) to filter which repos are included in the plan:

```bash
arb push --where ^behind-base         # only push repos that are already rebased
arb push --where ^behind-base+^diverged  # only push repos that are fully ready
arb rebase --where ^diverged          # skip diverged repos, rebase the easy ones
arb merge --where ^diverged           # same for merge — avoid likely conflicts
```

Positional repo names and `--where` compose with AND logic — `arb push repo-a --where ^behind-base` only pushes repo-a if it is also up to date with the base branch.

All commands show a plan before proceeding. Add `--verbose` (`-v`) to see the actual commits involved — useful when you want to know *what* you're rebasing onto, not just how many commits.

## Fetch behavior summary

| Command category | Fetches by default? | Override |
|---|---|---|
| Sync commands (`push`, `rebase`, `merge`) | Yes | `--no-fetch` (`-N`) |
| `pull` | Always | (no opt-out) |
| Dashboard commands (`status`, `list`) | Yes | `--no-fetch` (`-N`) |
| Content commands (`log`, `diff`) | No | `--fetch` |

Set `ARB_NO_FETCH` to disable automatic fetching globally — equivalent to passing `-N` to every command. Explicit `--fetch` overrides the env var. `pull` always fetches regardless, since it inherently needs fresh remote state.
