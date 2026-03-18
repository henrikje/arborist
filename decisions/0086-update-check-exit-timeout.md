# Race update check at exit to prevent command hang

Date: 2026-03-18

## Context

DR-0078 introduced a passive update check that runs concurrently with command execution: the check promise is kicked off before `parseAsync()` and awaited after. The implicit assumption was that commands would take longer than the network request. In practice, many commands (especially `arb status -N`, `arb list`, `arb path`) finish faster than a GitHub API round-trip on a stale cache, causing a visible 1-2 second pause before the process exits. Additionally, the happy path in `index.ts` had no explicit `process.exit()`, relying on the event loop to drain naturally — which can be delayed by lingering HTTP connection pools from the `fetch()` call.

## Options

### Fire-and-forget the update check

Don't await the promise at all. If the fetch resolved during command execution, use it; otherwise abandon it.

- **Pros:** Simplest change, zero added latency.
- **Cons:** Effectively disables update notices on stale-cache invocations (the only time a real fetch happens). Also abandons the cache write, so subsequent invocations repeat the same pattern.

### Race the update check against a short timeout, then explicit exit

After the command finishes, race `updateCheckPromise` against a 100ms timeout. Show the notice if it resolves in time. Then call `process.exit(0)` to terminate cleanly regardless of lingering event loop handles.

- **Pros:** Worst-case added latency is 100ms (imperceptible). Update notices still work for cache hits (synchronous). Forces clean termination.
- **Cons:** On stale-cache invocations, the fetch and cache write may be abandoned. The notice won't appear until a subsequent invocation where the fetch completes in time.

### Add only `process.exit(0)` at the end

Keep the unconditional `await updateCheckPromise` but add `process.exit(0)` after the try/catch.

- **Pros:** Addresses lingering event loop handles.
- **Cons:** Does not fix the primary cause — the await still blocks for up to 5 seconds on a stale cache.

## Decision

Race the update check against a 100ms timeout, then call `process.exit(0)`.

## Reasoning

The 100ms race window preserves DR-0078's intent for the common case: cache hits resolve synchronously (well under 1ms), so the notice appears immediately. On stale-cache invocations — which happen at most once every 24 hours — the fetch may be abandoned, but this is self-correcting: the next invocation retries. The explicit `process.exit(0)` follows DR-0036's convention (only `index.ts` calls `process.exit()`) and ensures the abandoned fetch and any lingering HTTP handles do not keep the process alive.

## Consequences

- Commands exit within ~100ms of completing their main work, even on stale-cache invocations.
- On the rare stale-cache invocation where the fetch does not complete within 100ms, the cache write is abandoned and the notice is deferred to a subsequent invocation.
- The explicit `process.exit(0)` means any future code that adds cleanup logic after the try/catch must run before the exit call.
