# Persistent Analysis Cache

Date: 2026-03-16

## Context

Performance benchmarks show `arb list` at scale (20 repos, 15 workspaces) makes 3000+ git calls. A significant portion are for expensive analysis: merge detection (5-50+ calls per eligible repo), replay plan computation (3-50+ calls per diverged repo), and share divergence detection (3-6 calls per repo with bidirectional divergence). These results are deterministic functions of immutable ref positions (SHAs) and are repeated identically across commands when the underlying refs haven't changed.

## Options

### Content-addressable file cache
Cache analysis results in `.arb/cache/analysis.json`, keyed by SHA-256 hash of the cache schema version, repo name, and three ref SHAs (HEAD, base, share). On cache hit, skip the expensive git analysis entirely. No invalidation needed — the SHAs are immutable truth. Size cap (500 entries) prevents unbounded growth.

- **Pros:** No data quality compromise (all flags accurate), benefits all commands, amortized cost approaches zero on repeated runs, simple invalidation model (none — the key IS the identity).
- **Cons:** First/cold run still pays full price, adds persistent state to manage, disk I/O on every command.

### Type-safe status/analysis split
Add a `RepoStatusCore` type that skips expensive analysis phases. Commands like `list` use the cheaper type, `status` uses the full type.

- **Pros:** Compile-time safety, guaranteed cold-run savings.
- **Cons:** Merge detection quality degrades at the core tier (squash merges with new commits not detected), `list` and `status` could disagree on whether a branch is merged, significant type refactor touches many consumers.

### Lazy field computation
Make analysis fields lazy-async, computed on first access.

- **Pros:** One type, no bifurcation, automatic cost avoidance.
- **Cons:** Analysis requires async git calls, so every consumer becomes async. Breaks the pure data object model. Non-serializable.

## Decision

Content-addressable file cache. The type-safe split is deferred — evaluate after the cache is in production, since it primarily helps cold-cache scenarios.

## Reasoning

The cache approach gives the best performance improvement with zero data quality compromise. All 13 `RepoFlags` are fully accurate. `list` and `status` always agree. The immutable-key design means no invalidation logic is needed — the simplest possible cache model.

The schema version is baked into the hash key rather than stored as a standalone file field. This means different arb versions (e.g., dev builds and release) coexist peacefully — each version reads/writes its own entries, and old-format entries age out via the size cap. No version check on load, no "discard entire cache" logic.

The type-safe split was considered but deferred because: (1) with the cache handling repeated-run performance, the split only helps cold-cache runs, (2) ensuring consistent merge detection quality between `list` and `status` is important — users should not see different answers from different commands, and (3) the refactor touches many consumers for diminishing returns once the cache is effective.

## Consequences

- `.arb/cache/` directory is created on first use. Should be excluded from version control (already covered by `.arb/` being in `.gitignore`).
- Commands that gather status load the cache at start and save at end. Commands not yet integrated (sync commands, exec, open, etc.) still work — the cache parameter is optional.
- Cache entries accumulate for abandoned branches until the 500-entry cap triggers eviction.
- Future analysis phases can be added to the cache entry schema by bumping `ANALYSIS_CACHE_VERSION`.
