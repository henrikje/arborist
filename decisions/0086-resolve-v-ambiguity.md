# Remove `-v` Short Alias from `--version`

Date: 2026-03-18

## Context

The global program defined `-v, --version` while 8 subcommands defined `-v, --verbose`. Commander.js resolved this via positional scoping (`enablePositionalOptions`): `arb -v` showed version, `arb status -v` showed verbose output. While technically correct, this created documentation confusion (two meanings of `-v` in the same tool), a muscle-memory risk (`arb -v status` silently shows version, not verbose status), and an unconventional pattern — most tools use `-v` for one thing consistently.

## Options

### A: Remove `-v` from `--version`
Drop the short alias entirely; `--version` becomes long-form only.
- **Pros:** `-v` means one thing everywhere. Zero cost — `--version` is typed rarely.
- **Cons:** Users who discovered `-v` for version lose the shortcut.

### B: Change to `-V, --version`
Use uppercase `-V` for version (like `ssh`).
- **Pros:** Preserves a short alias for version.
- **Cons:** Introduces a capital-letter convention not used elsewhere in arb. Still risks confusion between `-v` and `-V`.

### C: Accept status quo
Document the collision and rely on Commander's positional scoping.
- **Pros:** No code change.
- **Cons:** Confusing help output, muscle-memory traps, unconventional.

## Decision

Option A. Remove `-v` as a short alias for `--version`; keep `--version` long-form only.

## Reasoning

`--version` is a low-frequency flag — typically used once to check the installed version. `-v` for `--verbose` is used routinely across 8 commands. Giving the high-frequency meaning the short alias and requiring the long form for the rare operation is the right trade-off. The project is pre-release and GUIDELINES.md explicitly favors correctness over backwards compatibility.

## Consequences

`-v` now consistently means `--verbose` in all contexts where it appears. Users must type `--version` (or `arb --version`) to check the version — a negligible cost. Shell completions and help output no longer show `-v` at the global level, eliminating the documentation collision.
