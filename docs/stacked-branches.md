# Stacked branches

Stacked branches let you build on top of a feature branch that hasn't been merged yet — useful when the next piece of work depends on the first but you don't want to wait for the PR to land.

## Creating a stacked workspace

Use `--base` to branch from a feature branch instead of the default:

```bash
arb create auth-ui --base feat/auth -b feat/auth-ui -a
```

This creates a workspace where all repos branch from `feat/auth` instead of the default branch. `arb rebase` and `arb merge` target `feat/auth` as the base, and `arb status` shows divergence relative to `feat/auth`.

## Changing the base after creation

If you created a workspace with the wrong base, or want to convert a non-stacked workspace into a stacked one, use `retarget`:

```bash
arb retarget feat/auth
```

This changes the workspace's configured base to `feat/auth` and rebases all repos onto it. To go back to the default branch:

```bash
arb retarget
```

To change the base config without rebasing, use `arb branch base <branch>` instead.

## When the base branch is merged

When `feat/auth` is merged into the default branch (e.g. via a PR), `arb status` detects this and shows **base merged** on the affected repos. `arb rebase` skips them with a hint to retarget.

Run `arb retarget` to rebase onto the default branch and update the workspace config in one step:

```bash
arb retarget
```

For squash merges, `retarget` uses `git rebase --onto` to graft only your stacked commits onto the default branch, avoiding replaying the base branch's commits. The workspace config is updated to remove the custom base, so future rebase/merge operations target the default branch automatically.

## Deeper stacks

For stacks deeper than two levels (e.g. A -> B -> C), when B is merged into A but A is not yet the default branch, use `retarget` with an explicit target:

```bash
arb retarget feat/A
```

This rebases C from B onto A and updates the workspace config to set `feat/A` as the new base. Retarget is all-or-nothing across stacked repos — if any repo is blocked, the entire operation is refused so the workspace config stays consistent.

## Worked example

```bash
# Start with a feature branch
arb create auth -b feat/auth -a
# ... develop and push feat/auth ...

# Stack UI work on top
arb create auth-ui --base feat/auth -b feat/auth-ui -a
# ... develop feat/auth-ui while feat/auth is in review ...

# feat/auth PR is merged — arb status shows "base merged"
arb retarget                 # rebases feat/auth-ui onto main
arb push                     # push the rebased branch

# Clean up
arb delete auth              # the merged workspace
```

At each step, `arb status` shows where you stand relative to the base, and conflict predictions help you decide when to retarget.
