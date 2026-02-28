# Request-Scoped Git Cache

Date: 2026-02-28

## Context

Every `git()` call spawns a new process (~10-20ms each). Debug output revealed systematic redundancy: `repo list` called `getRemoteUrl()` twice for the same remote when share and base are the same (the common single-remote case). `status` and `list` ran full `gatherWorkspaceSummary()` twice during phased rendering — once pre-fetch, once post-fetch — repeating local-only git calls that can't change from a fetch. `resolveRemotesMap()` was called for fetch setup, then the same remote resolution was repeated independently inside `gatherWorkspaceSummary()`. Canonical repos appearing in multiple workspaces had `git remote` and `symbolic-ref` called once per workspace. With 19 repos and 5 workspaces, `list` made 291 git calls — roughly half unnecessary duplicates.

## Options

### Thread resolved data through function signatures

Pass pre-resolved remotes maps and default branches as parameters through every function in the call chain.

- **Pros:** Explicit data flow, no hidden state.
- **Cons:** Requires changing many function signatures. Doesn't help with cross-workspace deduplication. Doesn't help with cross-phase deduplication unless callers carefully manage the pre-resolved data.

### Request-scoped GitCache class (optional parameter)

A cache object created once per command invocation, passed through the call chain as an optional parameter, that memoizes read-only git queries for the lifetime of a single command.

- **Pros:** Fixes all duplication patterns with one mechanism (cross-phase, cross-workspace, same-command). Caching Promises instead of values means concurrent callers coalesce onto the same in-flight request. Easy to invalidate after fetch (clear remote-dependent entries, keep local ones). Backward compatible — callers that don't pass a cache work unchanged.
- **Cons:** Optional parameter creates verbose conditional fallback ternaries. Callers that forget to pass a cache silently lose cross-function deduplication. TypeScript cannot enforce that new code passes a cache.

### Request-scoped GitCache class (mandatory parameter)

Same as above, but `cache: GitCache` is a required parameter in `gatherRepoStatus()` and `gatherWorkspaceSummary()`. Every command must create and pass a cache.

- **Pros:** Same deduplication benefits. Clean architectural pattern with no fallback code. TypeScript enforces compliance — new code that forgets the cache gets a type error. All commands automatically benefit from caching.
- **Cons:** Every caller must be updated. Commands with a single call don't benefit from caching but still must construct a GitCache (trivial overhead).

### Global module-level cache

A singleton cache that's automatically used by all git helper functions.

- **Pros:** Zero API changes — all callers benefit automatically.
- **Cons:** Global mutable state. Hard to reason about invalidation. Cannot scope cache lifetime to a single command. Risk of stale data across unrelated operations.

## Decision

Request-scoped GitCache class with a mandatory `cache: GitCache` parameter in `gatherRepoStatus()` and `gatherWorkspaceSummary()`. Every command creates a `GitCache` at the top and threads it through the call chain. An `onPostFetch` hook on `PlanFlowOptions` lets mutation commands call `cache.invalidateAfterFetch()` at the right point in the plan flow lifecycle.

## Reasoning

The GitCache approach follows the existing pattern of passing context objects through the call chain (like `ArbContext`). Making the parameter mandatory matches this convention — required parameters that TypeScript enforces. Caching Promises rather than resolved values is the key design choice: when two concurrent `Promise.all` branches request the same repo's remotes, the second caller gets the same in-flight Promise instead of spawning a duplicate git process. The `invalidateAfterFetch()` method clears only entries that may change after a fetch (default branch resolution) while preserving stable entries (remote names, remote URLs), matching the semantic difference between "things a fetch can change" and "things that are stable for the repo's lifetime."

The mandatory parameter eliminates five conditional fallback ternaries in `status.ts` and prevents future drift. Commands that make only a single call (e.g. `delete` with one `gatherWorkspaceSummary`) pay trivial overhead for constructing an unused cache, but the consistency is worth it: every command follows the same pattern, and adding caching to a command later requires zero refactoring.

## Consequences

Git call counts drop significantly: `repo list` from 57 to ~19, `status` from 25 to ~14, `list` from 291 to ~135. The cache is scoped to a single command invocation so there is no risk of cross-command staleness. The `getDefaultBranch` and `resolveRemotes`/`getRemoteNames` functions are no longer imported directly in `status.ts` — all access goes through the cache. New commands or library code that calls `gatherRepoStatus()` or `gatherWorkspaceSummary()` will get a compile error if they forget the cache parameter.
