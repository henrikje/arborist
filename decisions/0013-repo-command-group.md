# Repo Command Group with Singular Naming

Date: 2026-02-19

## Context

Arborist had two separate top-level commands for managing canonical repos: `arb clone` (clone a repo into `.arb/repos/`) and `arb repos` (list repos). The `template` command already used a subcommand group pattern with `template add`, `template list`, `template diff`, etc. The question was whether `clone` and `repos` should follow the same structure, and whether the group should use singular or plural naming.

## Options

### Merge into `arb repo` command group
Introduce `arb repo` with subcommands: `repo clone`, `repo list`.
- **Pros:** Consistent with the `template` group pattern. Natural namespace for future operations (`repo remove`, `repo info`). Reduces top-level clutter. `arb repo` shows subcommand help.
- **Cons:** Breaking change — `arb clone` stops working. Longer to type for a frequently-used setup command.

### Keep them separate
Leave `clone` and `repos` as top-level commands.
- **Pros:** No breaking changes. `arb clone` mirrors `git clone`. Simpler.
- **Cons:** Inconsistent with the `template` group pattern. No namespace for future repo management. Two top-level commands targeting the same subsystem sit separately.

### Merge with top-level alias
Create `arb repo` group but keep `arb clone` as an alias.
- **Pros:** No breaking change. Gets organizational benefits.
- **Cons:** Two ways to do the same thing. Novel pattern in the codebase. Help text complexity.

## Decision

Merge into `arb repo` with singular naming, no aliases.

## Reasoning

The `template` group sets a clear precedent for grouping subsystem management commands. Consistency across the CLI outweighs the familiarity of `arb clone` mirroring `git clone` — the Git analogy isn't perfect anyway since `arb clone` clones into a managed repo store, not the current directory. The extra word is a minor cost for a command run once or twice per project setup, not daily.

Singular naming (`repo`, not `repos`) follows the dominant CLI convention: `gh repo`, `git remote`, `docker image`, `helm repo`, `kubectl config`. Command groups name a resource type, not a collection. This was codified as a GUIDELINES.md principle: "Command groups for `.arb/` subsystems."

## Consequences

Future repo management commands (`repo remove`, `repo rename`, etc.) have a natural home. The convention is set: any new `.arb/` subsystem management gets a singular-noun command group. Existing scripts and muscle memory for `arb clone` must migrate to `arb repo clone`.
