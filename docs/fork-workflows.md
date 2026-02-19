# Fork workflows

Arborist has built-in support for fork-based development, where you push feature branches to your fork and rebase onto the canonical (upstream) repository.

## Remote roles

Arborist thinks in terms of two remote roles:

- **upstream** — the source of base branches and the target for rebase/merge operations
- **share** — where feature branches are pushed and pulled

For single-remote repos, both roles typically resolve to `origin`. For fork setups, the upstream role maps to the canonical repository (often a remote named `upstream`), and the share role maps to your fork (often `origin`).

## Setting up a fork

Use `arb repo clone` with `--upstream` to clone a fork and register the canonical repo in one step:

```bash
arb repo clone https://github.com/you/api.git --upstream https://github.com/org/api.git
```

This clones your fork as `origin`, adds the canonical repo as `upstream`, sets `remote.pushDefault = origin`, and fetches both remotes.

## Auto-detection

Arborist reads `remote.pushDefault` and remote names from git config to determine roles automatically. No arborist-specific configuration is needed. Detection follows these rules:

1. Single remote — used for both roles
2. `remote.pushDefault` set — that remote is `share`, the other is `upstream`
3. Remotes named `upstream` and `origin` — conventional fork layout
4. Ambiguous — arb reports an error with guidance on how to configure `remote.pushDefault`

## Per-repo flexibility

Different repos in a workspace can have different remote layouts. Some repos might be forked while others use a single origin. Arborist resolves remotes independently per repo.

## Status display

In fork setups, `arb status` shows the upstream remote prefix in the BASE column so you can see where each repo's base branch lives:

```
  REPO      BRANCH        BASE                          SHARE                          LOCAL
  api       my-feature    upstream/main  2 ahead        origin/my-feature  2 to push    clean
  web       my-feature    main           equal          origin/my-feature  up to date   clean
```

Here `api` is a fork (base is `upstream/main`) while `web` uses a single origin (base is just `main`).

## Two axes of synchronization

Arborist tracks two independent relationships per repo, each mapped to a remote role:

| Axis | Remote | Column | Commands | Flag | Auto-fetch |
|------|--------|--------|----------|------|------------|
| Integration | upstream | BASE | rebase, merge | behind base | yes |
| Sharing | share | SHARE | push, pull | behind share | yes |

For single-remote repos both roles point to `origin` and the distinction is invisible — it only matters for fork setups where each role maps to a different remote.

## Stacked workspaces

Arborist supports stacking feature branches using `arb create --base`:

```bash
arb create auth-ui --base feat/auth -b feat/auth-ui -a
```

This creates a workspace where all repos branch from `feat/auth` instead of the default branch. `arb rebase` and `arb merge` target `feat/auth` as the base.

When the base branch is merged into the default branch (e.g. via a PR), `arb status` shows **base merged** and `arb rebase` skips the affected repos with a hint. Use `arb rebase --retarget` to rebase onto the default branch and update the workspace config. For squash merges, `--retarget` uses `git rebase --onto` to avoid replaying the base branch's commits.
