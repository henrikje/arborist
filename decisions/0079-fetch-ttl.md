# Fetch TTL — Skip Redundant Fetches Within a Time Window

Date: 2026-03-16

## Context

Every arb command that fetches by default triggers a `git fetch` on every invocation. When running commands in quick succession (e.g. `arb status` then `arb push`), each triggers its own fetch — even though nothing changed on the remote since a few seconds ago. The phased rendering system already shows stale data during phase 1, so users are accustomed to "recent, not live" data. The redundant fetches add latency and cause the "Fetching N repos..." prompt to appear repeatedly.

## Options

### Time-based TTL with per-repo timestamps
Store per-repo fetch timestamps in `.arb/cache/fetch.json`. Before a default fetch, check if all repos were fetched within a TTL window. If yes, skip the fetch entirely. Explicit `--fetch` always fetches. `ARB_FETCH_TTL` env var overrides the default (15 seconds); `0` disables.

- **Pros:** Simple integration (adjusts `shouldFetch` at each call site), follows the `.arb/cache/` pattern established by the analysis cache, cross-workspace freshness (keyed by repo name, not path), configurable and disableable.
- **Cons:** Widens the staleness window from "fetch latency" to "TTL seconds", adds a persistent cache file.

### Use git's FETCH_HEAD mtime
Check the mtime of `.git/FETCH_HEAD` in each repo — git updates this file after every `git fetch`.

- **Pros:** No new files, leverages git's own bookkeeping, captures external fetches (user running `git fetch` manually).
- **Cons:** In linked worktrees, `FETCH_HEAD` is per-worktree, so fetching from workspace A's worktree doesn't update workspace B's. Commands fetch from different directories (worktrees vs canonical repos), making cross-workspace freshness unreliable.

### No caching — rely on --no-fetch
Keep current behavior. Users who want speed can pass `-N`/`--no-fetch`.

- **Pros:** No complexity, always fresh data.
- **Cons:** Does not address the UX problem. Users must remember to pass `-N` for every rapid-fire command.

## Decision

Time-based TTL with per-repo timestamps in `.arb/cache/fetch.json`. All-or-nothing check per command: if any repo is stale, all repos are fetched normally.

## Reasoning

The TTL approach gives the best UX improvement with minimal complexity. The all-or-nothing check avoids changes to `parallelFetch` and phased rendering — each command's `shouldFetch` computation is the only integration point. The per-repo timestamps stored in `.arb/cache/` follow the same pattern as the analysis cache (graceful degradation, atomic writes) and avoid the FETCH_HEAD worktree complication. The three-way fetch semantics (`--fetch` = force, default = TTL, `--no-fetch` = skip) are a natural refinement of the existing system.

The 15-second default is short enough to be unnoticeable in collaborative workflows (the chance of missing a push that happened in the last 15 seconds is negligible) while covering the primary use case of rapid-fire commands.

## Consequences

- `.arb/cache/fetch.json` accumulates per-repo timestamps. No eviction needed — the file stays small (one key per repo name).
- Integration tests set `ARB_FETCH_TTL=0` to preserve existing test behavior (tests run in fast succession and expect every command to fetch).
- All commands that call `parallelFetch` now record timestamps, even commands that don't apply the TTL skip (e.g. `attach`, `create`). This ensures a fetch from any command benefits subsequent TTL checks.
- Future refinement: per-repo filtering (fetch only stale repos instead of all-or-nothing) can be added without API changes.
