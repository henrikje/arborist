# Remove Standalone Fetch Command

Date: 2026-02-23

## Context

The `arb fetch` command fetched all remotes for every repo in a workspace in parallel. It was one of six synchronization commands. After implementing auto-fetch for mutation commands (decision 0003), every mutation command fetches automatically before operating, and every overview command accepts `--fetch` for opt-in fetching. This made `arb fetch` the only command whose sole purpose was already covered by flags on other commands.

## Options

### Keep arb fetch
Retain the command as a direct way to "just fetch, nothing else."
- **Pros:** Explicit, discoverable, familiar from `git fetch`.
- **Cons:** Redundant — any workflow involving `arb fetch` can be replaced with `--fetch` on the next command or implicit fetch on mutations. Adds surface area (help text, tests, docs) for zero unique capability. Creates a third mental category ("fetch without inspecting or mutating") that doesn't map to real workflows.

### Remove arb fetch
Delete the command. Fetching happens implicitly via mutation commands or explicitly via `--fetch` on overview commands.
- **Pros:** Smaller surface area. Simpler mental model: "doing something? it fetches. looking? opt in with --fetch." No capability loss.
- **Cons:** Users who learned `arb fetch` need to adjust. Cannot fetch without also running another command (though `arb status --fetch` is a lightweight substitute).

## Decision

Remove the standalone `arb fetch` command.

## Reasoning

The fetch model is fully covered by two patterns: automatic fetch on mutation commands and `--fetch` opt-in on overview commands. The standalone command added documentation, help text, and test maintenance cost without providing any capability that these patterns don't already cover. Removing it reinforces Arborist as a coordination layer rather than a Git verb mirror, following the "do one thing and do it well" principle.

## Consequences

The CLI has one fewer command. Users who scripted `arb fetch && arb status` should use `arb status --fetch`. Users who scripted `arb fetch && arb rebase` can drop the `arb fetch` since rebase auto-fetches. The `parallelFetch()` library function remains unchanged — it's the shared infrastructure all commands use. Decision 0003 (fetch by default for mutations) remains in effect and is now the sole mechanism for fetch behavior.
