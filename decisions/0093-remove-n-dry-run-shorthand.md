# Remove `-n` Shorthand for `--dry-run`

Date: 2026-03-23

## Context

The `-n` short flag was assigned to `--dry-run` on all 11 state-changing commands (push, pull, merge, rebase, retarget, reset, delete, detach, rename, branch-rename, repo remove). However, the `log` command uses `-n` for `--max-count <count>`, following git's convention (`git log -n 5`). This creates a semantic collision: `-n` means "preview without executing" everywhere except `log`, where it means "limit output count."

Git itself never uses `-n` for `--dry-run` — commands like `git push --dry-run` offer no short flag. The GUIDELINES state that short flags should serve "common actions" or "conventional mappings." `--dry-run` is an occasional safety preview, not a frequent operation, and `-n` for dry-run is not a widely recognized convention among git users.

## Options

### Remove `-n` from `--dry-run`
Drop the `-n` alias from all 11 commands. `--dry-run` remains the only way to invoke dry-run mode.
- **Pros:** Eliminates the collision. Aligns with git conventions. Cleans up the short-flag namespace. Minimal test impact (only 2 of 110+ dry-run tests use `-n`).
- **Cons:** Breaking change for users who type `arb push -n`.

### Keep status quo
Document the inconsistency but don't change behavior.
- **Pros:** No disruption. The collision is technically safe — no single command is ambiguous.
- **Cons:** Violates git alignment. `-n` for dry-run is non-conventional.

## Decision

Remove `-n` as a short flag for `--dry-run` on all commands.

## Reasoning

The decision follows directly from established principles. GUIDELINES line 101 reserves short flags for "common actions" or "conventional mappings" — dry-run is neither. Git alignment (GUIDELINES line 15) argues against `-n` for dry-run since git never uses that mapping. The pre-release policy (GUIDELINES line 63) explicitly accepts breaking changes when a better approach is found. DR-0045 set precedent by removing `-F` for `--fetch` under similar reasoning.

## Consequences

- Scripts using `arb push -n` (or any command with `-n` for dry-run) will get an "unknown option" error and must switch to `--dry-run`. Commander's error message is clear enough for self-service migration.
- `-n` is now exclusively `--max-count` on `log`, consistent with git.
- `--dry-run` has no short flag, matching git's own treatment of `--dry-run`.
- Shell completions and documentation updated to remove the `-n` alias.
