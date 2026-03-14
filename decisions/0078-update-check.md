# Passive update check via cached GitHub API

Date: 2026-03-14

## Context

Arborist is in pre-release with frequent updates. Users have no built-in way to know when a new version is available — they must manually check GitHub releases. Since arb is distributed via three methods (Homebrew, curl-pipe-bash, from source), update instructions differ per install method. A non-intrusive mechanism is needed to surface available updates without adding user burden.

## Options

### Passive post-command notice with cache

After every successful command, check a local cache file for a newer version and print a notice if one exists. The check runs concurrently with the command (promise kicked off before `parseAsync()`, awaited after). If the cache is stale (>24 hours), refresh it via the GitHub releases API.

- **Pros:** Users see updates organically. Near-zero latency (fetch overlaps with command execution). Simple implementation. Matches gh, npm, brew conventions.
- **Cons:** Per-project cache means slightly more API calls across projects (mitigated by 24h TTL).

### Explicit command only

A dedicated `arb update` or `arb version --check` command that the user runs manually.

- **Pros:** Simplest implementation. No ambient behavior.
- **Cons:** Users who don't know to run it will never learn about updates. Contradicts the pre-release rapid-iteration goal.

## Decision

Passive post-command notice with a cached GitHub API check.

## Reasoning

The passive approach aligns with the "detect, warn, and protect" principle in GUIDELINES.md — Arborist proactively watches for conditions that need attention. It also follows the "filesystem as database" principle: a plain JSON cache file in `.arb/` that can be inspected and deleted. The concurrent execution model (promise started before `parseAsync()`, awaited after) eliminates latency impact for the vast majority of invocations. Suppression via `ARB_NO_UPDATE_CHECK=1` follows the existing `ARB_DEBUG` and `ARB_*_TIMEOUT` env var conventions.

The cache file lives in `.arb/` (per-project) rather than a global location like `~/.local/share/arb/`. This is simpler — the directory is guaranteed to exist and be writable — at the cost of slightly more API calls across multiple projects, which is negligible with a 24-hour TTL and typically 1-2 projects.

## Consequences

- Users see update notices after normal commands without learning anything new.
- The notice is suppressed in non-TTY contexts (CI, pipes), for dev builds, and via `ARB_NO_UPDATE_CHECK=1`.
- A new `.arb/version.json` file appears in project roots. It is safe to delete (regenerated automatically).
- Install-method detection is heuristic (inspects `process.execPath`). If the heuristic fails, a generic "visit GitHub" instruction is shown — safe fallback.
- If the GitHub API changes or becomes unavailable, the check silently fails and the notice simply does not appear.
