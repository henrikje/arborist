# Remove template add and template remove Commands

Date: 2026-02-25

## Context

The `template add` and `template remove` subcommands were introduced in decision 0007 as part of the `template` command group for managing `.arb/templates/`. After establishing the "filesystem as database" principle and observing how Git treats user-owned space within `.git/` (hooks, config, info/), the same reasoning applies to `.arb/templates/`: it is user-owned space with a simple, stable, documented path structure. Commands that merely wrap `cp` and `rm` on this space don't provide capabilities that require Arborist's understanding.

Decision 0027 set the precedent by removing `arb fetch` when its capability was fully covered by `--fetch` flags on other commands. The same reasoning applies here — the filesystem itself is the interface for adding and removing template files.

## Options

### Keep both commands
Retain `template add` (with its CWD-based scope detection) and `template remove` (with its empty-directory cleanup).
- **Pros:** Discoverable via `--help`, scope detection in `add` saves typing.
- **Cons:** Adds surface area (help text, tests, code) for trivial file operations. `template remove` is indistinguishable from `rm`. `template add` is a thin wrapper around `cp` with scope inference that the documented path structure makes unnecessary.

### Remove both commands
Delete `template add` and `template remove`. Users manage `.arb/templates/` directly.
- **Pros:** Smaller CLI surface. Reinforces "filesystem as database" — users already know `cp` and `rm`. The remaining subcommands (`list`, `diff`, `apply`) each require Arborist's template rendering engine, giving the `template` group a clear purpose.
- **Cons:** Users who learned these commands need to adjust. No scope auto-detection convenience.

## Decision

Remove both `template add` and `template remove`. Codify the reasoning as a new GUIDELINES.md principle: "Minimal, semantic CLI."

## Reasoning

A command earns its place when it encapsulates domain knowledge, provides safety gates, or renders/transforms data. `template remove` wraps `unlinkSync` with empty-directory cleanup — no domain knowledge, no safety. `template add` wraps `copyFileSync` with CWD-based scope detection — a minor convenience over copying to a documented path. Neither provides capabilities users can't trivially replicate with shell tools.

The remaining `template` subcommands (`list`, `diff`, `apply`) all require Arborist's template rendering engine to function — they genuinely add value over filesystem tools. This sharpens the `template` group's purpose.

## Consequences

The `template` command group has three subcommands: `list`, `diff`, `apply`. Users add templates with `cp` and remove them with `rm`, targeting the documented `.arb/templates/workspace/` and `.arb/templates/repos/<name>/` paths. The `detectScopeFromPath` and `removeTemplate` library functions are removed. GUIDELINES.md gains a "Minimal, semantic CLI" principle that can be applied to future command proposals.
