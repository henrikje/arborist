# Template Management as Subcommand Group

Date: 2026-02-18

## Context

Arborist had a fully functional template system (`src/lib/templates.ts`) that seeded files from `.arb/templates/` into workspaces during `arb create` and detected drift during `arb remove`. But there was no CLI for managing templates — users had to manually construct paths like `mkdir -p .arb/templates/repos/api && cp api/.env .arb/templates/repos/api/`. This was error-prone (typos create wrong structures), lacked a feedback loop (no way to see drift without running `arb remove`), and made re-seeding impossible.

The question was both structural (how to organize the commands) and behavioral (how to scope operations between workspace and repo templates).

## Options

### Subcommand group: `arb template <action>`
Five subcommands: `add`, `remove`, `list`, `diff`, `apply`.
- **Pros:** Clean namespacing, discoverable via help. Scales naturally. Keeps top-level namespace focused. Matches Git precedent (`git remote add`, `git stash list`).
- **Cons:** First subcommand group in arb at the time (new pattern). Slightly more typing.

### Flat namespace with prefix
`arb template-add`, `arb template-diff`, etc.
- **Pros:** No new patterns.
- **Cons:** Awkward naming. Pollutes top-level namespace. No discoverability grouping.

### Augment existing commands
`arb status --templates` for drift, `arb seed` for re-apply.
- **Pros:** Zero new top-level commands.
- **Cons:** Omits `add` — the highest-value operation. Mixes concerns in `arb status`.

### Single overloaded command
`arb template` with behavior determined by flags and presence of arguments.
- **Pros:** Single command to remember.
- **Cons:** Ambiguous argument parsing. Violates Git conventions.

## Decision

Subcommand group with five operations: `add`, `remove`, `list`, `diff`, `apply`. Hybrid CWD-based scope detection with `--repo`/`--workspace` overrides.

## Reasoning

The subcommand group is the right structure for a management subsystem, matching Git's own approach (`git remote`, `git stash`). Five operations cover the full lifecycle: create → inspect → apply → update → delete. Three of the five wrap existing infrastructure, so the implementation cost is modest.

The scope detection design was driven by "repos are positional when primary target, flags when secondary filter" — since template commands use the positional for file paths, repos become a `--repo <name>` filter. CWD auto-detection handles the common case (user is inside a repo worktree), while explicit flags handle scripting and cross-scope operations.

Several sub-decisions reinforced simplicity: no `--cascade` on remove (seeded files are independent copies), no plan+confirm pattern (template operations are low-risk single-file actions), and no interactive pickers (template management is deliberate, not exploratory).

## Consequences

Template management becomes a first-class CLI workflow instead of manual filesystem operations. The subcommand group pattern was later adopted for `arb repo`, establishing it as a convention. The `--repo`/`--workspace` flag pattern for scope control is reusable across any future commands where the positional is consumed by something other than repo names.
