# Fork workflows

Arborist has built-in support for fork-based development, where you push feature branches to your fork and rebase onto the canonical (upstream) repository.

## Remote roles

Arborist thinks in terms of two remote roles:

- **base** — the source of base branches and the target for rebase/merge operations
- **share** — where feature branches are pushed and pulled

For single-remote repos, both roles typically resolve to `origin`. For fork setups, the base role maps to the canonical repository (often a remote named `upstream`), and the share role maps to your fork (often `origin`).

## Setting up a fork

Use `arb repo clone` with `--upstream` to clone a fork and register the canonical repo in one step:

```bash
arb repo clone https://github.com/you/api.git --upstream https://github.com/org/api.git
```

This clones your fork as `origin`, adds the canonical repo as `upstream`, sets `remote.pushDefault = origin`, and fetches both remotes.

## Auto-detection

Arborist reads `remote.pushDefault` and remote names from git config to determine roles automatically. No arborist-specific configuration is needed. Detection follows these rules:

1. Single remote — used for both roles
2. `remote.pushDefault` set — that remote is `share`, the other is `base`
3. Remotes named `upstream` and `origin` — conventional fork layout
4. Ambiguous — arb reports an error with guidance on how to configure `remote.pushDefault`

## Per-repo flexibility

Different repos in a workspace can have different remote layouts. Some repos might be forked while others use a single origin. Arborist resolves remotes independently per repo.

## Status display

In fork setups, `arb status` shows the upstream remote prefix in the BASE column so you can see where each repo's base branch lives:

```
  REPO    LAST COMMIT    BASE                          SHARE                          LOCAL
  api      2 hours       upstream/main  2 ahead        origin/my-feature  2 to push    clean
  web      1 day         origin/main    equal          origin/my-feature  up to date   clean
```

Here `api` is a fork (base is `upstream/main`) while `web` uses a single origin (base is `origin/main`).

## Daily workflow with forks

A typical session with a forked repo looks the same as any other — Arborist routes commands to the right remote automatically:

```bash
arb rebase          # rebases onto upstream/main (the base remote)
arb push            # pushes to origin (your fork, the share remote)
```

No extra flags needed. The remote role resolution handles the routing, so `arb rebase` always targets the canonical repo and `arb push` always goes to your fork.
