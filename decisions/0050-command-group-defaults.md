# Command Group Default Subcommands

Date: 2026-03-02

## Context

Arborist has three command groups: `repo` (clone, list, remove), `template` (add, list, diff, apply), and `branch` (previously a standalone command, now a group with `show`). When invoked bare (`arb repo`, `arb template`), they showed help text and exited with code 1. In practice, users invoking a group bare almost always want the inspection subcommand — `repo list`, `template list`, or `branch show`. The help output is noise after the first encounter.

The `branch` command was being converted from a standalone command to a group to accommodate future subcommands (`rename`). This raised the question of what `arb branch` should do: show help (like existing groups) or default to `show` (preserving its current behavior).

## Options

### No defaults — keep showing help

All three groups show help when invoked bare. `arb branch` would require `arb branch show` explicitly.

- **Pros:** Maximum discoverability. No flag ambiguity. Consistent.
- **Cons:** Breaks `arb branch` backward compatibility. Bare group invocation is a dead end for experienced users. `arb repo` showing help is rarely what the user wanted.

### Defaults on all groups uniformly

Each group designates a read-only subcommand as the default: `repo` → `list`, `template` → `list`, `branch` → `show`. Commander's `isDefault: true` routes bare invocation to the default subcommand.

- **Pros:** Ergonomic — bare invocation does something useful. Safe — defaults are always read-only. Consistent — one rule for all groups. Preserves `arb branch` behavior.
- **Cons:** Reduced discoverability for mutation subcommands. Requires GUIDELINES.md update.

### Defaults only on new groups

Only `branch` gets a default. `repo` and `template` keep showing help.

- **Pros:** No change to existing behavior.
- **Cons:** Inconsistent. Two groups behave one way, a third differently. Design debt.

## Decision

Defaults on all command groups uniformly. `repo` defaults to `list`, `template` defaults to `list`, `branch` defaults to `show`.

## Reasoning

Bare invocation of a command group should do something useful, not show help. Every Arborist command group has one clear, safe, read-only default. Users discover mutation subcommands via `--help`, which still lists all subcommands. Applying defaults consistently avoids the design debt of mixed behavior.

The rule is simple: the default is always the read-only inspection subcommand, never a mutation. This was added to GUIDELINES.md under "Command groups for subsystems."

## Consequences

`arb repo` now lists repos instead of showing help. `arb template` now lists templates. `arb branch` continues to show the branch (unchanged behavior from the user's perspective). Options on the default subcommand are available via the group name (`arb repo --quiet` works).

`--help` remains the way to discover mutation subcommands (`repo clone`, `repo remove`, `template add`, etc.). If a group adds a second read-only subcommand, the default designation needs revisiting — but current groups have a clear single inspection command.
