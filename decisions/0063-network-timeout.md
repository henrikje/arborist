# Network Timeout for All Git Network Operations

Date: 2026-03-08

## Context

Arborist spawns git subprocesses for all git interactions. While `parallelFetch()` had timeout protection (120s default via `ARB_FETCH_TIMEOUT`), other network-touching operations — push, pull, and clone — could hang indefinitely if the network stalled. This violates the "detect, warn, and protect" design principle and is particularly problematic in CI/automated contexts where no human is watching to press Ctrl-C.

## Options

### A: Timeout only at network call sites
Add a `gitWithTimeout()` helper alongside the existing `git()` function. Apply it only to the ~5 call sites that contact the network (push, pull, clone, upstream fetch). Leave `git()` unchanged for the hundreds of local git calls.
- **Pros:** Minimal blast radius; no performance impact on local operations; follows the proven `parallelFetch` pattern; targets exactly the operations at risk.
- **Cons:** Each network call site needs manual modification; developers must remember to use the right function for network calls.

### B: Timeout in the core `git()` function
Add an optional timeout parameter to the `git()` function, changing its signature from variadic `...args` to `args[], options?`.
- **Pros:** Single implementation point; any future network operation automatically benefits.
- **Cons:** Breaking change to 100+ call sites; most callers don't need timeout; massive diff for a feature that benefits ~5 call sites.

### C: No change (status quo)
Rely on Ctrl-C for hung operations.
- **Pros:** Zero code change, zero risk.
- **Cons:** CI has no protection; inconsistent with fetch already having timeout.

## Decision

Option A: add `gitWithTimeout()` as a separate function and apply it at network call sites.

## Reasoning

Option A follows the existing pattern established by `parallelFetch()` and keeps the core `git()` function simple and fast. Local git operations (status, log, rev-parse, rebase, merge, etc.) are CPU/disk-bound and complete in milliseconds — adding timeout machinery to them would be all cost and no benefit. The GUIDELINES.md principle of "detect, warn, and protect" requires protecting against network hangs, but the "do one thing and do it well" principle argues against bloating the core function with rarely-used parameters.

The `gitWithTimeout()` function accepts an optional `AbortSignal` so callers like `parallelFetch()` can share a global deadline across multiple concurrent fetches. This allowed refactoring `parallelFetch()` to use the shared helper, reducing code duplication while preserving the global-deadline semantic.

Env var resolution follows a hierarchy: `ARB_PUSH_TIMEOUT` → `ARB_NETWORK_TIMEOUT` → 120 (default). This keeps the common case simple (set one var to control all network timeouts) while allowing per-operation tuning.

## Consequences

- All git network operations (fetch, push, pull, clone) now have timeout protection.
- Exit code 124 is the universal timeout indicator, matching both `parallelFetch` and Unix `timeout`.
- New env vars: `ARB_PUSH_TIMEOUT`, `ARB_PULL_TIMEOUT`, `ARB_CLONE_TIMEOUT`, `ARB_NETWORK_TIMEOUT`. All auto-captured by `arb dump` (which logs all `ARB_*` vars).
- Clone cleans up partial directories on timeout. Push and pull report timeout in the standard error flow.
- GUIDELINES.md and CLAUDE.md now codify that network git calls must use `gitWithTimeout()` or `parallelFetch()`.
- If a new command adds network git operations in the future, the developer must use `gitWithTimeout()` — enforced by convention, not the type system.
