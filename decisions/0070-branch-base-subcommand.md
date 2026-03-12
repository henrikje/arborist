# Move base-branch management from `reset --base` to `arb branch base`

Date: 2026-03-12

## Context

`arb reset --base <branch>` combined two distinct operations: changing the workspace's configured base branch and performing a destructive hard-reset of all repos to that new base. This conflation caused several problems: users could accidentally discard local work when they only wanted to change the config, there was no way to inspect or remove the base without also resetting, and the flag couldn't include a merged-base safety check because `reset` is inherently destructive (you *want* to discard state).

The `branch` command group already manages workspace branch identity (`show`, `rename`). The base branch is part of that identity — it determines what `rebase`, `merge`, `reset`, and `status` operate against.

## Options

### Keep `reset --base`
Leave retargeting as a side effect of `reset`.
- **Pros:** No migration, fewer commands.
- **Cons:** Conflates config change with destructive reset. No show/unset mode. Can't add merged-base detection without blocking normal resets. Violates "do one thing well."

### Add `arb branch base` as a dedicated subcommand
Tri-modal (show/set/unset) config-only command under the `branch` group. Remove `--base` from `reset`.
- **Pros:** Each command does one thing. Set mode can include a merged-base safety check. Composable: `arb branch base develop && arb reset`. Follows the `repo default` tri-modal pattern. Show/unset modes are new capabilities.
- **Cons:** Two-step workflow for what was previously one command.

### Add `arb base` as a top-level command
Standalone command outside the `branch` group.
- **Pros:** Shorter invocation.
- **Cons:** Base branch is part of branch identity, not a separate subsystem. Breaks the "command groups for subsystems" guideline.

## Decision

Add `arb branch base [branch]` with `--unset` and `--force` options. Remove `--base` from `arb reset`.

## Reasoning

The "do one thing well" principle (GUIDELINES.md) is the primary driver. `reset` should only reset — it should not mutate workspace config as a side effect. Placing `base` under `branch` follows the "command groups for subsystems" guideline since the base branch is part of workspace branch identity.

The tri-modal pattern (no args = show, arg = set, `--unset` = remove) mirrors `arb repo default` and is a natural fit for config management. The set mode includes a merged-base safety check that was impossible in `reset --base` — when the current base was squash/merge-merged into the default branch, the command blocks and guides toward `arb rebase --retarget`, which rebases safely. `--force` bypasses this check, maintaining the `--yes`/`--force` separation principle.

## Consequences

Users who previously used `arb reset --base develop` now use `arb branch base develop && arb reset`. The two-step workflow is more explicit about what each step does. The merged-base safety check prevents a common mistake in stacked workflows where users change the base without realizing they need to rebase. `--force` provides an escape hatch for advanced users who know what they're doing.
