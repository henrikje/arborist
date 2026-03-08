# Consistent Options Across Commands

Date: 2026-03-08

## Context

An audit of all commands against GUIDELINES.md revealed several option inconsistencies. `detach` performed destructive operations (removing worktrees, deleting branches) without any confirmation flow, contradicting the guideline that "nothing mutates without explicit approval." Three commands (`delete`, `detach`, `clean`) that depend on remote state for accurate assessment lacked `--fetch`/`--no-fetch`, despite the guidelines requiring fetch-by-default for plan commands and membership commands.

## Options

### Fix only detach confirmation
Add `--yes` and `--dry-run` to `detach` only.
- **Pros:** Smallest change, addresses the highest-severity issue
- **Cons:** Leaves fetch inconsistencies unresolved

### Fix all identified inconsistencies
Add `--yes`/`--dry-run` to `detach`, add `--fetch`/`--no-fetch` to `detach`, `delete`, and `clean`.
- **Pros:** Brings all commands into alignment with documented conventions
- **Cons:** Larger change surface; adds a fetch step to commands that previously skipped it

## Decision

Fix all identified inconsistencies in a single pass.

## Reasoning

The guidelines are explicit about which commands should fetch by default and which should prompt for confirmation. Partial fixes would leave documented conventions partially enforced, making it harder to trust the guidelines as a reliable specification. The fetch additions are low-risk — they default to enabled (matching the convention) and can be skipped with `-N`/`--no-fetch` for users who want the previous behavior.

The `detach` confirmation flow follows the established assess → plan → confirm → execute → summarize pattern used by all other destructive commands (`delete`, `clean`, `branch rename`).

## Consequences

- `detach` now prompts for confirmation by default. Scripts using `detach` non-interactively must add `--yes`.
- `delete`, `detach`, and `clean` now fetch before assessment by default, which adds network latency. Users who want the old behavior can pass `-N`.
- GUIDELINES.md updated to explicitly list `detach`, `delete`, and `clean` in the fetch-by-default category.
- Shell completions updated for bash and zsh.
