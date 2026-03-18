# Drop Fetch TTL — Always Fetch When Default Fetch Is Active

Date: 2026-03-18

## Context

Decision 0079 introduced a 15-second fetch TTL to skip redundant fetches when running commands in quick succession. The reasoning was sound: `arb status` then `arb push` within seconds should not fetch twice.

In practice, the TTL creates a surprising user experience. The critical scenario: a user runs `arb status` to check whether a PR has merged, the PR merges a few seconds later, and the user runs `arb rebase` within 15 seconds. The fetch is silently skipped, so the rebase does not see the merge. The user's mental model — "I ran the command, so I have fresh data" — is violated.

The phased rendering system (introduced before the TTL) already makes fetches non-blocking: stale data appears instantly in phase 1 while the fetch runs in the background. This means the TTL's latency savings are negligible — the user does not wait for the fetch regardless.

## Decision

Remove the fetch TTL. When a command defaults to fetching and the user has not passed `--no-fetch`, the fetch always happens. The `--fetch` and `--no-fetch` flags are unchanged.

## Reasoning

- **Phased rendering already solved the latency problem.** The TTL saved a fraction of a second of invisible background work.
- **The correctness cost was real.** Any scenario where the user cares about remote state that changed in the last 15 seconds (waiting for CI, a colleague's push, a PR merge) was affected.
- **Code simplification.** Removing the TTL deletes ~300 lines of code, tests, a cache file, an environment variable (`ARB_FETCH_TTL`), and integration test workarounds.
- **Git fetch is fast when nothing changed.** A no-op fetch (no new refs) completes in well under a second.

## Consequences

- Commands that default to fetching now always fetch. Rapid-fire commands each show "Fetching N repos..." briefly during phased rendering.
- `.arb/cache/fetch.json` is no longer written. Existing files are orphaned (harmless, tiny).
- `ARB_FETCH_TTL` environment variable is no longer recognized.
- `--fetch` flag becomes a no-op for commands that already fetch by default, but remains meaningful for opt-in commands (`log`, `diff`).
