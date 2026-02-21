# 0024 — Rename `remove`/`add`/`drop` to `delete`/`attach`/`detach`

## Context

Three commands suffered from semantic ambiguity:

- `remove` is weaker than `delete` for a lifecycle-ending, irreversible operation. It competes with common English usage and doesn't signal the permanence of the action.
- `add` clashes with `git add` and is overloaded throughout software tooling. It doesn't distinguish "attach a repo to a workspace" from "add a file to staging".
- `drop` is idiomatic in database and queue contexts (drop table, drop queue) but doesn't communicate relationship management in the way arborist uses it.

## Options

**A. Hard rename (no aliases):** Rename command strings and all references. Old names stop working immediately.

**B. Rename + deprecated aliases:** New names become primary; old names remain as aliases printing a deprecation warning.

## Decision

**Option A — hard rename.**

## Reasoning

- `delete` pairs naturally with `create` (clear CRUD lifecycle). `attach`/`detach` strongly communicate that repos are being joined to or separated from a workspace, not created or destroyed.
- The project has precedent for hard renames: decision 0009 documents the `publish`→`share` rename as a clean cutover with no aliases.
- The codebase has no existing deprecated-alias patterns, and the design philosophy ("do one thing and do it well") discourages adding transitional complexity.
- The tool is pre-1.0 and not yet widely distributed to external users, making a breaking change appropriate.

## Consequences

- `arb add`, `arb drop`, and `arb remove` now produce "unknown command" errors. Scripts using the old names must be updated.
- Command pairing is now symmetric: `create`/`delete` for workspace lifecycle, `attach`/`detach` for repo membership.
- No maintenance burden from deprecated aliases or split help output.
