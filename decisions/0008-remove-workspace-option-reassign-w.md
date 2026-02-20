# Remove --workspace Global Option, Reassign -w to --where

Date: 2026-02-18

## Context

The global `-w, --workspace <name>` option let users target a workspace by name from anywhere in the arb root. However, this functionality was redundant with `-C`, which changes the working directory before command execution — `arb -C my-ws status` achieves the same result as `arb -w my-ws status`.

Meanwhile, `--where <filter>` (used in 5 commands: `status`, `list`, `exec`, `open`, `remove`) had no short flag. It's a high-frequency option for filtering repos/workspaces by status flags like `dirty`, `unpushed`, `at-risk`. The `-w` short flag was blocked by the rarely-used global option.

Additionally, the `template` command had its own `--workspace` boolean flag with completely different semantics, creating naming confusion.

## Options

### Remove --workspace entirely, reassign -w to --where
Remove the global option. Add `-w` as a short form for `--where` in the 5 commands that use it.
- **Pros:** Frees `-w` for the higher-frequency `--where` option. Eliminates naming confusion with `template --workspace`. Simpler global option surface. `-C` is the more Git-like approach.
- **Cons:** Breaking change — `arb -w <workspace>` must become `arb -C <workspace>`. Slightly less ergonomic from non-root directories.

### Keep --workspace long form only, reassign -w to --where
Remove only the `-w` short form from the global option.
- **Pros:** Less breaking — `--workspace` still works.
- **Cons:** Confusing mismatch: `-w` means `--where` at command level but `--workspace` exists globally without a short form.

### Keep everything, use -W for --where
Don't remove `--workspace`. Use `-W` for `--where` instead.
- **Pros:** Zero breaking changes.
- **Cons:** `-W` is awkward and non-standard. Keeps the naming confusion. Rarely-used global option blocks the more useful short flag.

## Decision

Remove `--workspace`/`-w` entirely and reassign `-w` to `--where`.

## Reasoning

The `--workspace` flag is genuinely redundant with `-C`, which is more Git-like and more general. The migration path is straightforward (`-w my-ws` → `-C my-ws`). The ergonomic gain of `arb status -w dirty` over `arb status --where dirty` applies to 5 commands used in daily workflows — the trade is a net positive in utility.

This follows GUIDELINES.md's "convention over configuration" — auto-detection from the directory tree (via `-C` and cwd) is the preferred approach over explicit workspace targeting.

## Consequences

The `-w` short flag becomes available for `--where` across 5 commands. Scripts using `arb -w <workspace>` must migrate to `arb -C <workspace>`. The `template --workspace` flag no longer has a naming collision with a global option.
