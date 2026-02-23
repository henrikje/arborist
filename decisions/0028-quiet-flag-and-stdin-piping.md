# Quiet Output and Stdin Piping

Date: 2026-02-23

## Context

Arborist's three list commands (`list`, `status`, `repo list`) enumerate the tool's three core entities (workspaces, repos-in-workspace, canonical repos). Extracting just names required `--json | jq '.[].workspace'`, and `repo list` had no machine-readable output at all. This made shell scripting unnecessarily heavy for a common operation: filtering entities and piping the result to another command.

## Options

### `--names-only`
A new flag that outputs one name per line.
- **Pros:** Explicit, self-documenting.
- **Cons:** Verbose flag name. `-q` collides with `list --quick`. No established Unix convention.

### `--quiet` / `-q` (chosen)
Follow the Unix convention where `-q` suppresses normal output in favor of minimal, machine-friendly output (one name per line).
- **Pros:** Familiar to Unix users. Short flag `-q` is memorable. Enables piping: `arb status -q | arb push -y`.
- **Cons:** Requires renaming `list --quick` to free `-q`. Some tools use `-q` for "suppress all output" rather than "minimal output" — but the "one name per line" interpretation is well-established (e.g. `dpkg -l -q`, `brew list -q`).

### `--format=names`
Extensible format flag.
- **Pros:** Room for future formats.
- **Cons:** Over-engineered for the current need. Verbose. No short flag.

## Decision

Add `-q, --quiet` to `list`, `status`, and `repo list`. Rename `list --quick` to `--no-status` (using Commander.js's `--no-X` convention) to free the `-q` short flag. Add `--json` to `repo list` for completeness. Add stdin support to positional-arg commands so names can be piped between commands.

## Reasoning

`--quiet` follows the Unix convention that `-q` produces machine-friendly output. Renaming `--quick` to `--no-status` is actually more descriptive of what the flag does (skip status gathering) and aligns with Commander.js's `--no-X` pattern where `options.status` defaults to `true`. The stdin convention (positional args > stdin > all) matches standard Unix tool behavior and enables composable pipelines without requiring xargs for the common case.

## Consequences

- `-q` on `list` now means `--quiet` (one workspace name per line), not `--quick`.
- `--quick` is replaced by `--no-status`. Existing scripts using `--quick` need updating.
- Commands that accept `[repos...]` or `[names...]` now also accept names from stdin when piped. Convention: positional args take precedence, then stdin if piped, then default (all).
- `exec` and `open` are excluded from stdin support because they pass `stdin: "inherit"` to child processes. Use xargs for piping to these commands.
- `repo list` now supports `--json` (outputs `[{name, url}]`) and `-q` (one name per line).
- Pipeline patterns are now possible: `arb status -q --where dirty | arb push -y`.
