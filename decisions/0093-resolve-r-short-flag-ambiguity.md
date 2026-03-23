# Remove `-r` Short Alias from `repo default --remove`

Date: 2026-03-23

## Context

The `-r` short flag was defined on four commands with two different meanings: `delete`, `rename`, and `branch rename` used `-r` for `--delete-remote` (delete remote branches), while `repo default` used `-r` for `--remove` (remove repos from the defaults list). Commander.js resolved this via positional scoping, so there was no runtime collision. However, the same short flag meaning two different things across the tool creates documentation confusion and a muscle-memory hazard — the same class of problem addressed in DR-0086 for `-v`.

## Options

### A: Remove `-r` from `repo default --remove`
Drop the short alias from the minority outlier; `--remove` becomes long-form only. The three `--delete-remote` commands keep `-r`.
- **Pros:** `-r` means one thing everywhere. Minimal change surface (1 command). `repo default` is a low-frequency configuration command — the cost of losing the shortcut is negligible.
- **Cons:** Users who learned `arb repo default -r` must type `--remove`.

### B: Remove `-r` from all four commands
Drop the short alias entirely from every command that uses it.
- **Pros:** Absolute elimination of any `-r` ambiguity.
- **Cons:** Removes a useful shortcut from three high-frequency commands. `--delete-remote` is 15 characters typed in common workflows.

### C: Accept status quo
Document the collision and rely on Commander's positional scoping.
- **Pros:** No code change.
- **Cons:** Confusing help output, muscle-memory traps, contradicts the precedent set in DR-0086.

## Decision

Option A. Remove `-r` as a short alias for `--remove` on `repo default`; keep `-r` for `--delete-remote` on `delete`, `rename`, and `branch rename`.

## Reasoning

This mirrors DR-0086 exactly: give the short alias to the high-frequency meaning (3 commands using `--delete-remote`) and require the long form for the rare operation (1 configuration subcommand using `--remove`). The project is pre-release and GUIDELINES.md explicitly favors correctness over backwards compatibility.

## Consequences

`-r` now consistently means `--delete-remote` in all contexts where it appears. Users must type `--remove` for `arb repo default` — a negligible cost for a configuration command. Shell completions and help output no longer show `-r` on `repo default`, eliminating the documentation collision.
